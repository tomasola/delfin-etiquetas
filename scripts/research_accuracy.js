
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';
import '@tensorflow/tfjs-backend-wasm';
import * as tf from '@tensorflow/tfjs';
import * as mobilenet from '@tensorflow-models/mobilenet';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const EMBEDDINGS_FILE = path.join(ROOT_DIR, 'public', 'embeddings.json');
const TEST_IMAGE_SRC = "C:/Users/tomas/.gemini/antigravity/brain/0bb06eed-3cd2-4ad1-b98c-d8059dbb15b4/uploaded_image_1768167566275.jpg";

async function main() {
    await tf.setBackend('wasm');
    const model = await mobilenet.load({ version: 2, alpha: 1.0 });
    const embeddingsData = JSON.parse(fs.readFileSync(EMBEDDINGS_FILE));

    const buffer = fs.readFileSync(TEST_IMAGE_SRC);
    const metadata = await sharp(buffer).metadata();

    // Test multiple strategies
    const strategies = [
        { name: 'Crop 50% Color', proc: (s) => s.extract({ left: Math.floor(metadata.width * 0.25), top: Math.floor(metadata.height * 0.25), width: Math.floor(metadata.width * 0.5), height: Math.floor(metadata.height * 0.5) }) },
        { name: 'Crop 51% Grayscale', proc: (s) => s.extract({ left: Math.floor(metadata.width * 0.245), top: Math.floor(metadata.height * 0.245), width: Math.floor(metadata.width * 0.51), height: Math.floor(metadata.height * 0.51) }).grayscale() }
    ];

    for (const strat of strategies) {
        console.log(`\nTesting: ${strat.name}`);
        const { data, info } = await strat.proc(sharp(buffer))
            .resize(224, 224, { fit: 'fill' })
            .toColourspace('srgb')
            .removeAlpha()
            .raw()
            .toBuffer({ resolveWithObject: true });

        const inputFlat = tf.tidy(() => {
            const tensor = tf.tensor3d(new Uint8Array(data), [224, 224, 3]).toFloat();
            const logits = model.infer(tensor, true);
            return logits.dataSync();
        });

        const matches = embeddingsData.map(record => ({
            code: record.code,
            score: cosineSimilarity(inputFlat, record.embedding)
        })).sort((a, b) => b.score - a.score);

        const target = matches.find(m => m.code === '10.008');
        console.log(`Rank of '10.008': #${matches.indexOf(target) + 1} (Score: ${target?.score.toFixed(4)})`);
    }
}

function cosineSimilarity(a, b) {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
        dotProduct += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

main().catch(console.error);
