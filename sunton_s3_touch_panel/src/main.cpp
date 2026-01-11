#include <Arduino.h>
#include <ArduinoJson.h>
#include <Arduino_GFX_Library.h>
#include <NimBLEDevice.h>
#include <SD.h>
#include <SPI.h>
#include <TJpg_Decoder.h>
#include <USB.h>
#include <USBHIDKeyboard.h>
#include <Wire.h>
#include <lvgl.h>
#include <string.h>

// Forward declarations & Global Objects
void printLabel();
class Arduino_AXS15231B;
class Arduino_Canvas;

extern lv_obj_t *statusLabel;
extern USBHIDKeyboard Keyboard;
extern Arduino_Canvas *gfx;
extern Arduino_AXS15231B *g;

// BLE UUIDs
#define SERVICE_UUID "4fafc201-1fb5-459e-8fcc-c5c9c331914b"
#define DATA_CHAR_UUID "beb5483e-36e1-4688-b7f5-ea07361b26a8"
#define IMAGE_CHAR_UUID "ae5946d7-1501-443b-8772-c06d649d5c4b"

// BLE Globals
NimBLEServer *pServer = NULL;
NimBLECharacteristic *pDataChar = NULL;
NimBLECharacteristic *pImageChar = NULL;
bool deviceConnected = false;
// Image Buffer
uint8_t *imgBuffer = NULL;
size_t imgBufferSize = 0;
size_t imgLoadedSize = 0;
volatile bool imageReady = false;

// --- Move these here to be available globally ---
USBHIDKeyboard Keyboard;
Arduino_ESP32QSPI *bus = new Arduino_ESP32QSPI(45, 47, 21, 48, 40, 39);
Arduino_AXS15231B *g =
    new Arduino_AXS15231B(bus, GFX_NOT_DEFINED, 0, false, 320, 480);
Arduino_Canvas *gfx = new Arduino_Canvas(320, 480, g, 0, 0, 0);
lv_obj_t *statusLabel = NULL;
bool sdReady = false;
bool keyboardReady = false;

enum DisplayMode { MODE_UI, MODE_RECIBIDO, MODE_IMAGE, MODE_IMPRESO };
DisplayMode currentMode = MODE_UI;
unsigned long stateStartTime = 0;
const unsigned long DURATION_RECIBIDO = 2000;
const unsigned long DURATION_IMAGE = 3000; // Duration to show image after print
const unsigned long DURATION_IMPRESO_TEXT =
    3000; // Duration for "Impreso" label

static const uint32_t screenWidth = 480;
static const uint32_t screenHeight = 320;
static lv_disp_draw_buf_t draw_buf;
static lv_color_t buf[screenWidth * 30];

// TJpg_Decoder Callback
bool tjpg_callback(int16_t x, int16_t y, uint16_t w, uint16_t h,
                   uint16_t *bitmap) {
  gfx->draw16bitRGBBitmap(x, y, bitmap, w, h);
  return true;
}

class MyServerCallbacks : public NimBLEServerCallbacks {
  void onConnect(NimBLEServer *pServer) {
    deviceConnected = true;
    Serial.println("BLE: App Connected");
  };
  void onDisconnect(NimBLEServer *pServer) {
    deviceConnected = false;
    Serial.println("BLE: App Disconnected");
    // Resume advertising immediately
    NimBLEDevice::startAdvertising();
  }
};

class DataCallbacks : public NimBLECharacteristicCallbacks {
  void onWrite(NimBLECharacteristic *pCharacteristic) {
    std::string value = pCharacteristic->getValue();
    Serial.printf("BLE Data received (%d bytes): %s\n", value.length(),
                  value.c_str());
    if (value.length() > 0) {
      StaticJsonDocument<512> doc;
      DeserializationError error = deserializeJson(doc, value);
      if (!error) {
        const char *command = doc["command"];
        Serial.printf("Command identified: %s\n", command ? command : "NULL");
        if (command && strcmp(command, "START_IMAGE") == 0) {
          imgBufferSize = doc["size"];
          Serial.printf("Allocating %d bytes for image...\n", imgBufferSize);
          if (imgBuffer)
            free(imgBuffer);
          imgBuffer = (uint8_t *)malloc(imgBufferSize);
          if (!imgBuffer) {
            Serial.println("Malloc failed!");
            imgBufferSize = 0;
            return;
          }
          imgLoadedSize = 0;
          imageReady = false;
          Serial.println("Ready to receive image chunks.");
        } else if (command && strcmp(command, "PRINT") == 0) {
          Serial.println("Print command received via BLE");
          // If image transfer was skipped or failed, we can still trigger print
          // if we want but usually it happens after START_IMAGE + Image chunks
        }
      } else {
        Serial.printf("JSON Parse Error: %s\n", error.c_str());
      }
    }
  }
};

