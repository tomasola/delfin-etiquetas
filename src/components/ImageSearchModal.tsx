
import { useState, useRef, useEffect } from 'react';
import { findMatches, loadResources } from '../services/visualSearch';
import { ReferenceCard } from './ReferenceCard';
import type { Reference } from '../types';

interface ImageSearchModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSelectRef: (ref: Reference) => void;
    allReferences: Reference[];
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
    const requestRef = useRef<number>();

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
        return () => stopCamera();
    }, [isOpen]);

    // Live Preview Loop for the small IA window
    const drawPreview = () => {
        if (videoRef.current && canvasRef.current && stream) {
            const video = videoRef.current;
            const canvas = canvasRef.current;
            const ctx = canvas.getContext('2d');

            if (ctx && video.videoWidth > 0) {
                // Same logic as captureAndSearch
                const minDim = Math.min(video.videoWidth, video.videoHeight);
                const size = minDim * 0.5;
                const startX = (video.videoWidth - size) / 2;
                const startY = (video.videoHeight - size) / 2;

                canvas.width = 224;
                canvas.height = 224;

                ctx.drawImage(
                    video,
                    startX, startY, size, size,
                    0, 0, 224, 224
                );
            }
        }
        requestRef.current = requestAnimationFrame(drawPreview);
    };

    useEffect(() => {
        if (stream) {
            requestRef.current = requestAnimationFrame(drawPreview);
        } else if (requestRef.current) {
            cancelAnimationFrame(requestRef.current);
        }
        return () => {
            if (requestRef.current) cancelAnimationFrame(requestRef.current);
        };
    }, [stream]);

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

            // Calculate Crop (Center Square 50%)
            const minDim = Math.min(video.videoWidth, video.videoHeight);
            const size = minDim * 0.5;
            const startX = (video.videoWidth - size) / 2;
            const startY = (video.videoHeight - size) / 2;

            canvas.width = 224;
            canvas.height = 224;
            const ctx = canvas.getContext('2d');

            if (ctx) {
                ctx.filter = 'none'; // Sync with color DB
                ctx.drawImage(video, startX, startY, size, size, 0, 0, 224, 224);

                addLog("Analyzing 50% crop...");
                const matches = await findMatches(canvas, 10);

                const fullResults = matches.map(match => {
                    const ref = allReferences.find(r => r.code === match.code);
                    return ref ? { ...ref, score: match.score } : null;
                }).filter(Boolean) as (Reference & { score: number })[];

                setResults(fullResults);
                stopCamera();
            }
        } catch (err: any) {
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
            <div className="p-4 flex justify-between items-center text-white bg-gray-900 border-b border-gray-800">
                <h2 className="text-lg font-bold">📷 Búsqueda Visual</h2>
                <button onClick={onClose} className="p-2 text-2xl hover:text-gray-300">✕</button>
            </div>

            {/* Error Message */}
            {error && (
                <div className="p-4 bg-red-600 text-white text-center text-sm font-bold animate-pulse">
                    {error}
                </div>
            )}

            {/* DEBUG CONSOLE (Green) */}
            <div className="bg-black/80 text-green-400 text-[10px] font-mono p-2 border-b border-gray-700 max-h-24 overflow-y-auto">
                {debugLogs.map((log, i) => (
                    <div key={i}>{'> ' + log}</div>
                ))}
            </div>

            {/* Main Content */}
            <div className="flex-1 overflow-hidden p-4 flex flex-col items-center justify-center">

                {/* Camera Viewfinder */}
                {!results.length && !analyzing && (
                    <div className="relative w-full max-w-sm aspect-[1/1] bg-gray-950 rounded-2xl overflow-hidden shadow-2xl border-2 border-gray-800">
                        {stream ? (
                            <video
                                ref={videoRef}
                                autoPlay
                                playsInline
                                muted
                                className="absolute inset-0 w-full h-full object-cover"
                            />
                        ) : (
                            <div className="flex items-center justify-center h-full text-gray-500 italic">
                                {error ? 'Cámara no disponible' : 'Iniciando cámara...'}
                            </div>
                        )}

                        {/* HOLE OVERLAY (Safer 4-div approach) */}
                        <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                            {/* Black masks */}
                            <div className="absolute top-0 inset-x-0 h-[25%] bg-black/60"></div>
                            <div className="absolute bottom-0 inset-x-0 h-[25%] bg-black/60"></div>
                            <div className="absolute left-0 top-[25%] bottom-[25%] w-[25%] bg-black/60"></div>
                            <div className="absolute right-0 top-[25%] bottom-[25%] w-[25%] bg-black/60"></div>

                            {/* The Guideline Box (50% center) */}
                            <div className="w-[50%] h-[50%] border-2 border-red-500 rounded-lg shadow-lg relative">
                                <div className="absolute top-1/2 left-0 w-full h-px bg-red-500/40"></div>
                                <div className="absolute left-1/2 top-0 h-full w-px bg-red-500/40"></div>
                                <div className="absolute -top-6 left-0 right-0 text-center text-red-500 text-[9px] font-bold uppercase tracking-wider">
                                    Encuadra aquí
                                </div>
                            </div>
                        </div>

                        {/* IA Preview (Live) */}
                        <div className="absolute top-2 right-2 w-20 h-20 border border-white/30 rounded-lg overflow-hidden shadow-2xl bg-black/80 z-30">
                            <div className="absolute top-0 inset-x-0 bg-black/70 text-[7px] text-white text-center py-0.5 font-bold uppercase">Vista IA</div>
                            <canvas
                                ref={canvasRef}
                                className="w-full h-full bg-black"
                            />
                        </div>

                        {/* Capture Button */}
                        <div className="absolute bottom-4 inset-x-0 flex justify-center z-40">
                            <button
                                onClick={captureAndSearch}
                                disabled={!stream || !modelLoaded}
                                className="bg-white p-1 rounded-full shadow-2xl active:scale-90 transition-transform disabled:opacity-50"
                            >
                                <div className="bg-black/5 rounded-full p-2 border-2 border-gray-200">
                                    <div className={`w-12 h-12 rounded-full ${modelLoaded ? 'bg-red-500' : 'bg-gray-400'}`}></div>
                                </div>
                            </button>
                        </div>

                        {!modelLoaded && !error && (
                            <div className="absolute top-2 left-2 bg-black/70 text-white text-[9px] py-1 px-3 rounded-full backdrop-blur-md animate-pulse">
                                CARGANDO IA...
                            </div>
                        )}
                    </div>
                )}

                {/* ANALYZING STATE */}
                {analyzing && (
                    <div className="flex flex-col items-center justify-center space-y-4">
                        <div className="relative">
                            <div className="w-20 h-20 border-4 border-blue-500/30 border-t-blue-500 rounded-full animate-spin"></div>
                            <div className="absolute inset-0 flex items-center justify-center">
                                <span className="text-2xl animate-bounce">🔍</span>
                            </div>
                        </div>
                        <div className="text-center">
                            <h3 className="text-xl font-bold text-white">Analizando...</h3>
                            <p className="text-gray-400 text-sm">Buscando en el catálogo Delfín</p>
                        </div>
                    </div>
                )}

                {/* RESULTS */}
                {results.length > 0 && (
                    <div className="w-full max-w-4xl animate-in slide-in-from-bottom-4 duration-300">
                        <div className="flex justify-between items-center mb-6 px-2">
                            <h3 className="text-lg font-bold text-white flex items-center gap-2">
                                <span className="text-green-500 opacity-50">●</span> Coincidencias ({results.length})
                            </h3>
                            <button
                                onClick={handleRetake}
                                className="bg-white/10 hover:bg-white/20 text-white px-4 py-2 rounded-xl text-xs font-bold transition-colors border border-white/10"
                            >
                                📸 Volver a intentar
                            </button>
                        </div>

                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                            {results.map(ref => (
                                <div key={ref.code} className="relative">
                                    <ReferenceCard
                                        reference={ref}
                                        onClick={() => {
                                            onClose();
                                            onSelectRef(ref);
                                        }}
                                        onPrint={() => { }}
                                    />
                                    <div className="absolute top-1 right-1 bg-green-500 text-white text-[9px] font-black px-1.5 py-0.5 rounded shadow-lg pointer-events-none">
                                        {(ref.score * 100).toFixed(0)}%
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
