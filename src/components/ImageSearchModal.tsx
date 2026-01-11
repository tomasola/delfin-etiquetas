
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
    const [debugLogs, setDebugLogs] = useState<string[]>([]);

    const addLog = (msg: string) => {
        console.log(msg);
        setDebugLogs(prev => [...prev.slice(-4), msg]);
    };

    // Initial load of model
    useEffect(() => {
        if (isOpen) {
            addLog("Modal opened via Camera button");
            loadResources()
                .then(() => {
                    setModelLoaded(true);
                    addLog("AI Model loaded");
                })
                .catch(err => {
                    console.error(err);
                    setError('Error cargando modelo de IA');
                    addLog("Error loading model: " + err.message);
                });
            startCamera();
        } else {
            stopCamera();
            setResults([]);
            setError(null);
            setAnalyzing(false);
            setDebugLogs([]);
        }
        return () => {
            stopCamera();
        };
    }, [isOpen]);

    // Handle stream attachment
    useEffect(() => {
        if (videoRef.current && stream) {
            addLog("Attaching stream to video element");
            videoRef.current.srcObject = stream;
            videoRef.current.onloadedmetadata = () => {
                addLog(`Video metadata loaded: ${videoRef.current?.videoWidth}x${videoRef.current?.videoHeight}`);
                videoRef.current?.play()
                    .then(() => addLog("Video playing successfully"))
                    .catch(e => addLog("Play error: " + e.message));
            };
        }
    }, [stream]);

    const startCamera = async () => {
        try {
            setError(null);
            addLog("Requesting camera access...");

            let mediaStream: MediaStream;
            try {
                mediaStream = await navigator.mediaDevices.getUserMedia({
                    video: { facingMode: 'environment' },
                    audio: false
                });
                addLog("Environment camera acquired");
            } catch (e: any) {
                addLog("Env camera failed, trying default");
                mediaStream = await navigator.mediaDevices.getUserMedia({
                    video: true,
                    audio: false
                });
                addLog("Default camera acquired");
            }

            setStream(mediaStream);
        } catch (err: any) {
            console.error(err);
            setError('No se pudo acceder a la cámara. ' + (err.message || 'Error desconocido'));
            addLog("Camera error: " + err.message);
        }
    };

    const stopCamera = () => {
        if (stream) {
            stream.getTracks().forEach(track => track.stop());
            setStream(null);
            addLog("Camera stopped");
        }
    };

    const captureAndSearch = async () => {
        if (!videoRef.current || !canvasRef.current || !modelLoaded) return;

        setAnalyzing(true);
        setError(null);

        try {
            const video = videoRef.current;
            const canvas = canvasRef.current;

            addLog(`Capture: Video size ${video.videoWidth}x${video.videoHeight}`);

            if (video.videoWidth === 0 || video.videoHeight === 0) {
                addLog("Video dimensions 0x0 - ABORTING");
                setAnalyzing(false);
                return;
            }

            // Calculate Crop (Center Square 60% of minimum dimension)
            const minDim = Math.min(video.videoWidth, video.videoHeight);
            const size = minDim * 0.6;
            const startX = (video.videoWidth - size) / 2;
            const startY = (video.videoHeight - size) / 2;

            // Prepare Canvas (MobileNet expects 224x224)
            canvas.width = 224;
            canvas.height = 224;
            const ctx = canvas.getContext('2d');

            if (ctx) {
                // Apply Image Processing: High Contrast B&W
                ctx.filter = 'grayscale(100%) contrast(250%) brightness(120%)';

                // Draw clipped video to canvas
                ctx.drawImage(
                    video,
                    startX, startY, size, size, // Source Crop
                    0, 0, 224, 224 // Dest Resize
                );

                addLog("Frame cropped & filtered");

                const matches = await findMatches(canvas);
                addLog(`Matches found: ${matches.length}`);

                const fullResults = matches.map(match => {
                    const ref = allReferences.find(r => r.code === match.code);
                    return ref ? { ...ref, score: match.score } : null;
                }).filter(Boolean) as (Reference & { score: number })[];

                setResults(fullResults);
                stopCamera();
            }
        } catch (err: any) {
            console.error(err);
            setError('Error analizando la imagen.');
            addLog("Analysis error: " + err.message);
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
                <div className="p-4 bg-red-600 text-white text-center text-sm">
                    {error}
                </div>
            )}

            {/* DEBUG CONSOLE */}
            <div className="bg-black/80 text-green-400 text-xs font-mono p-2 border-b border-gray-700 max-h-24 overflow-y-auto">
                {debugLogs.map((log, i) => (
                    <div key={i}>{'> ' + log}</div>
                ))}
            </div>

            {/* Main Content */}
            <div className="flex-1 overflow-y-auto p-4 flex flex-col items-center">

                {/* Camera Viewfinder */}
                {!results.length && !analyzing && (
                    <div className="relative w-full max-w-md aspect-[3/4] bg-gray-900 rounded-lg overflow-hidden shadow-2xl border border-gray-700">
                        {stream ? (
                            <video
                                ref={videoRef}
                                autoPlay
                                playsInline
                                muted
                                className="w-full h-full object-cover"
                            />
                        ) : (
                            <div className="flex items-center justify-center h-full text-gray-500">
                                {error ? 'Cámara no disponible' : 'Iniciando cámara...'}
                            </div>
                        )}

                        {/* Overlay Guidelines - Center Box (50%) */}
                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                            <div className="w-56 h-56 border-2 border-red-500 rounded-lg shadow-[0_0_0_9999px_rgba(0,0,0,0.65)] relative">
                                {/* Crosshair */}
                                <div className="absolute top-1/2 left-0 w-full h-0.5 bg-red-500/50"></div>
                                <div className="absolute left-1/2 top-0 h-full w-0.5 bg-red-500/50"></div>
                                {/* Tip label */}
                                <div className="absolute -top-10 left-0 right-0 text-center text-red-500 text-[10px] font-bold uppercase tracking-widest bg-black/40 py-1 rounded">
                                    Encuadra el perfil aquí
                                </div>
                            </div>
                        </div>

                        {/* IA Live Preview - Snapshot of what AI sees */}
                        <div className="absolute top-4 right-4 w-24 h-24 border border-white/50 rounded overflow-hidden shadow-lg bg-black/50 z-20">
                            <div className="absolute top-0 left-0 right-0 bg-black/60 text-[8px] text-white text-center py-0.5 uppercase">IA Vista</div>
                            <canvas
                                ref={canvasRef}
                                className="w-full h-full object-contain"
                                style={{ imageRendering: 'pixelated' }}
                            />
                        </div>

                        {/* Capture Button */}
                        <div className="absolute bottom-6 inset-x-0 flex justify-center z-10">
                            <button
                                onClick={captureAndSearch}
                                disabled={!stream || !modelLoaded}
                                className="bg-white rounded-full w-16 h-16 border-4 border-gray-300 shadow-lg active:scale-95 transition-transform flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                <div className={`w-12 h-12 rounded-full ${modelLoaded ? 'bg-red-500' : 'bg-gray-400'}`}></div>
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

        </div>
        </div >
    );
}