class ImageCallbacks : public NimBLECharacteristicCallbacks {
  void onWrite(NimBLECharacteristic *pCharacteristic) {
    std::string value = pCharacteristic->getValue();
    if (imgBuffer && imgLoadedSize + value.length() <= imgBufferSize) {
      memcpy(imgBuffer + imgLoadedSize, value.data(), value.length());
      imgLoadedSize += value.length();

      // Log progress every 10% to avoid serial spam
      if (imgBufferSize > 0 &&
          (imgLoadedSize % (imgBufferSize / 10 + 1) < value.length())) {
        Serial.printf("Image Progress: %d/%d (%d%%)\n", imgLoadedSize,
                      imgBufferSize, (imgLoadedSize * 100) / imgBufferSize);
      }

      if (imgLoadedSize == imgBufferSize) {
        Serial.println("Image fully received!");
        imageReady = true;
      }
    } else {
      if (!imgBuffer)
        Serial.println("Chunk ignored: imgBuffer is NULL");
      else
        Serial.printf(
            "Chunk ignored: size mismatch (Loaded: %d, New: %d, Max: %d)\n",
            imgLoadedSize, value.length(), imgBufferSize);
    }
  }
};

// Pins Sunton 3.5" (AXS15231B)
#define GFX_BL 1
#define TOUCH_ADDR 0x3B
#define TOUCH_SDA 4
#define TOUCH_SCL 8
#define TOUCH_I2C_CLOCK 400000
#define TOUCH_RST_PIN 12

// SD Card Pins
#define SD_SCK 12
#define SD_MISO 13
#define SD_MOSI 11
#define SD_CS 10

// HID Keys
#define KEY_RETURN 0xB0
#define KEY_ESC 0xB1
#define KEY_TAB 0xB3
#define KEY_PRTSC 0xCE

// (Moved to top)

// GFX Flush
void my_disp_flush(lv_disp_drv_t *disp, const lv_area_t *area,
                   lv_color_t *color_p) {
  uint32_t w = (area->x2 - area->x1 + 1);
  uint32_t h = (area->y2 - area->y1 + 1);
  gfx->draw16bitRGBBitmap(area->x1, area->y1, (uint16_t *)&color_p->full, w, h);
  lv_disp_flush_ready(disp);
}

// Touch Handling
bool getTouchPoint(uint16_t &x, uint16_t &y) {
  uint8_t data[8] = {0};
  const uint8_t cmd[11] = {0xb5, 0xab, 0xa5, 0x5a, 0x00, 0x00,
                           0x00, 0x08, 0x00, 0x00, 0x00};
  Wire.beginTransmission(TOUCH_ADDR);
  Wire.write(cmd, 11);
  if (Wire.endTransmission() != 0)
    return false;
  if (Wire.requestFrom((uint16_t)TOUCH_ADDR, (uint8_t)8) != 8)
    return false;
  for (int i = 0; i < 8; i++)
    data[i] = Wire.read();
  if (data[1] > 0 && data[1] <= 10) {
    uint16_t rx = ((data[2] & 0x0F) << 8) | data[3];
    uint16_t ry = ((data[4] & 0x0F) << 8) | data[5];
    if (rx > 320 || ry > 480)
      return false;
    y = map(rx, 0, 320, 320, 0);
    x = ry;
    return true;
  }
  return false;
}

void my_touchpad_read(lv_indev_drv_t *drv, lv_indev_data_t *data) {
  uint16_t tx, ty;
  if (getTouchPoint(tx, ty)) {
    data->state = LV_INDEV_STATE_PR;
    data->point.x = tx;
    data->point.y = ty;
  } else {
    data->state = LV_INDEV_STATE_REL;
  }
}

