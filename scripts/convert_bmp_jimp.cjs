const { Jimp } = require('jimp');
const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const AI_REFS_DIR = path.join(ROOT_DIR, 'public', 'images', 'ai-references');

async function convertBmpToJpgWithJimp() {
    const files = fs.readdirSync(AI_REFS_DIR);
    const bmpFiles = files.filter(f => f.toLowerCase().endsWith('.bmp'));

    console.log(`Found ${bmpFiles.length} BMP files to convert with Jimp...`);

    let converted = 0;
    let failed = 0;
    const failedFiles = [];

    for (const bmpFile of bmpFiles) {
        try {
            const inputPath = path.join(AI_REFS_DIR, bmpFile);
            const outputPath = path.join(AI_REFS_DIR, bmpFile.replace(/\.bmp$/i, '.jpg'));

            // Skip if JPG already exists
            if (fs.existsSync(outputPath)) {
                continue;
            }

            // Read and convert with Jimp
            const image = await Jimp.read(inputPath);
            await image.write(outputPath);

            // Delete original BMP after successful conversion
            fs.unlinkSync(inputPath);

            converted++;
            if (converted % 50 === 0) {
                console.log(`✅ Converted ${converted}/${bmpFiles.length}...`);
            }
        } catch (err) {
            failedFiles.push(bmpFile);
            failed++;
            if (failed <= 5) {
                console.error(`❌ Failed: ${bmpFile} - ${err.message}`);
            }
        }
    }

    console.log(`\n=== Conversion Complete ===`);
    console.log(`✅ Successfully converted: ${converted}`);
    console.log(`❌ Failed: ${failed}`);

    if (failedFiles.length > 0 && failedFiles.length <= 20) {
        console.log(`\nFailed files:`, failedFiles.join(', '));
    }
}

convertBmpToJpgWithJimp().catch(console.error);
