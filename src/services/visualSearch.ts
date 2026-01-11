
import * as tf from '@tensorflow/tfjs';
import * as mobilenet from '@tensorflow-models/mobilenet';

interface EmbeddingRecord {
    code: string;
    image: string;
    embedding: number[];
}

let model: mobilenet.MobileNet | null = null;
let embeddings: EmbeddingRecord[] | null = null;

export const loadResources = async () => {
    if (!model) {
        console.log('Loading MobileNet...');
        model = await mobilenet.load({ version: 2, alpha: 1.0 });
    }
    if (!embeddings) {
        console.log('Fetching embeddings...');
        const response = await fetch('/embeddings.json');
        if (!response.ok) throw new Error('Failed to load embeddings.json');
        embeddings = await response.json();
    }
    return { model, embeddings };
};

export const findMatches = async (
    imgElement: HTMLImageElement | HTMLVideoElement | HTMLCanvasElement,
    limit: number = 5
) => {
    const { model, embeddings } = await loadResources();
    if (!model || !embeddings) throw new Error('Resources not loaded');

    // 1. Get embedding for input image
    const activation = tf.tidy(() => {
        const tensor = tf.browser.fromPixels(imgElement);
        // Ensure 3 channels is not strictly required by fromPixels but expected by model
        return model!.infer(tensor, true);
    });

    const inputEmbedding = await activation.array();
    activation.dispose();

    // Flatten input (should be 1x1024 or similar)
    const inputVector = (inputEmbedding as number[][])[0];

    // 2. Compare with database (Cosine Similarity)
    // Sim(A, B) = (A . B) / (||A|| * ||B||)

    // Optimization: Depending on number of embeddings (1000+), doing this in JS loop might be slightly laggy but acceptable (ms).
    // Using tf.matMul would be faster but requires loading all embeddings into GPU memory which might be heavy (1000 * 1024 floats ~ 4MB, actually fine).
    // Let's stick to JS for simplicity first, tensor if slow.

    const matches = embeddings.map(record => {
        const score = cosineSimilarity(inputVector, record.embedding);
        return { ...record, score };
    });

    // 3. Sort and slice
    matches.sort((a, b) => b.score - a.score);
    return matches.slice(0, limit);
};

function cosineSimilarity(a: number[], b: number[]): number {
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
