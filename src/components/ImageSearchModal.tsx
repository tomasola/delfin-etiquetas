
import { useState, useRef, useEffect } from 'react';
import { findMatches, loadResources } from '../services/visualSearch';
import { ReferenceCard } from './ReferenceCard';
import type { Reference } from '../types';

interface ImageSearchModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSelectRef: (ref: Reference) => void;
    allReferences: Reference[]; // Needed to lookup full details from code
}

export function ImageSearchModal({ isOpen, onClose, onSelectRef, allReferences }: ImageSearchModalProps) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [stream, setStream] = useState<MediaStream | null>(null);
    const [analyzing, setAnalyzing] = useState(false);
    const [results, setResults] = useState<(Reference & { score: number })[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [modelLoaded, setModelLoaded] = useState(false);

    // Initial load of model
    useEffect(() => {
        if (isOpen) {
            loadResources().then(() => setModelLoaded(true)).catch(err => {
                console.error(err);
                setError('Error cargando modelo de IA');
            });
            startCamera();
        } else {
            stopCamera();
            setResults([]);
            setError(null);
            setAnalyzing(false);
        }
        return () => {
            stopCamera();
        };
    }, [isOpen]);

    const startCamera = async () => {
        try {
            setError(null);
            const mediaStream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: 'environment' } // Prefer back camera
            });
            setStream(mediaStream);
            if (videoRef.current) {
                videoRef.current.srcObject = mediaStream;
            }
        } catch (err) {
            console.error(err);
            setError('No se pudo acceder a la cámara. Asegúrate de dar permisos.');
        }
    };

    const stopCamera = () => {
        if (stream) {
            stream.getTracks().forEach(track => track.stop());
            setStream(null);
        }
    };

    const captureAndSearch = async () => {
        if (!videoRef.current || !canvasRef.current || !modelLoaded) return;

        setAnalyzing(true);
        setError(null);

        try {
            const video = videoRef.current;
            const canvas = canvasRef.current;

            // Draw video frame to canvas
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            const ctx = canvas.getContext('2d');
            ctx?.drawImage(video, 0, 0, canvas.width, canvas.height);

            // Find matches
            // We pass the canvas element directly
            const matches = await findMatches(canvas);

            // Hydrate matches with full reference data
            const fullResults = matches.map(match => {
                const ref = allReferences.find(r => r.code === match.code);
                return ref ? { ...ref, score: match.score } : null;
            }).filter(Boolean) as (Reference & { score: number })[];

            setResults(fullResults);
            stopCamera(); // Stop camera to save battery while viewing results
        } catch (err) {
            console.error(err);
            setError('Error analizando la imagen.');
        } finally {
            setAnalyzing(false);
        }
    };

    const handleRetake = () => {
        setResults([]);
        startCamera();
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 bg-black bg-opacity-95 flex flex-col animate-in fade-in duration-200">
            {/* Header */}
            <div className="p-4 flex justify-between items-center text-white bg-gray-900">
                <h2 className="text-lg font-bold">📷 Búsqueda Visual</h2>
                <button onClick={onClose} className="p-2 text-2xl hover:text-gray-300">✕</button>
            </div>

            {/* Error Message */}
            {error && (
                <div className="p-4 bg-red-600 text-white text-center">
                    {error}
                </div>
            )}

            {/* Main Content */}
            <div className="flex-1 overflow-y-auto p-4 flex flex-col items-center">

                {/* Camera Viewfinder */}
                {!results.length && !analyzing && (
                    <div className="relative w-full max-w-md aspect-[3/4] bg-black rounded-lg overflow-hidden shadow-2xl border border-gray-700">
                        {stream ? (
                            <video
                                ref={videoRef}
                                autoPlay
                                playsInline
                                className="w-full h-full object-cover"
                            />
                        ) : (
                            <div className="flex items-center justify-center h-full text-gray-500">
                                {error ? 'Cámara no disponible' : 'Iniciando cámara...'}
                            </div>
                        )}

                        {/* Overlay Guidelines */}
                        <div className="absolute inset-0 border-2 border-white/30 pointer-events-none m-8 rounded-lg border-dashed"></div>

                        {/* Capture Button */}
                        <div className="absolute bottom-6 inset-x-0 flex justify-center">
                            <button
                                onClick={captureAndSearch}
                                disabled={!stream || !modelLoaded}
                                className="bg-white rounded-full w-16 h-16 border-4 border-gray-300 shadow-lg active:scale-95 transition-transform flex items-center justify-center"
                            >
                                <div className="w-12 h-12 bg-red-500 rounded-full"></div>
                            </button>
                        </div>

                        {!modelLoaded && !error && (
                            <div className="absolute top-4 left-4 right-4 bg-black/60 text-white text-xs py-1 px-3 rounded-full text-center backdrop-blur-sm">
                                Cargando IA...
                            </div>
                        )}
                    </div>
                )}

                {/* Loading State */}
                {analyzing && (
                    <div className="flex flex-col items-center justify-center h-full text-white">
                        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mb-4"></div>
                        <p className="text-lg">Analizando perfil...</p>
                        <p className="text-sm text-gray-400">Buscando coincidencias</p>
                    </div>
                )}

                {/* Results List */}
                {results.length > 0 && (
                    <div className="w-full max-w-4xl">
                        <div className="flex justify-between items-center mb-4 text-white">
                            <h3 className="text-xl font-bold">Resultados ({results.length})</h3>
                            <button
                                onClick={handleRetake}
                                className="bg-blue-600 hover:bg-blue-500 px-4 py-2 rounded-lg text-sm font-bold"
                            >
                                📸 Otra Foto
                            </button>
                        </div>

                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                            {results.map(ref => (
                                <div key={ref.code} className="relative group">
                                    <div className="absolute top-2 right-2 z-10 bg-green-500 text-white text-xs font-bold px-2 py-1 rounded-full shadow-md">
                                        {(ref.score * 100).toFixed(0)}%
                                    </div>
                                    <ReferenceCard
                                        reference={ref}
                                        onClick={() => {
                                            onClose();
                                            onSelectRef(ref);
                                        }}
                                        onPrint={() => { }} // Dummy format
                                    />
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>

            {/* Hidden Canvas for Capture */}
            <canvas ref={canvasRef} className="hidden" />
        </div>
    );
}
