import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT_DIR = path.resolve(__dirname, '..');
const AI_REFS_DIR = path.join(ROOT_DIR, 'public', 'images', 'ai-references');

async function convertBmpToJpg() {
    const files = fs.readdirSync(AI_REFS_DIR);
    const bmpFiles = files.filter(f => f.toLowerCase().endsWith('.bmp'));

    console.log(`Found ${bmpFiles.length} BMP files to convert...`);

    let converted = 0;
    let failed = 0;

    for (const bmpFile of bmpFiles) {
        try {
            const inputPath = path.join(AI_REFS_DIR, bmpFile);
            const outputPath = path.join(AI_REFS_DIR, bmpFile.replace(/\.bmp$/i, '.jpg'));

            // Skip if JPG already exists
            if (fs.existsSync(outputPath)) {
                console.log(`Skipping ${bmpFile} - JPG already exists`);
                continue;
            }

            await sharp(inputPath)
                .jpeg({ quality: 90 })
                .toFile(outputPath);

            // Delete original BMP after successful conversion
            fs.unlinkSync(inputPath);

            converted++;
            if (converted % 50 === 0) {
                console.log(`Converted ${converted}/${bmpFiles.length}...`);
            }
        } catch (err) {
            console.error(`Failed to convert ${bmpFile}:`, err.message);
            failed++;
        }
    }

    console.log(`\nConversion complete!`);
    console.log(`✅ Converted: ${converted}`);
    console.log(`❌ Failed: ${failed}`);
}

convertBmpToJpg().catch(console.error);