// SD Macro Parser (Duckyscript Lite)
void processSDCommand(String cmd) {
  cmd.trim();
  if (cmd.length() == 0 || cmd.startsWith("//"))
    return;

  if (cmd.startsWith("DELAY ")) {
    delay(cmd.substring(6).toInt());
  } else if (cmd.startsWith("STRING ")) {
    Keyboard.print(cmd.substring(7));
  } else if (cmd == "ENTER") {
    Keyboard.press(KEY_RETURN);
    Keyboard.releaseAll();
  } else if (cmd.startsWith("GUI ") || cmd.startsWith("WINDOWS ")) {
    char k = cmd.substring(cmd.indexOf(' ') + 1).charAt(0);
    Keyboard.press(KEY_LEFT_GUI);
    Keyboard.press(k);
    Keyboard.releaseAll();
  } else if (cmd.startsWith("ALT ")) {
    char k = cmd.substring(4).charAt(0);
    Keyboard.press(KEY_LEFT_ALT);
    Keyboard.press(k);
    Keyboard.releaseAll();
  } else if (cmd == "TAB") {
    Keyboard.press(KEY_TAB);
    Keyboard.releaseAll();
  }
}

void executeSDPayload(const char *path) {
  if (!sdReady)
    return;
  File f = SD.open(path);
  if (!f)
    return;
  while (f.available()) {
    processSDCommand(f.readStringUntil('\n'));
  }
  f.close();
}

// Shortcut Actions
void printLabel() {
  Serial.println("HID: Sending Alt+P...");
  Keyboard.press(KEY_LEFT_ALT);
  Keyboard.press('p');
  delay(10); // Tiny delay to ensure Windows registers the combo
  Keyboard.releaseAll();
  Serial.println("HID: Alt+P Sent");
}

void openCMD() {
  Keyboard.press(KEY_LEFT_GUI);
  Keyboard.press('r');
  Keyboard.releaseAll();
  delay(400);
  Keyboard.print("cmd");
  delay(100);
  Keyboard.press(KEY_RETURN);
  Keyboard.releaseAll();
}

void openPowerShell() {
  Keyboard.press(KEY_LEFT_GUI);
  Keyboard.press('r');
  Keyboard.releaseAll();
  delay(400);
  Keyboard.print("powershell");
  delay(100);
  Keyboard.press(KEY_RETURN);
  Keyboard.releaseAll();
}

void openNotepad() {
  Keyboard.press(KEY_LEFT_GUI);
  Keyboard.press('r');
  Keyboard.releaseAll();
  delay(400);
  Keyboard.print("notepad");
  delay(100);
  Keyboard.press(KEY_RETURN);
  Keyboard.releaseAll();
}

void lockPC() {
  Keyboard.press(KEY_LEFT_GUI);
  Keyboard.press('l');
  Keyboard.releaseAll();
}

void openTaskManager() {
  Keyboard.press(KEY_LEFT_CTRL);
  Keyboard.press(KEY_LEFT_SHIFT);
  Keyboard.press(KEY_ESC);
  Keyboard.releaseAll();
}

// UI Event
static void btn_event_cb(lv_event_t *e) {
  uintptr_t type = (uintptr_t)lv_event_get_user_data(e);
  if (lv_event_get_code(e) == LV_EVENT_CLICKED) {
    String msg = "Executing...";
    switch (type) {
    case 0:
      msg = "Printing Label";
      printLabel();
      break;
    case 1:
      msg = "CMD";
      openCMD();
      break;
    case 2:
      msg = "PowerShell";
      openPowerShell();
      break;
    case 3:
      msg = "Notepad";
      openNotepad();
      break;
    case 4:
      msg = "Task Mgr";
      openTaskManager();
      break;
    case 5:
      msg = "Locking PC";
      lockPC();
      break;
    case 6:
      msg = "Custom 1";
      executeSDPayload("/payloads/custom1.txt");
      break;
    case 7:
      msg = "Custom 2";
      executeSDPayload("/payloads/custom2.txt");
      break;
    case 8:
      msg = "Win+R";
      Keyboard.press(KEY_LEFT_GUI);
      Keyboard.press('r');
      Keyboard.releaseAll();
      break;
    case 9:
      msg = "Screenshot";
      Keyboard.press(KEY_LEFT_GUI);
      Keyboard.press(KEY_PRTSC);
      Keyboard.releaseAll();
      break;
    case 10:
      msg = "Browser";
      Keyboard.press(KEY_LEFT_GUI);
      Keyboard.press('r');
      Keyboard.releaseAll();
      delay(400);
      Keyboard.print("https://google.com");
      delay(100);
      Keyboard.press(KEY_RETURN);
      Keyboard.releaseAll();
      break;
    case 11:
      msg = "VS Code";
      Keyboard.press(KEY_LEFT_GUI);
      Keyboard.print("code");
      delay(400);
      Keyboard.press(KEY_RETURN);
      Keyboard.releaseAll();
      break;
    }
    lv_label_set_text(statusLabel, msg.c_str());
    delay(500);
    lv_label_set_text(statusLabel, "Ready");
  }
}

