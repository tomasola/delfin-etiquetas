
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

export const getEmbedding = async (
    imgElement: HTMLImageElement | HTMLVideoElement | HTMLCanvasElement
) => {
    const { model } = await loadResources();
    if (!model) throw new Error('Model not loaded');

    const activation = tf.tidy(() => {
        const tensor = tf.browser.fromPixels(imgElement);
        return model!.infer(tensor, true);
    });

    const embeddingArray = await activation.array();
    activation.dispose();

    return (embeddingArray as number[][])[0];
};

export const findMatches = async (
    imgElement: HTMLImageElement | HTMLVideoElement | HTMLCanvasElement,
    limit: number = 5,
    userRefMap?: Record<string, { embedding: number[], image: string }>
) => {
    const { embeddings } = await loadResources();
    if (!embeddings) throw new Error('Embeddings not loaded');

    const inputVector = await getEmbedding(imgElement);

    const matches = embeddings.map(record => {
        let bestScore = cosineSimilarity(inputVector, record.embedding);

        // If user has a personalized capture for THIS particular reference, check it too
        if (userRefMap && userRefMap[record.code]) {
            const userScore = cosineSimilarity(inputVector, userRefMap[record.code].embedding);
            if (userScore > bestScore) {
                bestScore = userScore;
            }
        }

        return { ...record, score: bestScore };
    });

    matches.sort((a, b) => b.score - a.score);
    return { matches: matches.slice(0, limit), inputVector };
};

export function cosineSimilarity(a: number[], b: number[]): number {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
        dotProduct += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    const similarity = dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
    return isNaN(similarity) ? 0 : similarity;
}
