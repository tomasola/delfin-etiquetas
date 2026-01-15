
import * as tf from '@tensorflow/tfjs';
import * as mobilenet from '@tensorflow-models/mobilenet';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';
import '@tensorflow/tfjs-backend-wasm';
import { setBackend } from '@tensorflow/tfjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT_DIR = path.resolve(__dirname, '..');
const IMAGES_DIR = path.join(ROOT_DIR, 'public', 'images', 'ai-references');
const OUTPUT_FILE = path.join(ROOT_DIR, 'public', 'embeddings.json');

async function main() {
    console.log('Setting backend to WASM...');
    await setBackend('wasm');
    console.log('Loading MobileNet model...');
    const model = await mobilenet.load({ version: 2, alpha: 1.0 });
    console.log('Model loaded.');

    // Load existing DB if available
    let db = [];
    if (fs.existsSync(OUTPUT_FILE)) {
        try {
            db = JSON.parse(fs.readFileSync(OUTPUT_FILE));
            console.log(`Loaded ${db.length} existing embeddings.`);
        } catch (e) {
            console.warn('Could not parse existing embeddings.json, starting fresh.');
        }
    }

    const processedCodes = new Set(db.map(r => r.code));
    const files = [];

    // Recursively find all images
    function scanDir(dir) {
        if (!fs.existsSync(dir)) return;
        fs.readdirSync(dir).forEach(file => {
            const absolute = path.join(dir, file);
            if (fs.statSync(absolute).isDirectory()) {
                scanDir(absolute);
            } else {
                const ext = path.extname(file).toLowerCase();
                if (['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) {
                    files.push(absolute);
                }
            }
        });
    }

    scanDir(IMAGES_DIR);

    // Filter out already processed
    const filesToProcess = files.filter(f => {
        const code = path.basename(f, path.extname(f));
        return !processedCodes.has(code);
    });

    console.log(`Found ${files.length} total images.`);
    console.log(`Need to process ${filesToProcess.length} images.`);

    if (filesToProcess.length === 0) {
        console.log('All images processed. Exiting.');
        return;
    }

    let count = 0;
    let savedCount = 0;

    for (const file of filesToProcess) {
        try {
            const buffer = fs.readFileSync(file);

            const { data } = await sharp(buffer)
                .resize(224, 224, { fit: 'fill' })
                .removeAlpha()
                .raw()
                .toBuffer({ resolveWithObject: true });

            const values = new Float32Array(data.length);
            for (let i = 0; i < data.length; i++) values[i] = data[i];

            const embedding = tf.tidy(() => {
                const tensor = tf.tensor3d(values, [224, 224, 3], 'int32');
                const activation = model.infer(tensor, true);
                return activation.arraySync()[0].flat();
            });

            const relPathStr = path.relative(path.join(ROOT_DIR, 'public'), file);
            const relativePath = '/' + relPathStr.replace(/\\/g, '/');
            const code = path.basename(file, path.extname(file));

            db.push({
                code: code,
                image: relativePath,
                embedding: embedding
            });

            count++;

            // Save every 20 images to avoid data loss
            if (count % 20 === 0) {
                fs.writeFileSync(OUTPUT_FILE, JSON.stringify(db));
                console.log(`Saved progress: ${db.length}/${files.length} (${count} new)`);
                if (global.gc) global.gc();
            }
        } catch (err) {
            console.error(`Error processing ${file}:`, err.message);
        }
    }

    // Final save
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(db));
    console.log(`Completed! Saved ${db.length} embeddings to ${OUTPUT_FILE}`);
}

main().catch(console.error);