void createMacroUI() {
  lv_obj_t *scr = lv_scr_act();
  lv_obj_set_style_bg_color(scr, lv_color_hex(0x0A0B10), 0);

  lv_obj_t *header = lv_obj_create(scr);
  lv_obj_set_size(header, 480, 45);
  lv_obj_set_style_bg_color(header, lv_color_hex(0x161922), 0);
  lv_obj_set_style_border_width(header, 0, 0);
  lv_obj_t *title = lv_label_create(header);
  lv_label_set_text(title, "DELFIN PANEL");
  lv_obj_set_style_text_color(title, lv_color_hex(0xFFFFFF), 0);
  lv_obj_center(title);

  statusLabel = lv_label_create(scr);
  lv_obj_align(statusLabel, LV_ALIGN_BOTTOM_MID, 0, -5);
  lv_label_set_text(statusLabel, "Listo");
  lv_obj_set_style_text_color(statusLabel, lv_color_hex(0x8C92AC), 0);

  lv_obj_t *btn = lv_btn_create(scr);
  lv_obj_set_size(btn, 200, 80);
  lv_obj_center(btn);
  lv_obj_set_style_bg_color(btn, lv_color_hex(0x1E88E5), 0);
  lv_obj_set_style_radius(btn, 12, 0);
  lv_obj_add_event_cb(btn, btn_event_cb, LV_EVENT_CLICKED,
                      (void *)(uintptr_t)1);

  lv_obj_t *l = lv_label_create(btn);
  lv_label_set_text(l, "ABRIR TERMINAL");
  lv_obj_set_style_text_font(l, &lv_font_montserrat_20, 0);
  lv_obj_center(l);

  // --- Add a Test HID Button ---
  lv_obj_t *testBtn = lv_btn_create(scr);
  lv_obj_set_size(testBtn, 150, 50);
  lv_obj_align(testBtn, LV_ALIGN_BOTTOM_LEFT, 10, -50);
  lv_obj_set_style_bg_color(testBtn, lv_color_hex(0xFF9800), 0);
  lv_obj_add_event_cb(
      testBtn,
      [](lv_event_t *e) {
        if (lv_event_get_code(e) == LV_EVENT_CLICKED) {
          Serial.println("UI: Test HID Button Clicked");
          printLabel(); // Test Alt+P combo
        }
      },
      LV_EVENT_CLICKED, NULL);
  lv_obj_t *testLabel = lv_label_create(testBtn);
  lv_label_set_text(testLabel, "TEST HID");
  lv_obj_center(testLabel);
}

