import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { TurtleState, DrawCommand } from '../interpreter/interpreter';

interface TurtleCanvasProps {
  turtle: TurtleState;
  drawings: DrawCommand[];
  /**
   * External, UI-driven zoom (0.5..N). This multiplies the user's internal
   * wheel zoom — the canvas computes an effective zoom from both.
   */
  externalScale?: number;
  /** Callback when user adjusts zoom via wheel; lets parent reflect the value. */
  onZoomChange?: (zoom: number) => void;
}

export interface TurtleCanvasHandle {
  exportImage: () => string | null;
  resetView: () => void;
  fitToScreen: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  getZoom: () => number;
}

// Offscreen turtle sprite (rendered once, reused). The sprite canvas is small
// (SPRITE_SIZE × SPRITE_SIZE) so per-frame turtle updates only need a clear +
// drawImage + rotate, not a re-draw of dozens of paths on a huge canvas.
const SPRITE_SIZE = 48;

let spriteCache: HTMLCanvasElement | null = null;
function getTurtleSprite(): HTMLCanvasElement {
  if (spriteCache) return spriteCache;

  const c = document.createElement('canvas');
  c.width = SPRITE_SIZE;
  c.height = SPRITE_SIZE;
  const ctx = c.getContext('2d')!;

  ctx.translate(SPRITE_SIZE / 2, SPRITE_SIZE / 2);
  const size = 16;

  // Shell
  ctx.beginPath();
  ctx.ellipse(0, 0, size * 0.6, size * 0.8, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#4ade80';
  ctx.fill();
  ctx.strokeStyle = '#166534';
  ctx.lineWidth = 2;
  ctx.stroke();

  // Shell pattern
  ctx.beginPath();
  ctx.moveTo(-size * 0.3, -size * 0.4);
  ctx.lineTo(0, -size * 0.2);
  ctx.lineTo(size * 0.3, -size * 0.4);
  ctx.moveTo(-size * 0.3, size * 0.1);
  ctx.lineTo(0, size * 0.3);
  ctx.lineTo(size * 0.3, size * 0.1);
  ctx.strokeStyle = '#166534';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Head
  ctx.beginPath();
  ctx.arc(0, -size, size * 0.35, 0, Math.PI * 2);
  ctx.fillStyle = '#86efac';
  ctx.fill();
  ctx.strokeStyle = '#166534';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Eyes
  ctx.beginPath();
  ctx.arc(-size * 0.12, -size * 1.1, 2, 0, Math.PI * 2);
  ctx.arc(size * 0.12, -size * 1.1, 2, 0, Math.PI * 2);
  ctx.fillStyle = '#000';
  ctx.fill();

  // Legs
  const legPositions: [number, number][] = [
    [-size * 0.5, -size * 0.3],
    [size * 0.5, -size * 0.3],
    [-size * 0.5, size * 0.3],
    [size * 0.5, size * 0.3],
  ];
  for (const [lx, ly] of legPositions) {
    ctx.beginPath();
    ctx.ellipse(lx, ly, size * 0.2, size * 0.15, (lx < 0 ? -1 : 1) * Math.PI / 6, 0, Math.PI * 2);
    ctx.fillStyle = '#86efac';
    ctx.fill();
    ctx.strokeStyle = '#166534';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // Tail
  ctx.beginPath();
  ctx.moveTo(0, size * 0.7);
  ctx.lineTo(0, size);
  ctx.strokeStyle = '#86efac';
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.stroke();

  spriteCache = c;
  return c;
}

// Render a slice of drawing commands onto a context. Consecutive `line`
// commands sharing style are batched into a single path for far fewer
// stroke() calls.
function renderCommands(
  ctx: CanvasRenderingContext2D,
  canvasW: number,
  canvasH: number,
  baseColor: string,
  cmds: DrawCommand[],
  start: number,
  end: number,
) {
  let pathOpen = false;
  let curColor = '';
  let curWidth = -1;

  const flush = () => {
    if (pathOpen) {
      ctx.stroke();
      pathOpen = false;
    }
  };

  for (let i = start; i < end; i++) {
    const cmd = cmds[i];
    switch (cmd.type) {
      case 'line': {
        if (
          cmd.x1 === undefined || cmd.y1 === undefined ||
          cmd.x2 === undefined || cmd.y2 === undefined
        ) break;
        const color = cmd.color || '#000';
        const width = cmd.width || 1;
        if (!pathOpen || color !== curColor || width !== curWidth) {
          flush();
          ctx.strokeStyle = color;
          ctx.lineWidth = width;
          // KTurtle uses Qt's default QPen, which has SquareCap + BevelJoin.
          // This gives the characteristic flat, rectangular line endings
          // (rather than rounded caps) seen in the original KTurtle.
          ctx.lineCap = 'square';
          ctx.lineJoin = 'bevel';
          ctx.beginPath();
          pathOpen = true;
          curColor = color;
          curWidth = width;
        }
        ctx.moveTo(cmd.x1, cmd.y1);
        ctx.lineTo(cmd.x2, cmd.y2);
        break;
      }

      case 'text': {
        flush();
        if (cmd.x1 !== undefined && cmd.y1 !== undefined && cmd.text) {
          ctx.font = `${cmd.fontSize || 12}px sans-serif`;
          ctx.fillStyle = cmd.color || '#000';
          ctx.fillText(cmd.text, cmd.x1, cmd.y1);
        }
        break;
      }

      case 'clear': {
        flush();
        ctx.fillStyle = baseColor;
        ctx.fillRect(0, 0, canvasW, canvasH);
        break;
      }

      case 'canvasColor': {
        flush();
        ctx.fillStyle = cmd.color || '#fff';
        ctx.fillRect(0, 0, canvasW, canvasH);
        break;
      }
    }
  }

  flush();
}

const MIN_ZOOM = 0.05;
const MAX_ZOOM = 40;

const TurtleCanvasImpl = forwardRef<TurtleCanvasHandle, TurtleCanvasProps>(
  ({ turtle, drawings, externalScale = 1, onZoomChange }, ref) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const turtleRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);

  // Internal zoom and pan (in viewport pixels). We compose externalScale
  // (from UI slider) with zoom for the final visual scale.
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });

  // Incremental draw state
  const drawnCountRef = useRef(0);
  const lastCanvasSizeRef = useRef({ w: 0, h: 0 });
  const lastCanvasColorRef = useRef('');
  const lastDrawingsRef = useRef<DrawCommand[] | null>(null);

  const effectiveZoom = zoom * externalScale;

  // Compute "fit" — the scale that fits the canvas inside the viewport with
  // a small margin. Used for resetView() and the initial render.
  const computeFitZoom = useCallback(() => {
    const vp = viewportRef.current;
    if (!vp) return 1;
    const pad = 32;
    const availW = Math.max(1, vp.clientWidth - pad * 2);
    const availH = Math.max(1, vp.clientHeight - pad * 2);
    return Math.min(availW / turtle.canvasWidth, availH / turtle.canvasHeight, 1);
  }, [turtle.canvasWidth, turtle.canvasHeight]);

  const centerPan = useCallback(
    (z: number) => {
      const vp = viewportRef.current;
      if (!vp) return { x: 0, y: 0 };
      return {
        x: (vp.clientWidth - turtle.canvasWidth * z * externalScale) / 2,
        y: (vp.clientHeight - turtle.canvasHeight * z * externalScale) / 2,
      };
    },
    [turtle.canvasWidth, turtle.canvasHeight, externalScale],
  );

  // Initial fit, and also refit when canvas size changes.
  useLayoutEffect(() => {
    const z = computeFitZoom();
    setZoom(z);
    setPan(centerPan(z));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turtle.canvasWidth, turtle.canvasHeight]);

  // Notify parent of zoom changes (e.g., to show "135%" in a chip).
  useEffect(() => {
    onZoomChange?.(effectiveZoom);
  }, [effectiveZoom, onZoomChange]);

  useImperativeHandle(
    ref,
    () => ({
      exportImage: () => {
        const canvas = canvasRef.current;
        if (!canvas) return null;
        return canvas.toDataURL('image/png');
      },
      resetView: () => {
        const z = computeFitZoom();
        setZoom(z);
        setPan(centerPan(z));
      },
      fitToScreen: () => {
        const z = computeFitZoom();
        setZoom(z);
        setPan(centerPan(z));
      },
      zoomIn: () => setZoom(z => Math.min(MAX_ZOOM, z * 1.2)),
      zoomOut: () => setZoom(z => Math.max(MIN_ZOOM, z / 1.2)),
      getZoom: () => effectiveZoom,
    }),
    [computeFitZoom, centerPan, effectiveZoom],
  );

  // ── Wheel-to-zoom (zooms to cursor, like Figma/Photoshop). Wheel events
  // over the canvas are always captured so the page doesn't scroll while
  // the user is zooming. Any wheel inside the viewport zooms.
  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      // Normalize delta: pixel mode is tiny, line mode is ~100, page mode huge.
      let delta = e.deltaY;
      if (e.deltaMode === 1) delta *= 16;
      else if (e.deltaMode === 2) delta *= 100;
      const factor = Math.exp(-delta * 0.0015);
      setZoom(prevZoom => {
        const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, prevZoom * factor));
        // Adjust pan so the point under the cursor stays fixed.
        const rect = vp.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        setPan(prevPan => {
          const sx = externalScale; // constant during this callback
          const worldX = (mx - prevPan.x) / (prevZoom * sx);
          const worldY = (my - prevPan.y) / (prevZoom * sx);
          return {
            x: mx - worldX * newZoom * sx,
            y: my - worldY * newZoom * sx,
          };
        });
        return newZoom;
      });
    };

    vp.addEventListener('wheel', onWheel, { passive: false });
    return () => vp.removeEventListener('wheel', onWheel);
  }, [externalScale]);

  // ── Pan: middle-click drag, space+drag, or plain left-drag on empty space.
  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;

    let dragging = false;
    let startX = 0;
    let startY = 0;
    let startPan = { x: 0, y: 0 };

    const onPointerDown = (e: PointerEvent) => {
      // Middle-click, right-click avoided, or primary with alt/space. For
      // simplicity: primary button starts a pan.
      if (e.button !== 0 && e.button !== 1) return;
      dragging = true;
      startX = e.clientX;
      startY = e.clientY;
      setPan(p => {
        startPan = p;
        return p;
      });
      vp.setPointerCapture(e.pointerId);
      vp.style.cursor = 'grabbing';
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!dragging) return;
      setPan({
        x: startPan.x + (e.clientX - startX),
        y: startPan.y + (e.clientY - startY),
      });
    };
    const onPointerUp = (e: PointerEvent) => {
      if (!dragging) return;
      dragging = false;
      try { vp.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
      vp.style.cursor = '';
    };

    vp.addEventListener('pointerdown', onPointerDown);
    vp.addEventListener('pointermove', onPointerMove);
    vp.addEventListener('pointerup', onPointerUp);
    vp.addEventListener('pointercancel', onPointerUp);
    return () => {
      vp.removeEventListener('pointerdown', onPointerDown);
      vp.removeEventListener('pointermove', onPointerMove);
      vp.removeEventListener('pointerup', onPointerUp);
      vp.removeEventListener('pointercancel', onPointerUp);
    };
  }, []);

  // Draw the canvas content — INCREMENTALLY when possible
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = turtle.canvasWidth;
    const h = turtle.canvasHeight;

    // Detect conditions that require a full repaint
    const sizeChanged =
      lastCanvasSizeRef.current.w !== w ||
      lastCanvasSizeRef.current.h !== h;
    const colorChanged = lastCanvasColorRef.current !== turtle.canvasColor;
    const drawingsReplaced =
      lastDrawingsRef.current !== drawings &&
      // array reference changed AND it's not a superset of what we drew
      (drawings.length < drawnCountRef.current ||
        (lastDrawingsRef.current === null));

    // Only resize the canvas if dimensions changed (resizing clears it and is
    // expensive; doing it every render was a big perf cost).
    if (sizeChanged) {
      canvas.width = w;
      canvas.height = h;
      lastCanvasSizeRef.current = { w, h };
    }

    const needFullRepaint = sizeChanged || colorChanged || drawingsReplaced;

    if (needFullRepaint) {
      ctx.fillStyle = turtle.canvasColor;
      ctx.fillRect(0, 0, w, h);
      lastCanvasColorRef.current = turtle.canvasColor;
      renderCommands(ctx, w, h, turtle.canvasColor, drawings, 0, drawings.length);
      drawnCountRef.current = drawings.length;
    } else if (drawings.length > drawnCountRef.current) {
      // Happy path during animation: only draw the new commands appended
      // since last render. O(delta) instead of O(n).
      renderCommands(
        ctx,
        w,
        h,
        turtle.canvasColor,
        drawings,
        drawnCountRef.current,
        drawings.length,
      );
      drawnCountRef.current = drawings.length;
    }

    lastDrawingsRef.current = drawings;
  }, [turtle.canvasWidth, turtle.canvasHeight, turtle.canvasColor, drawings]);

  // Draw the turtle sprite — now a cheap clearRect + drawImage of a cached bitmap
  useEffect(() => {
    const canvas = turtleRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = turtle.canvasWidth;
    const h = turtle.canvasHeight;

    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    } else {
      ctx.clearRect(0, 0, w, h);
    }

    if (!turtle.visible) return;

    const sprite = getTurtleSprite();
    ctx.save();
    ctx.translate(turtle.x, turtle.y);
    ctx.rotate((turtle.angle * Math.PI) / 180);
    ctx.drawImage(sprite, -SPRITE_SIZE / 2, -SPRITE_SIZE / 2);
    ctx.restore();
  }, [turtle]);

  const w = turtle.canvasWidth;
  const h = turtle.canvasHeight;
  const totalScale = effectiveZoom;

  // Checkerboard pattern for "outside-the-canvas" area — gives a visual
  // sense of infinite space and matches classic image-editor conventions.
  const backgroundStyle = useMemo<React.CSSProperties>(
    () => ({
      backgroundImage:
        'linear-gradient(45deg, #f0ece2 25%, transparent 25%), linear-gradient(-45deg, #f0ece2 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #f0ece2 75%), linear-gradient(-45deg, transparent 75%, #f0ece2 75%)',
      backgroundSize: '20px 20px',
      backgroundPosition: '0 0, 0 10px, 10px -10px, -10px 0',
      backgroundColor: '#faf8f4',
    }),
    [],
  );

  return (
    <div ref={containerRef} className="w-full h-full relative" style={{ minHeight: 0 }}>
      <div
        ref={viewportRef}
        className="absolute inset-0 overflow-hidden cursor-grab touch-none"
        style={{ ...backgroundStyle, contain: 'strict' }}
      >
        {/* Canvas stage positioned via pan/zoom */}
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: w,
            height: h,
            transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${totalScale})`,
            transformOrigin: '0 0',
            boxShadow:
              '0 0 0 1px rgba(228, 223, 210, 0.9), 0 18px 60px -24px rgba(26, 24, 20, 0.25)',
            background: turtle.canvasColor || '#ffffff',
            willChange: 'transform',
          }}
        >
          <canvas
            ref={canvasRef}
            style={{
              width: w,
              height: h,
              position: 'absolute',
              top: 0,
              left: 0,
              imageRendering: totalScale >= 4 ? 'pixelated' : 'auto',
            }}
          />
          <canvas
            ref={turtleRef}
            style={{
              width: w,
              height: h,
              position: 'absolute',
              top: 0,
              left: 0,
            }}
          />
        </div>
      </div>
    </div>
  );
});

// Memoized so sibling re-renders (toolbar, editor, etc.) during a run don't
// force the canvas to re-run its draw effect with identical props.
export const TurtleCanvas = memo(TurtleCanvasImpl);
