import { useState, useRef, useEffect, useCallback } from 'react';
import { findMatches, loadResources } from '../services/visualSearch';
import type { Reference } from '../types';

interface ImageSearchModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSelectRef: (ref: Reference) => void;
    allReferences: Reference[];
}

export function ImageSearchModal({ isOpen, onClose, onSelectRef, allReferences }: ImageSearchModalProps) {
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const resultCanvasRef = useRef<HTMLCanvasElement>(null); // For AI
    const previewCanvasRef = useRef<HTMLCanvasElement>(null); // For UI

    const [stream, setStream] = useState<MediaStream | null>(null);
    const [analyzing, setAnalyzing] = useState(false);
    const [results, setResults] = useState<(Reference & { score: number })[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [modelLoaded, setModelLoaded] = useState(false);
    const [debugLogs, setDebugLogs] = useState<string[]>([]);
    const requestRef = useRef<number | null>(null);

    const addLog = (msg: string) => {
        console.log("[DEBUG]", msg);
        setDebugLogs(prev => [...prev.slice(-4), msg]);
    };

    // Model loading
    useEffect(() => {
        if (isOpen) {
            addLog("v5: Modal Open");
            loadResources()
                .then(() => {
                    setModelLoaded(true);
                    addLog("v5: AI Ready");
                })
                .catch(err => {
                    setError('Error IA: ' + err.message);
                    addLog("v5: AI Error: " + err.message);
                });
            startCamera();
        } else {
            stopCamera();
            setResults([]);
            setError(null);
            setAnalyzing(false);
        }
    }, [isOpen]);

    // Live UI Preview Loop
    const drawPreview = () => {
        if (videoRef.current && previewCanvasRef.current && stream) {
            const video = videoRef.current;
            const canvas = previewCanvasRef.current;
            const ctx = canvas.getContext('2d');

            if (ctx && video.videoWidth > 0) {
                const minDim = Math.min(video.videoWidth, video.videoHeight);
                const size = minDim * 0.5; // Sync with logic
                const startX = (video.videoWidth - size) / 2;
                const startY = (video.videoHeight - size) / 2;

                canvas.width = 160; // Low res for preview
                canvas.height = 160;
                ctx.drawImage(video, startX, startY, size, size, 0, 0, 160, 160);
            }
        }
        requestRef.current = requestAnimationFrame(drawPreview);
    };

    // Callback ref to ensure video IS mounted when we try to play
    const onVideoRef = useCallback((node: HTMLVideoElement | null) => {
        videoRef.current = node;
        if (node && stream) {
            addLog(`v5: Video mount. Active: ${stream.active}`);

            // Assign only if not already assigned
            if (node.srcObject !== stream) {
                node.srcObject = stream;

                // Set handler directly to capture the event reliably
                node.onloadedmetadata = () => {
                    addLog("v5: Metadata loaded, play");
                    node.play().catch(e => addLog("v5: Play Err: " + e));
                };
            }
        }
    }, [stream]); // Recreate if stream changes

    // Animation Loop
    useEffect(() => {
        if (stream) {
            requestRef.current = requestAnimationFrame(drawPreview);
        }
        return () => { if (requestRef.current) cancelAnimationFrame(requestRef.current); };
    }, [stream]);

    const startCamera = async () => {
        try {
            setError(null);
            addLog("v5: Start Camera...");
            const mediaStream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: 'environment' },
                audio: false
            }).catch(() => navigator.mediaDevices.getUserMedia({ video: true, audio: false }));

            setStream(mediaStream);
            addLog("v5: Stream set");
        } catch (err: any) {
            setError('Error Cámara: ' + err.message);
            addLog("v5: Cam Error: " + err.message);
        }
    };

    const stopCamera = () => {
        if (stream) {
            stream.getTracks().forEach(t => t.stop());
            setStream(null);
            addLog("v5: Cam Stopped");
        }
    };

    const captureAndSearch = async () => {
        if (!videoRef.current || !resultCanvasRef.current || !modelLoaded) return;
        setAnalyzing(true);
        setError(null);

        try {
            const video = videoRef.current;
            const canvas = resultCanvasRef.current;
            const minDim = Math.min(video.videoWidth, video.videoHeight);
            const size = minDim * 0.5;
            const startX = (video.videoWidth - size) / 2;
            const startY = (video.videoHeight - size) / 2;

            canvas.width = 224;
            canvas.height = 224;
            const ctx = canvas.getContext('2d');
            if (ctx) {
                ctx.filter = 'none';
                ctx.drawImage(video, startX, startY, size, size, 0, 0, 224, 224);
                addLog("v5: Analyzing...");
                const matches = await findMatches(canvas, 10);
                const fullResults = matches.map(m => {
                    const ref = allReferences.find(r => r.code === m.code);
                    return ref ? { ...ref, score: m.score } : null;
                }).filter(Boolean) as (Reference & { score: number })[];
                setResults(fullResults);
                stopCamera();
            }
        } catch (err: any) {
            setError('Error Análisis: ' + err.message);
        } finally {
            setAnalyzing(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 bg-black flex flex-col items-stretch overflow-hidden">
            {/* Header + Logs */}
            <div className="bg-gray-950 p-3 flex justify-between items-center text-white border-b border-gray-800">
                <div className="flex flex-col">
                    <span className="font-bold text-sm">Búsqueda IA v13 (IMAGENES)</span>
                    <div className="flex gap-2 text-[9px] text-green-500 font-mono mt-1">
                        {debugLogs.map((l, i) => <span key={i} className="opacity-70">{l} |</span>)}
                    </div>
                </div>
                <button onClick={onClose} className="p-3 text-xl">✕</button>
            </div>

            {error && <div className="bg-red-600 p-2 text-white text-[10px] text-center">{error}</div>}

            <div className="flex-1 relative flex flex-col items-center justify-center p-4">

                {/* Viewfinder */}
                {!results.length && !analyzing && (
                    <div className="relative w-full max-w-xs aspect-square bg-gray-900 rounded-3xl overflow-hidden border-2 border-white/10 shadow-2xl">
                        {stream && (
                            <video
                                ref={onVideoRef}
                                autoPlay playsInline muted
                                className="absolute inset-0 w-full h-full object-cover"
                            />
                        )}

                        {/* Overlay Guidelines */}
                        <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                            <div className="absolute top-0 inset-x-0 h-[25%] bg-black/50"></div>
                            <div className="absolute bottom-0 inset-x-0 h-[25%] bg-black/50"></div>
                            <div className="absolute left-0 top-[25%] bottom-[25%] w-[25%] bg-black/50"></div>
                            <div className="absolute right-0 top-[25%] bottom-[25%] w-[25%] bg-black/50"></div>
                            <div className="w-[50%] h-[50%] border-2 border-red-500 rounded shadow-[0_0_20px_rgba(239,68,68,0.3)]"></div>
                        </div>

                        {/* IA Preview */}
                        <div className="absolute top-2 right-2 w-16 h-16 bg-black border border-white/20 rounded-md overflow-hidden z-20">
                            <canvas ref={previewCanvasRef} className="w-full h-full" />
                        </div>

                        {/* Shutter */}
                        <div className="absolute bottom-4 inset-x-0 flex justify-center">
                            <button
                                onClick={captureAndSearch}
                                disabled={!stream || !modelLoaded}
                                className="bg-white p-1 rounded-full active:scale-90 transition-transform disabled:opacity-30"
                            >
                                <div className="p-1 border-2 border-gray-200 rounded-full">
                                    <div className={`w-12 h-12 rounded-full ${modelLoaded ? 'bg-red-600' : 'bg-gray-400'}`}></div>
                                </div>
                            </button>
                        </div>

                        {!modelLoaded && !error && (
                            <div className="absolute top-2 left-2 text-[8px] text-white bg-black/40 px-2 py-0.5 rounded-full animate-pulse">CARGANDO...</div>
                        )}
                    </div>
                )}

                {/* Status */}
                {analyzing && (
                    <div className="text-white flex flex-col items-center animate-pulse">
                        <div className="w-16 h-16 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-4"></div>
                        <span className="font-bold">Analizando Perfil...</span>
                    </div>
                )}

                {/* Results */}
                {results.length > 0 && (
                    <div className="w-full flex-1 overflow-y-auto pt-4 pb-20">
                        <div className="flex justify-between items-center mb-4 px-2">
                            <h3 className="text-white font-bold">Resultados</h3>
                            <button onClick={() => { setResults([]); startCamera(); }} className="text-xs bg-white/10 text-white px-3 py-1.5 rounded-lg active:scale-95">Reintentar</button>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            {results.map(ref => (
                                <div key={ref.code} onClick={() => { onClose(); onSelectRef(ref); }} className="relative bg-gray-900 rounded-xl overflow-hidden active:scale-95 transition-transform border border-white/5 shadow-lg">
                                    <img
                                        src={`/images/perfiles/${ref.code}.jpg`}
                                        onError={(e) => {
                                            const target = e.target as HTMLImageElement;
                                            if (target.src.includes('.jpg')) {
                                                target.src = `/images/perfiles/${ref.code}.bmp`;
                                            } else if (target.src.includes('.bmp') && !target.src.includes('/images/')) {
                                                // Try root images folder if perfiles fails? 
                                                // valid strategy: perfiles/code.jpg -> perfiles/code.bmp -> images/code.jpg -> images/code.bmp
                                                // For now, let's just stick to the extension swap as that's the primary issue.
                                                // But wait, the file listing showed files in public/images too.
                                                // Let's try to be deeper.
                                                target.src = `/images/${ref.code}.jpg`;
                                            }
                                        }}
                                        alt={ref.code}
                                        className="w-full h-32 object-contain p-2 bg-white"
                                    />
                                    <div className="p-2">
                                        <div className="font-bold text-white text-sm">{ref.code}</div>
                                        <div className="text-[10px] text-green-500 font-bold">Probabilidad: {(ref.score * 100).toFixed(0)}%</div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>
            {/* Hidden capture canvas */}
            <canvas ref={resultCanvasRef} className="hidden" />
        </div>
    );
}
