import { useState, useRef, useEffect, useCallback } from 'react';
import { findMatches, loadResources } from '../services/visualSearch';
import type { Reference } from '../types';
import { RobustImage } from './RobustImage';

interface ImageSearchModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSelectRef: (ref: Reference) => void;
    allReferences: Reference[];
    userRefMap: Record<string, { embedding: number[], image: string }>;
    onLinkReference: (code: string, capture: { embedding: number[], image: string }) => void;
}

export function ImageSearchModal({ isOpen, onClose, onSelectRef, allReferences, userRefMap, onLinkReference }: ImageSearchModalProps) {
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const resultCanvasRef = useRef<HTMLCanvasElement>(null);
    const previewCanvasRef = useRef<HTMLCanvasElement>(null);

    const [stream, setStream] = useState<MediaStream | null>(null);
    const [analyzing, setAnalyzing] = useState(false);
    const [results, setResults] = useState<(Reference & { score: number })[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [modelLoaded, setModelLoaded] = useState(false);
    const [comparisonMode, setComparisonMode] = useState(false);
    const [liveScore, setLiveScore] = useState<number | null>(null);
    const [comparisonRefEmbedding, setComparisonRefEmbedding] = useState<number[] | null>(null);
    const [comparisonRefCode, setComparisonRefCode] = useState<string | null>(null);
    const [debugLogs, setDebugLogs] = useState<string[]>([]);
    const [previewRef, setPreviewRef] = useState<(Reference & { score: number }) | null>(null);
    const requestRef = useRef<number | null>(null);
    const [lastCapture, setLastCapture] = useState<{ embedding: number[], image: string } | null>(null);

    const addLog = (msg: string) => {
        console.log("[DEBUG]", msg);
        setDebugLogs(prev => [...prev.slice(-4), msg]);
    };


    // Model loading
    useEffect(() => {
        if (isOpen) {
            addLog("v18: Modal Open");
            loadResources()
                .then(() => {
                    setModelLoaded(true);
                    addLog("v18: AI Ready");
                })
                .catch(err => {
                    setError('Error IA: ' + err.message);
                    addLog("v18: AI Error: " + err.message);
                });
            startCamera();
        } else {
            stopCamera();
            setResults([]);
            setError(null);
            setAnalyzing(false);
            setComparisonMode(false);
            setLiveScore(null);
            setComparisonRefEmbedding(null);
        }
    }, [isOpen]);

    // Live UI Preview Loop
    const drawPreview = async () => {
        if (videoRef.current && previewCanvasRef.current && stream) {
            const video = videoRef.current;
            const canvas = previewCanvasRef.current;
            const ctx = canvas.getContext('2d');

            if (ctx && video.videoWidth > 0) {
                const minDim = Math.min(video.videoWidth, video.videoHeight);
                const size = minDim * 0.5;
                const startX = (video.videoWidth - size) / 2;
                const startY = (video.videoHeight - size) / 2;

                canvas.width = 160;
                canvas.height = 160;
                ctx.drawImage(video, startX, startY, size, size, 0, 0, 160, 160);

                // Live Comparison Logic
                if (comparisonMode && comparisonRefEmbedding && modelLoaded) {
                    try {
                        const { getEmbedding, cosineSimilarity } = await import('../services/visualSearch');
                        const liveEmbedding = await getEmbedding(canvas);
                        const score = cosineSimilarity(liveEmbedding, comparisonRefEmbedding);
                        setLiveScore(score);
                    } catch (e) {
                        console.error("Live comparison error", e);
                    }
                }
            }
        }
        requestRef.current = requestAnimationFrame(drawPreview);
    };

    // Callback ref to ensure video IS mounted when we try to play
    const onVideoRef = useCallback((node: HTMLVideoElement | null) => {
        videoRef.current = node;
        if (node && stream) {
            addLog(`v18: Video mount. Active: ${stream.active}`);

            if (node.srcObject !== stream) {
                node.srcObject = stream;
                node.onloadedmetadata = () => {
                    addLog("v18: Metadata loaded, play");
                    node.play().catch(e => addLog("v18: Play Err: " + e));
                };
            }
        }
    }, [stream]);

    // Animation Loop
    useEffect(() => {
        if (stream) {
            requestRef.current = requestAnimationFrame(drawPreview);
        }
        return () => { if (requestRef.current) cancelAnimationFrame(requestRef.current); };
    }, [stream, comparisonMode, comparisonRefEmbedding, modelLoaded]);

    const startCamera = async () => {
        try {
            setError(null);
            addLog("v18: Start Camera...");
            const mediaStream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: 'environment' },
                audio: false
            }).catch(() => navigator.mediaDevices.getUserMedia({ video: true, audio: false }));

            setStream(mediaStream);
            addLog("v18: Stream set");
        } catch (err: any) {
            setError('Error Cámara: ' + err.message);
            addLog("v18: Cam Error: " + err.message);
        }
    };

    const stopCamera = () => {
        if (stream) {
            stream.getTracks().forEach(t => t.stop());
            setStream(null);
            addLog("v18: Cam Stopped");
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
                addLog("v18: Analyzing...");
                // Pass userRefMap so IA uses previous learning
                const { matches, inputVector } = await findMatches(canvas, 10, userRefMap);

                // Store this capture for potential confirmation
                setLastCapture({
                    embedding: inputVector,
                    image: canvas.toDataURL('image/jpeg', 0.8)
                });

                const fullResults = matches.map(m => {
                    const ref = allReferences.find(r => r.code === m.code);
                    return ref ? { ...ref, score: m.score, embedding: m.embedding } : null;
                }).filter(Boolean) as (Reference & { score: number, embedding?: number[] })[];
                setResults(fullResults);
                // We keep camera for a moment to allow preview confirm
            }
        } catch (err: any) {
            setError('Error Análisis: ' + err.message);
        } finally {
            setAnalyzing(false);
        }
    };

    const startComparison = async (ref: Reference & { score: number, embedding?: number[] }) => {
        addLog("v18: Init Compare " + ref.code);

        // If we have a fresh capture for this ref, use it and save it
        let targetEmbedding = ref.embedding || null;
        if (userRefMap[ref.code]) {
            // Use previously saved user capture for this code
            targetEmbedding = userRefMap[ref.code].embedding;
        }

        setComparisonRefEmbedding(targetEmbedding);
        setComparisonRefCode(ref.code);
        setComparisonMode(true);
        setPreviewRef(null);
        setResults([]);
        await startCamera();
    };

    const handleLinkCapture = (refCode: string) => {
        if (!lastCapture || !previewRef) return;

        onLinkReference(refCode, lastCapture);

        const refinedRef = { ...previewRef, embedding: lastCapture.embedding };
        setLastCapture(null);

        // Finalize: Select and close
        handleClose();
        onSelectRef(refinedRef);
    };

    const handleSelectResult = (ref: Reference & { score: number, embedding?: number[] }) => {
        // If it's personalized, go straight to comparison
        if (userRefMap[ref.code]) {
            startComparison(ref);
        } else {
            setPreviewRef(ref);
        }
    };

    const handleClose = () => {
        stopCamera();
        onClose();
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 bg-black flex flex-col items-stretch overflow-hidden">
            {/* Header + Logs */}
            <div className="bg-gray-950/80 backdrop-blur-lg p-3 flex justify-between items-center text-white border-b border-white/10">
                <div className="flex flex-col">
                    <span className="font-bold text-sm">Búsqueda IA v18 {comparisonMode ? '(COMPARACIÓN ACTIVA)' : '(INDUSTRIAL++)'}</span>
                    <div className="flex gap-2 text-[9px] text-green-500 font-mono mt-1">
                        {debugLogs.map((l, i) => <span key={i} className="opacity-70">{l} |</span>)}
                    </div>
                </div>
                <button onClick={handleClose} className="p-3 text-xl">✕</button>
            </div>

            {error && <div className="bg-red-600 p-2 text-white text-[10px] text-center">{error}</div>}

            <div className="flex-1 relative flex flex-col items-center justify-center p-2 overflow-hidden">
                {/* 1. IMAGE PREVIEW OVERLAY (The floating window) */}
                {previewRef && (
                    <div className="absolute inset-0 z-50 bg-black/95 flex flex-col items-center justify-center p-4 animate-in fade-in duration-200">
                        <div className="relative w-full max-w-lg flex flex-col items-center justify-center h-full">
                            <div className="flex-1 w-full flex flex-col gap-4 overflow-auto p-2">
                                <span className="text-white text-xs font-bold uppercase tracking-widest text-center">Confirmación Visual</span>

                                <div className="flex gap-2 w-full">
                                    {/* Catalog image */}
                                    <div className="flex-1 flex flex-col gap-1">
                                        <span className="text-[10px] text-gray-400 font-bold uppercase text-center tracking-tighter">🖼️ Catálogo</span>
                                        <div className="bg-white rounded-xl p-1 aspect-square flex items-center justify-center overflow-hidden border border-white/10">
                                            <RobustImage
                                                code={previewRef.code}
                                                className="w-full h-full object-contain"
                                            />
                                        </div>
                                    </div>

                                    {/* Current Capture */}
                                    {lastCapture && (
                                        <div className="flex-1 flex flex-col gap-1">
                                            <span className="text-[10px] text-blue-400 font-bold uppercase text-center tracking-tighter">📸 Tu Captura</span>
                                            <div className="bg-gray-800 rounded-xl p-1 aspect-square flex items-center justify-center overflow-hidden border border-blue-500/30 shadow-[0_0_15px_rgba(59,130,246,0.2)]">
                                                <img
                                                    src={lastCapture.image}
                                                    className="w-full h-full object-contain"
                                                    alt="User Ref"
                                                />
                                            </div>
                                        </div>
                                    )}
                                </div>

                                <div className="bg-gray-900/80 p-5 rounded-2xl backdrop-blur-sm border border-white/10 shadow-2xl mt-auto">
                                    <div className="flex justify-between items-center mb-6">
                                        <div className="flex-1 overflow-hidden pr-2">
                                            <h2 className="text-3xl font-bold text-white tracking-widest flex items-center gap-2">
                                                {previewRef.code}
                                                {userRefMap[previewRef.code] && <span className="text-[10px] bg-orange-600 text-white px-2 py-0.5 rounded-full animate-pulse">PERSONALIZADA</span>}
                                            </h2>
                                            <p className="text-xs text-green-400 font-mono mt-1 uppercase tracking-widest">Coincidencia: {(previewRef.score * 100).toFixed(0)}%</p>
                                        </div>

                                        {!userRefMap[previewRef.code] && lastCapture && (
                                            <button
                                                onClick={() => handleLinkCapture(previewRef.code)}
                                                className="bg-green-600 hover:bg-green-500 text-white px-4 h-16 rounded-xl font-bold border-2 border-green-400/30 shadow-[0_4px_15px_rgba(22,163,74,0.4)] flex flex-col items-center justify-center active:scale-95 transition-all"
                                            >
                                                <span className="text-xl">✅</span>
                                                <span className="text-[10px] whitespace-nowrap px-2">CONFIRMAR</span>
                                            </button>
                                        )}
                                    </div>

                                    <div className="flex gap-4">
                                        <button onClick={() => { setPreviewRef(null); }} className="flex-1 py-4 rounded-xl bg-gray-800 text-white font-bold text-sm border border-white/10 active:bg-gray-700 transition-colors uppercase tracking-widest flex items-center justify-center gap-2">
                                            <span>⬅️</span> Volver
                                        </button>
                                        <button onClick={() => { handleClose(); onSelectRef(previewRef); }} className="flex-1 py-4 rounded-xl bg-blue-600 text-white font-bold text-sm border border-blue-400/50 shadow-[0_0_20px_rgba(37,99,235,0.4)] active:bg-blue-500 transition-all uppercase tracking-widest flex items-center justify-center gap-2">
                                            <span>✔️</span> Ver Ficha
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* 2. CAMERA VIEWFINDER (Main Mode) */}
                {(comparisonMode || (!results.length && !analyzing)) && (
                    <div className="relative w-full max-w-xs flex flex-col items-center gap-4">
                        <div className="relative w-full aspect-square bg-gray-900 rounded-3xl overflow-hidden border-2 border-white/10 shadow-2xl">
                            {stream && (
                                <video ref={onVideoRef} autoPlay playsInline muted className="absolute inset-0 w-full h-full object-cover" />
                            )}

                            {/* Guidelines */}
                            <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                                <div className="absolute top-0 inset-x-0 h-[25%] bg-black/50"></div>
                                <div className="absolute bottom-0 inset-x-0 h-[25%] bg-black/50"></div>
                                <div className="absolute left-0 top-[25%] bottom-[25%] w-[25%] bg-black/50"></div>
                                <div className="absolute right-0 top-[25%] bottom-[25%] w-[25%] bg-black/50"></div>
                                <div className={`w-[50%] h-[50%] border-2 rounded shadow-lg transition-colors duration-300 ${comparisonMode ? (liveScore && liveScore > 0.85 ? 'border-green-500 shadow-green-500/50' : 'border-orange-500 shadow-orange-500/50') : 'border-red-500 shadow-red-500/30'}`}></div>
                            </div>

                            {/* Comparison Panel */}
                            {comparisonMode && (
                                <div className="absolute top-2 left-2 w-20 bg-black/80 backdrop-blur-md rounded-xl p-1 border border-white/20 z-30 animate-in slide-in-from-left">
                                    <RobustImage
                                        code={comparisonRefCode || ''}
                                        className="w-full h-16 object-contain bg-white rounded-lg mb-1"
                                    />
                                    <div className="text-[10px] text-white font-bold text-center truncate px-1">{comparisonRefCode}</div>
                                    <div className={`text-xs font-bold text-center mt-1 font-mono ${liveScore && liveScore > 0.85 ? 'text-green-500' : 'text-orange-400'}`}>
                                        {liveScore ? (liveScore * 100).toFixed(1) : '0.0'}%
                                    </div>
                                </div>
                            )}

                            {/* Mini Preview */}
                            <div className="absolute top-2 right-2 w-16 h-16 bg-black border border-white/20 rounded-md overflow-hidden z-20">
                                <canvas ref={previewCanvasRef} className="w-full h-full" />
                            </div>

                            {/* Capture/Stop Trigger */}
                            <div className="absolute bottom-4 inset-x-0 flex justify-center">
                                {comparisonMode ? (
                                    <button onClick={() => {
                                        setComparisonMode(false);
                                        setLiveScore(null);
                                        setComparisonRefEmbedding(null);
                                        setComparisonRefCode(null);
                                    }} className="bg-red-600 text-white px-6 py-3 rounded-full font-bold shadow-xl border-2 border-white/20 active:scale-90 flex items-center gap-2">
                                        <span>🛑</span> DETENER
                                    </button>
                                ) : (
                                    <button onClick={captureAndSearch} disabled={!stream || !modelLoaded} className="bg-white p-1 rounded-full active:scale-90 transition-transform disabled:opacity-30">
                                        <div className="p-1 border-2 border-gray-200 rounded-full">
                                            <div className={`w-12 h-12 rounded-full ${modelLoaded ? 'bg-red-600' : 'bg-gray-400'}`}></div>
                                        </div>
                                    </button>
                                )}
                            </div>

                            {!modelLoaded && !error && (
                                <div className="absolute top-2 left-2 text-[8px] text-white bg-black/40 px-2 py-0.5 rounded-full animate-pulse">CARGANDO...</div>
                            )}
                        </div>

                        {comparisonMode && (
                            <div className="bg-gray-900 border border-white/10 p-3 rounded-2xl w-full text-center">
                                <p className="text-white text-[10px] uppercase font-bold tracking-widest mb-1">Confirmación Precisa</p>
                                <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
                                    <div
                                        className={`h-full transition-all duration-300 ${liveScore && liveScore > 0.85 ? 'bg-green-500' : 'bg-orange-500'}`}
                                        style={{ width: `${(liveScore || 0) * 100}%` }}
                                    ></div>
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {/* 3. ANALYZING STATUS */}
                {analyzing && (
                    <div className="text-white flex flex-col items-center animate-pulse py-8">
                        <div className="w-16 h-16 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-4"></div>
                        <span className="font-bold tracking-widest text-sm">ANALIZANDO...</span>
                    </div>
                )}

                {/* 4. RESULTS GRID */}
                {results.length > 0 && (
                    <div className="w-full flex-1 overflow-y-auto pt-2 pb-4">
                        <div className="flex justify-between items-center mb-2 px-1">
                            <h3 className="text-white font-bold text-sm tracking-widest uppercase">Resultados ({results.length})</h3>
                            <button onClick={() => { setResults([]); startCamera(); }} className="text-[10px] bg-white/10 text-white px-3 py-1.5 rounded-lg active:scale-95 border border-white/20 font-bold uppercase">Reintentar</button>
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                            {results.map((ref, idx) => (
                                <div
                                    key={ref.code}
                                    onClick={() => handleSelectResult(ref)}
                                    className="relative bg-gray-900 rounded-xl overflow-hidden active:scale-95 transition-all text-center border border-white/10 shadow-xl"
                                    style={{ animationDelay: `${idx * 40}ms` }}
                                >
                                    <RobustImage
                                        code={ref.code}
                                        className="w-full h-20 object-contain p-1 bg-white"
                                    />
                                    <div className="p-1 pb-2">
                                        <div className="font-bold text-white text-[10px] truncate">{ref.code}</div>
                                        <div className="text-[8px] text-green-500 font-bold">{(ref.score * 100).toFixed(0)}%</div>
                                        {userRefMap[ref.code] && (
                                            <div className="absolute top-1 left-1 w-2 h-2 bg-orange-500 rounded-full shadow-[0_0_5px_rgba(249,115,22,0.8)]"></div>
                                        )}
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
