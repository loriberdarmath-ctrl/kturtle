import React, { useState, useRef, useEffect } from 'react';
// framer-motion was previously used for a handful of trivial fades and
// slide-ups. That pulled in ~40 KB of gzipped JS for what CSS keyframes
// cover in a dozen lines — so we use `.anim-fade` / `.anim-rise` from
// src/index.css instead. Re-keying a span on value change gives us the
// "pop on update" effect without a runtime animation engine.

interface SVGConverterProps {
    onGenerateCode: (code: string) => void;
    onClose: () => void;
}

export function SVGConverter({ onGenerateCode, onClose }: SVGConverterProps) {
    const [svgUrl, setSvgUrl] = useState<string | null>(null);
    const [originalImage, setOriginalImage] = useState<HTMLImageElement | null>(null);

    const [qualityLevel, setQualityLevel] = useState<number>(50);
    const [renderMode, setRenderMode] = useState<'color' | 'silhouette'>('color');

    const [stats, setStats] = useState({ lines: 0, operations: 0, warning: '' });
    const [generatedCode, setGeneratedCode] = useState<string>('');

    const canvasPreviewRef = useRef<HTMLCanvasElement>(null);
    const hiddenCanvasRef = useRef<HTMLCanvasElement>(null);

    const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        if (file.type !== 'image/svg+xml') {
            alert('Please upload a valid SVG file.');
            return;
        }

        const reader = new FileReader();
        reader.onload = (event) => {
            const url = event.target?.result as string;
            setSvgUrl(url);

            const img = new Image();
            img.onload = () => {
                setOriginalImage(img);
            };
            img.src = url;
        };
        reader.readAsDataURL(file);
    };

    useEffect(() => {
        if (!originalImage || !canvasPreviewRef.current || !hiddenCanvasRef.current) return;

        let codeOutput = '# Generated from SVG\nreset\ncanvassize 500, 500\ncanvascolor 252, 250, 245\n';
        let operations = 0;
        let warning = '';
        const canvasSize = 400;

        canvasPreviewRef.current.width = canvasSize;
        canvasPreviewRef.current.height = canvasSize;

        const pCtx = canvasPreviewRef.current.getContext('2d');
        if (!pCtx) return;
        pCtx.fillStyle = '#ffffff';
        pCtx.fillRect(0, 0, canvasSize, canvasSize);

        const hCtx = hiddenCanvasRef.current.getContext('2d', { willReadFrequently: true });
        if (!hCtx) return;

        if (renderMode === 'silhouette') {
            const targetWidth = 400;
            const imageScale = targetWidth / originalImage.width;
            const targetHeight = Math.floor(originalImage.height * imageScale);

            hiddenCanvasRef.current.width = targetWidth;
            hiddenCanvasRef.current.height = targetHeight;
            hCtx.clearRect(0, 0, targetWidth, targetHeight);
            hCtx.drawImage(originalImage, 0, 0, targetWidth, targetHeight);

            const imgData = hCtx.getImageData(0, 0, targetWidth, targetHeight);
            const pixels = imgData.data;

            const stepSize = Math.max(1, Math.floor(20 - (qualityLevel / 100) * 19));

            codeOutput += 'penwidth ' + stepSize + '\npenup\ndirection 90\npencolor 20, 20, 20\n\n';

            const offsetX = Math.floor((500 - targetWidth) / 2);
            const offsetY = Math.floor((500 - targetHeight) / 2);

            pCtx.fillStyle = '#2b2722';

            const previewScaleX = canvasSize / targetWidth;
            const previewOffsetY = (canvasSize - targetHeight * previewScaleX) / 2;

            for (let y = 0; y < targetHeight; y += stepSize) {
                let inLine = false;
                let startX = -1;

                for (let x = 0; x <= targetWidth; x++) {
                    let isBlack = false;
                    if (x < targetWidth) {
                        const idx = (y * targetWidth + x) * 4;
                        const r = pixels[idx];
                        const g = pixels[idx + 1];
                        const b = pixels[idx + 2];
                        const a = pixels[idx + 3];

                        const brightness = (r + g + b) / 3;
                        isBlack = a > 100 && brightness < 150;
                    }

                    if (isBlack && !inLine) {
                        inLine = true;
                        startX = x;
                    } else if (!isBlack && inLine) {
                        inLine = false;
                        let endX = x - 1;
                        if (endX >= startX) {
                            const drawX = startX + offsetX;
                            const drawY = y + offsetY;
                            const distance = endX - startX;

                            codeOutput += 'go ' + drawX + ',' + drawY + ' pendown forward ' + distance + ' penup\n';
                            operations++;

                            pCtx.fillRect(
                                startX * previewScaleX,
                                y * previewScaleX + previewOffsetY,
                                distance * previewScaleX,
                                stepSize * previewScaleX * 0.9
                            );
                        }
                    }
                }
            }
        } else {
            const targetWidth = 400;
            const imageScale = targetWidth / originalImage.width;
            const targetHeight = Math.floor(originalImage.height * imageScale);

            hiddenCanvasRef.current.width = targetWidth;
            hiddenCanvasRef.current.height = targetHeight;
            hCtx.clearRect(0, 0, targetWidth, targetHeight);
            hCtx.drawImage(originalImage, 0, 0, targetWidth, targetHeight);

            const imgData = hCtx.getImageData(0, 0, targetWidth, targetHeight);
            const pixels = imgData.data;

            const stepSize = Math.max(1, Math.floor(20 - (qualityLevel / 100) * 19));

            codeOutput += 'penwidth ' + stepSize + '\npenup\ndirection 90\n\n';

            const offsetX = Math.floor((500 - targetWidth) / 2);
            const offsetY = Math.floor((500 - targetHeight) / 2);

            const COLOR_TOLERANCE = 150 - (qualityLevel * 1.3);

            const colorDist = (r1: number, g1: number, b1: number, r2: number, g2: number, b2: number) => {
                return Math.abs(r1 - r2) + Math.abs(g1 - g2) + Math.abs(b1 - b2);
            };

            const previewScaleX = canvasSize / targetWidth;
            const previewOffsetY = (canvasSize - targetHeight * previewScaleX) / 2;

            for (let y = 0; y < targetHeight; y += stepSize) {
                let chunkStart = -1;
                let lastColor: { r: number, g: number, b: number } | null = null;

                for (let x = 0; x <= targetWidth; x++) {
                    let a = 0, r = 0, g = 0, b = 0;
                    if (x < targetWidth) {
                        const idx = (y * targetWidth + x) * 4;
                        r = pixels[idx];
                        g = pixels[idx + 1];
                        b = pixels[idx + 2];
                        a = pixels[idx + 3];
                    }

                    const isVisible = a > 100 && x < targetWidth;
                    let color = isVisible ? { r, g, b } : null;

                    if (!lastColor && color) {
                        chunkStart = x;
                        lastColor = color;
                    } else if (lastColor && color && colorDist(lastColor.r, lastColor.g, lastColor.b, color.r, color.g, color.b) <= COLOR_TOLERANCE) {
                        // continue
                    } else if (lastColor && (!color || colorDist(lastColor.r, lastColor.g, lastColor.b, color.r, color.g, color.b) > COLOR_TOLERANCE)) {

                        pCtx.fillStyle = `rgb(${lastColor.r}, ${lastColor.g}, ${lastColor.b})`;
                        pCtx.fillRect(
                            chunkStart * previewScaleX,
                            y * previewScaleX + previewOffsetY,
                            (x - chunkStart) * previewScaleX,
                            stepSize * previewScaleX * 0.9
                        );

                        const drawX = chunkStart + offsetX;
                        const drawY = y + offsetY;
                        const distance = x - chunkStart;

                        codeOutput += 'pencolor ' + lastColor.r + ',' + lastColor.g + ',' + lastColor.b + ' go ' + drawX + ',' + drawY + ' pendown forward ' + distance + ' penup\n';
                        operations++;

                        if (color) {
                            chunkStart = x;
                            lastColor = color;
                        } else {
                            chunkStart = -1;
                            lastColor = null;
                        }
                    }
                }
            }
        }

        codeOutput += 'spritehide\n';

        const totalLines = operations + 8;
        if (totalLines > 5000) warning = 'This will be quite dense — it may take a while to draw.';
        else if (totalLines > 2000) warning = 'Heads up: this is a lot of code. It may draw slowly.';

        setStats({ lines: totalLines, operations, warning });
        setGeneratedCode(codeOutput);

    }, [originalImage, qualityLevel, renderMode]);

    return (
        <div
            onClick={onClose}
            className="fixed inset-0 z-50 flex items-start sm:items-center justify-center p-0 sm:p-6 bg-ink-900/30 backdrop-blur-sm overflow-y-auto anim-fade"
        >
            <div
                onClick={(e) => e.stopPropagation()}
                className="w-full sm:max-w-5xl min-h-screen sm:min-h-0 sm:max-h-[92vh] bg-white sm:rounded-2xl overflow-hidden border border-line shadow-[0_24px_80px_-20px_rgba(26,24,20,0.18)] flex flex-col md:flex-row anim-rise"
            >
                {/* Left: Preview */}
                <div className="relative flex-1 flex flex-col p-5 sm:p-7 border-b md:border-b-0 md:border-r border-line bg-paper-soft/40 min-h-[50vh] md:min-h-0">
                    <div className="flex items-center justify-between mb-5">
                        <div>
                            <div className="text-[11px] text-ink-500 mb-0.5">Import</div>
                            <h2
                                className="font-display text-[22px] text-ink-900 font-medium"
                                style={{ letterSpacing: '-0.01em' }}
                            >
                                SVG to{' '}
                                <span className="italic text-ink-600" style={{ fontFamily: 'var(--font-serif)' }}>
                                    turtle code
                                </span>
                            </h2>
                        </div>
                        <button
                            onClick={onClose}
                            className="w-9 h-9 rounded-full hover:bg-paper-sunk text-ink-500 hover:text-ink-900 inline-flex items-center justify-center transition-colors"
                            aria-label="Close"
                        >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>
                    </div>

                    <div className="flex-1 flex flex-col items-center justify-center relative">
                        {!originalImage && (
                            <div
                                className="w-full h-full border-2 border-dashed border-line hover:border-accent hover:bg-accent-wash/40 transition-colors rounded-2xl flex flex-col items-center justify-center cursor-pointer group absolute inset-0 z-20 anim-fade"
                            >
                                    <input
                                        type="file"
                                        accept=".svg"
                                        onChange={handleFileUpload}
                                        className="absolute inset-0 opacity-0 cursor-pointer z-20"
                                    />
                                    <div className="p-5 rounded-full bg-white border border-line group-hover:border-accent/40 mb-4 transition-colors">
                                        <svg viewBox="0 0 100 100" className="w-14 h-14 text-ink-400 group-hover:text-accent transition-colors">
                                            <ellipse cx="50" cy="55" rx="24" ry="28" fill="currentColor" opacity="0.9" />
                                            <circle cx="50" cy="25" r="11" fill="currentColor" />
                                            <ellipse cx="28" cy="42" rx="7" ry="5" fill="currentColor" />
                                            <ellipse cx="72" cy="42" rx="7" ry="5" fill="currentColor" />
                                            <ellipse cx="28" cy="68" rx="7" ry="5" fill="currentColor" />
                                            <ellipse cx="72" cy="68" rx="7" ry="5" fill="currentColor" />
                                        </svg>
                                    </div>
                                    <p
                                        className="font-display text-[20px] text-ink-900 font-medium"
                                        style={{ letterSpacing: '-0.01em' }}
                                    >
                                        Drop an <span className="italic text-accent" style={{ fontFamily: 'var(--font-serif)' }}>SVG</span> here
                                    </p>
                                <p className="text-ink-500 text-[13px] mt-2">
                                    or click to choose a file
                                </p>
                            </div>
                        )}

                        <div
                            className={`w-full h-full flex flex-col relative items-center justify-center transition-opacity duration-300 ${originalImage ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
                        >
                            <div className="relative p-3 border border-line rounded-xl bg-white shadow-sm overflow-hidden flex items-center justify-center w-full aspect-square max-w-[460px]">
                                <canvas
                                    ref={canvasPreviewRef}
                                    className="max-w-full max-h-full object-contain"
                                    style={{ imageRendering: 'pixelated' }}
                                />
                            </div>
                            {originalImage && (
                                <button
                                    onClick={() => {
                                        setOriginalImage(null);
                                        setSvgUrl(null);
                                    }}
                                    className="mt-4 text-[12px] text-ink-500 hover:text-accent transition-colors"
                                >
                                    Choose a different file
                                </button>
                            )}
                        </div>
                        <div className="hidden">{svgUrl}</div>
                        <canvas ref={hiddenCanvasRef} className="hidden" />
                    </div>
                </div>

                {/* Right: Controls */}
                <div className="w-full md:w-[360px] flex flex-col p-5 sm:p-7 bg-white overflow-y-auto">

                    <div className="mb-7">
                        <div className="text-[11px] text-ink-500 mb-3">Options</div>

                        {/* Render Mode */}
                        <div className="flex bg-paper-soft rounded-full p-1 border border-line mb-5">
                            <button
                                className={`flex-1 py-1.5 text-[12.5px] font-medium rounded-full transition-colors ${renderMode === 'color' ? 'bg-ink-900 text-paper' : 'text-ink-600 hover:text-ink-900'}`}
                                onClick={() => setRenderMode('color')}
                            >
                                Full color
                            </button>
                            <button
                                className={`flex-1 py-1.5 text-[12.5px] font-medium rounded-full transition-colors ${renderMode === 'silhouette' ? 'bg-ink-900 text-paper' : 'text-ink-600 hover:text-ink-900'}`}
                                onClick={() => setRenderMode('silhouette')}
                            >
                                Silhouette
                            </button>
                        </div>

                        <div>
                            <div className="flex justify-between items-center mb-2">
                                <label className="text-ink-800 text-[13px] font-medium">
                                    Detail level
                                </label>
                                <span className="text-ink-700 font-mono text-[11.5px] tab-nums bg-paper-soft border border-line px-2 py-0.5 rounded-full">
                                    {qualityLevel}
                                </span>
                            </div>

                            <input
                                type="range"
                                min="1"
                                max="100"
                                value={qualityLevel}
                                onChange={(e) => setQualityLevel(parseInt(e.target.value))}
                                className="w-full accent-accent"
                                disabled={!originalImage}
                            />
                            <div className="flex justify-between text-[11px] text-ink-500 mt-1.5">
                                <span>Abstract</span>
                                <span>Detailed</span>
                            </div>
                        </div>
                    </div>

                    <div className="flex-1">
                        <div className="text-[11px] text-ink-500 mb-3">Output</div>

                        <div className="bg-paper-soft/50 border border-line rounded-xl p-4 space-y-3 font-sans text-[13px]">
                            <div className="flex justify-between items-center">
                                <span className="text-ink-500">Lines of code</span>
                                {/* `key` on the span forces React to remount it on every
                                    value change, which replays the one-shot `.anim-pop`
                                    CSS animation — the same "number flips" effect we
                                    used to achieve with AnimatePresence+motion.span. */}
                                <span
                                    key={stats.lines}
                                    className={`font-mono tab-nums anim-pop ${stats.lines > 2000 ? 'text-accent' : 'text-ink-900'}`}
                                >
                                    {stats.lines.toLocaleString()}
                                </span>
                            </div>
                            <div className="h-px bg-line" />
                            <div className="flex justify-between items-center">
                                <span className="text-ink-500">Operations</span>
                                <span
                                    key={stats.operations}
                                    className="font-mono tab-nums text-ink-900 anim-pop"
                                >
                                    {stats.operations.toLocaleString()}
                                </span>
                            </div>

                            {stats.warning && (
                                <div
                                    className="text-[12px] text-accent flex items-start gap-2 bg-accent-wash/60 p-3 rounded-lg border border-accent/20 mt-2 anim-fade"
                                >
                                    <svg className="w-4 h-4 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M5.07 19h13.86c1.54 0 2.5-1.67 1.73-3L13.73 4a2 2 0 00-3.46 0L3.34 16c-.77 1.33.19 3 1.73 3z" />
                                    </svg>
                                    <p className="leading-relaxed">{stats.warning}</p>
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="pt-5 mt-5 border-t border-line">
                        <button
                            disabled={!originalImage}
                            onClick={() => {
                                onGenerateCode(generatedCode);
                                onClose();
                            }}
                            className="w-full bg-ink-900 hover:bg-accent text-paper font-medium py-3 text-[14px] rounded-full disabled:opacity-40 disabled:cursor-not-allowed transition-colors inline-flex items-center justify-center gap-2"
                        >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                            </svg>
                            <span>Send to editor</span>
                        </button>
                        <p className="text-center text-ink-500 text-[11.5px] mt-3">
                            Replaces your current code
                        </p>
                    </div>

                </div>
            </div>
        </div>
    );
}