void setup() {
  Serial.begin(115200);
  delay(1000);

  if (!gfx->begin())
    Serial.println("Gfx FAIL");
  gfx->setRotation(1);
  gfx->fillScreen(0x0000);
  gfx->flush();
  pinMode(GFX_BL, OUTPUT);
  // Optional: Use PWM for backlight if supported, otherwise just a reliable
  // level
  analogWrite(GFX_BL, 128); // 50% brightness to save power

  pinMode(TOUCH_RST_PIN, OUTPUT);
  digitalWrite(TOUCH_RST_PIN, LOW);
  delay(100);
  digitalWrite(TOUCH_RST_PIN, HIGH);
  delay(100);
  Wire.begin(TOUCH_SDA, TOUCH_SCL);

  USB.begin();
  Keyboard.begin();
  keyboardReady = true;
  Serial.println("USB: HID & CDC Initialized");

  SPI.begin(SD_SCK, SD_MISO, SD_MOSI, SD_CS);
  if (SD.begin(SD_CS)) {
    sdReady = true;
    if (!SD.exists("/payloads"))
      SD.mkdir("/payloads");
  }

  lv_init();
  lv_disp_draw_buf_init(&draw_buf, buf, NULL, screenWidth * 30);
  static lv_disp_drv_t d_drv;
  lv_disp_drv_init(&d_drv);
  d_drv.hor_res = 480;
  d_drv.ver_res = 320;
  d_drv.flush_cb = my_disp_flush;
  d_drv.draw_buf = &draw_buf;
  lv_disp_drv_register(&d_drv);

  static lv_indev_drv_t i_drv;
  lv_indev_drv_init(&i_drv);
  i_drv.type = LV_INDEV_TYPE_POINTER;
  i_drv.read_cb = my_touchpad_read;
  lv_indev_drv_register(&i_drv);

  createMacroUI();
  lv_label_set_text(statusLabel, sdReady ? "Ready (SD OK)" : "Ready (No SD)");

  // --- JPEG Decoder Initialization ---
  TJpgDec.setCallback(tjpg_callback);
  TJpgDec.setJpgScale(1);

  // --- BLE Initialization ---
  NimBLEDevice::init("DelfinPanel");
  pServer = NimBLEDevice::createServer();
  pServer->setCallbacks(new MyServerCallbacks());

  NimBLEService *pService = pServer->createService(SERVICE_UUID);

  pDataChar = pService->createCharacteristic(
      DATA_CHAR_UUID,
      NIMBLE_PROPERTY::READ | NIMBLE_PROPERTY::WRITE | NIMBLE_PROPERTY::NOTIFY);
  pDataChar->setCallbacks(new DataCallbacks());

  pImageChar = pService->createCharacteristic(
      IMAGE_CHAR_UUID, NIMBLE_PROPERTY::WRITE | NIMBLE_PROPERTY::WRITE_NR);
  pImageChar->setCallbacks(new ImageCallbacks());

  pService->start();

  NimBLEAdvertising *pAdvertising = NimBLEDevice::getAdvertising();
  pAdvertising->addServiceUUID(SERVICE_UUID);
  pAdvertising->setScanResponse(true);
  pAdvertising->start();
  Serial.println("BLE Server Started as 'DelfinPanel'");
  Serial.printf("USB HID Initialized: %s\n", keyboardReady ? "YES" : "NO");
}

unsigned long lastStatusLog = 0;

void loop() {
  unsigned long now = millis();

  // Periodic status log
  if (now - lastStatusLog >= 3000) {
    lastStatusLog = now;
    char buf[128];
    snprintf(buf, sizeof(buf), "RAM:%d | BLE:%s | HID:%s", ESP.getFreeHeap(),
             deviceConnected ? "OK" : "DISC", keyboardReady ? "READY" : "ERR");
    lv_label_set_text(statusLabel, buf);
    Serial.println(buf);
  }

  if (imageReady) {
    imageReady = false;
    currentMode = MODE_RECIBIDO;
    stateStartTime = now;
    lv_label_set_text(statusLabel, "¡Recibido!");
    Serial.println("State: RECIBIDO");
  }

  switch (currentMode) {
  case MODE_RECIBIDO:
    if (now - stateStartTime >= DURATION_RECIBIDO) {
      currentMode = MODE_IMAGE;
      stateStartTime = now;

      // Draw Image
      g->fillScreen(0x0000);
      TJpgDec.drawJpg(0, 0, imgBuffer, imgBufferSize);
      g->flush();

      // Trigger Print
      printLabel();
      lv_label_set_text(statusLabel, "Imprimiendo...");
      Serial.println("State: IMAGE + PRINTING");
    }
    break;

  case MODE_IMAGE:
    if (now - stateStartTime >= DURATION_IMAGE) {
      currentMode = MODE_IMPRESO;
      stateStartTime = now;
      lv_label_set_text(statusLabel, "¡Impreso!");
      Serial.println("State: IMPRESO LABEL");
    }
    break;

  case MODE_IMPRESO:
    if (now - stateStartTime >= DURATION_IMPRESO_TEXT) {
      currentMode = MODE_UI;
      lv_label_set_text(statusLabel, "Lista");
      lv_obj_invalidate(lv_scr_act()); // Redraw UI
      Serial.println("State: UI");
    }
    break;

  case MODE_UI:
  default:
    lv_timer_handler();
    break;
  }

  gfx->flush();
  delay(5);
}
