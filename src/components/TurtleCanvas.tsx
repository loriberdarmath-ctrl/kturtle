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
  /**
   * The interpreter's draw-commands array. May contain more items than
   * `drawingsLen` — we only render up to `drawingsLen`. Passing the live
   * reference (instead of slicing on every frame) is what keeps big
   * programs smooth: an O(n) slice per rAF was the dominant cost before.
   */
  drawings: DrawCommand[];
  /**
   * Committed length of `drawings` for this render. When omitted we fall
   * back to the full array length — preserves the earlier API for any
   * caller that hasn't adopted the two-prop contract.
   */
  drawingsLen?: number;
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
  /**
   * Imperative per-frame update used by the interpreter rAF loop.
   *
   * The React-state path (props → effect → draw) is intentionally
   * bypassed during a run. Going through `setTurtle` / `setDrawings`
   * forces App.tsx to re-render its entire subtree (header, editor,
   * inspector) at 60Hz — on a long program that dominates the frame
   * budget even though most of those children are memoized, because
   * React still has to diff them.
   *
   * This method paints directly to the two canvases using the refs
   * inside the component. It writes no React state, skips memo
   * comparisons on sibling components, and keeps the internal
   * "how much did we already draw" counter in sync so that when a
   * normal prop-driven render eventually happens again (e.g. after
   * the run ends) it picks up seamlessly.
   */
  renderFrame: (turtle: TurtleState, drawings: DrawCommand[], drawingsLen: number) => void;
  /**
   * Clear the imperative "live inputs" cache — call after a run has
   * completed and React props represent the authoritative state again.
   * Without this, a later user-driven re-paint (zoom, resize) would
   * mistakenly prefer stale live data over the new props.
   */
  endRun: () => void;
}

// Offscreen turtle sprite (rendered once, reused). The sprite canvas is small
// (SPRITE_SIZE × SPRITE_SIZE) so per-frame turtle updates only need a clear +
// drawImage + rotate, not a re-draw of dozens of paths on a huge canvas.
//
// The sprite is rasterized at DRAW_SIZE but the backing bitmap is 2× that
// (devicePixelRatio-like oversampling) so the turtle stays crisp when the
// user zooms in. DRAW_SIZE = 24 matches the final visual size on the canvas;
// we upload at 48 so we effectively have "@2x" supersampling for free.
const DRAW_SIZE = 24;
const SPRITE_SIZE = DRAW_SIZE * 2;
// URL of the official KTurtle logo asset. import.meta.env.BASE_URL lets the
// app be served from a subpath (e.g. /kturtle/) without breaking the
// sprite — same trick used for the header logo.
const LOGO_URL = `${import.meta.env.BASE_URL}kturtle-logo.svg`;

let spriteCache: HTMLCanvasElement | null = null;
let spriteLoading = false;
/** Fires each time a fresh sprite has been rasterized. Components can
 *  subscribe to repaint themselves once the SVG finishes decoding.  */
const spriteListeners = new Set<() => void>();

function subscribeSprite(cb: () => void): () => void {
  spriteListeners.add(cb);
  return () => spriteListeners.delete(cb);
}

/**
 * Returns the cached rasterized turtle sprite, or `null` if it's still
 * loading. Loading is triggered lazily on the first call.
 *
 * The sprite is the official KTurtle logo (File:KTurtle_logo.svg on
 * Wikimedia Commons, a 256×256 square facing up). We rasterize it to a
 * 48×48 offscreen canvas so per-frame turtle draws stay a cheap
 * drawImage + rotate — matching the cost of the hand-drawn sprite this
 * replaces.
 */
function getTurtleSprite(): HTMLCanvasElement | null {
  if (spriteCache) return spriteCache;
  if (!spriteLoading) {
    spriteLoading = true;
    const img = new Image();
    // Works even on file:// and through vite's dev server. No crossOrigin
    // needed because /public assets are same-origin.
    img.decoding = 'async';
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = SPRITE_SIZE;
      c.height = SPRITE_SIZE;
      const ctx = c.getContext('2d');
      if (!ctx) return;
      // Rasterize with high-quality smoothing — the SVG has anti-aliased
      // edges + a gradient fill, so we want subpixel sampling.
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, SPRITE_SIZE, SPRITE_SIZE);
      spriteCache = c;
      // Wake up any mounted canvas so it redraws with the real sprite.
      for (const cb of spriteListeners) cb();
    };
    img.onerror = () => {
      // Fall back silently — if the asset is missing for some reason,
      // the turtle just won't show; drawings still render fine.
      spriteLoading = false;
    };
    img.src = LOGO_URL;
  }
  return null;
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

// How aggressively the backing bitmap follows the visual zoom. The canvas
// stores its content as a raster: if we only render at logical size and CSS
// scales it up, zooming in reveals chunky pixels. To stay crisp we match the
// bitmap size to `effectiveZoom × devicePixelRatio`, capped at RENDER_SCALE_CAP
// so a user who zooms to 40× doesn't allocate a gigapixel backbuffer.
//
// We also bucket the render scale to powers of √2 so a small wheel nudge
// doesn't trigger a full repaint every frame — a full repaint of a long
// drawing is what caused the original "laggy on big programs + zoom" feel.
const RENDER_SCALE_CAP = 8;
const RENDER_SCALE_MIN = 1;
function bucketRenderScale(visualScale: number): number {
  const dpr = typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1;
  const target = Math.max(RENDER_SCALE_MIN, Math.min(RENDER_SCALE_CAP, visualScale * dpr));
  // Bucket to the next power of √2 (≈ 1.414). That's tight enough that a
  // 2× zoom always finds a higher-fidelity bucket, but loose enough that
  // continuous pinching doesn't trigger a full repaint on every frame.
  const step = Math.SQRT2;
  const bucket = Math.pow(step, Math.ceil(Math.log(target) / Math.log(step)));
  return Math.max(RENDER_SCALE_MIN, Math.min(RENDER_SCALE_CAP, bucket));
}

const TurtleCanvasImpl = forwardRef<TurtleCanvasHandle, TurtleCanvasProps>(
  ({ turtle, drawings, drawingsLen, externalScale = 1, onZoomChange }, ref) => {
  // Effective command count. When the caller omits `drawingsLen` we fall
  // back to array length (legacy behaviour). When present, it acts as a
  // version counter — letting App.tsx commit the same array reference on
  // every frame without slicing while still triggering a render here.
  const dLen = drawingsLen ?? drawings.length;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const turtleRef = useRef<HTMLCanvasElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);

  // Internal zoom and pan (in viewport pixels). We compose externalScale
  // (from UI slider) with zoom for the final visual scale.
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });

  // Bumps once the rasterized turtle sprite is ready. Included in the
  // sprite-drawing effect's dep list so the very first paint happens as
  // soon as the SVG asset finishes decoding (typically <50ms on a 3 KB
  // file). After that the dep stops changing so it adds no overhead.
  const [spriteTick, setSpriteTick] = useState(0);
  useEffect(() => {
    // Kick off the load eagerly; no-op if already cached.
    getTurtleSprite();
    return subscribeSprite(() => setSpriteTick(t => t + 1));
  }, []);

  // Incremental draw state
  const drawnCountRef = useRef(0);
  const lastCanvasSizeRef = useRef({ w: 0, h: 0 });
  const lastCanvasColorRef = useRef('');
  const lastDrawingsRef = useRef<DrawCommand[] | null>(null);
  const lastRenderScaleRef = useRef(1);
  // Snapshot of the last turtle sprite state we painted. The imperative
  // `renderFrame` path compares against this to skip redundant sprite
  // redraws when only the pen color or non-spatial state changed.
  const lastSpriteRef = useRef({ x: 0, y: 0, angle: 0, visible: false });
  // Current renderScale kept as a ref so the imperative path can read it
  // without forcing a React re-render when it changes.
  const renderScaleRef = useRef(1);
  /** Latest live inputs from the imperative `renderFrame` path. While a
   *  run is active the React-state `drawings`/`turtle` props are stale
   *  (they're reset to empty at run start and only resynced at run end);
   *  reading them in the prop-driven effect would wipe the canvas. So
   *  we keep the live copy here and let the effect fall back to it
   *  when an unrelated dep (zoom/render-scale/canvas size) fires. */
  const liveInputsRef = useRef<{
    turtle: TurtleState;
    drawings: DrawCommand[];
    drawingsLen: number;
  } | null>(null);

  const effectiveZoom = zoom * externalScale;

  // Bucketed supersampling factor — drives canvas bitmap resolution so
  // zooming in doesn't pixelate the drawing. Updated only when the bucket
  // changes (not on every tiny zoom tick), and that bucket change is what
  // forces the one expensive full repaint; in between, zoom just scales the
  // already-crisp bitmap via CSS.
  const [renderScale, setRenderScale] = useState(() => bucketRenderScale(1));
  useEffect(() => {
    const target = bucketRenderScale(effectiveZoom);
    setRenderScale(prev => (prev === target ? prev : target));
  }, [effectiveZoom]);
  // Mirror into a ref so the imperative `renderFrame` path can see the
  // current scale without going through a React commit.
  useEffect(() => { renderScaleRef.current = renderScale; }, [renderScale]);

  // Core drawing routine — pure function of the current refs + inputs.
  // Called from both the effect-driven React path and the imperative
  // per-frame path. Kept as a stable callback so neither caller has to
  // worry about identity-based re-subscriptions.
  const paintDrawings = useCallback((
    turtleState: TurtleState,
    drawingsArr: DrawCommand[],
    drawingsLength: number,
  ) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = turtleState.canvasWidth;
    const h = turtleState.canvasHeight;
    const rs = renderScaleRef.current;
    const bmpW = Math.max(1, Math.round(w * rs));
    const bmpH = Math.max(1, Math.round(h * rs));

    const sizeChanged =
      lastCanvasSizeRef.current.w !== w ||
      lastCanvasSizeRef.current.h !== h;
    const colorChanged = lastCanvasColorRef.current !== turtleState.canvasColor;
    const scaleChanged = lastRenderScaleRef.current !== rs;
    const drawingsReplaced =
      lastDrawingsRef.current !== drawingsArr &&
      (drawingsLength < drawnCountRef.current || lastDrawingsRef.current === null);

    if (sizeChanged || scaleChanged) {
      canvas.width = bmpW;
      canvas.height = bmpH;
      lastCanvasSizeRef.current = { w, h };
      lastRenderScaleRef.current = rs;
    }

    const needFullRepaint = sizeChanged || colorChanged || scaleChanged || drawingsReplaced;

    ctx.setTransform(rs, 0, 0, rs, 0, 0);

    if (needFullRepaint) {
      ctx.fillStyle = turtleState.canvasColor;
      ctx.fillRect(0, 0, w, h);
      lastCanvasColorRef.current = turtleState.canvasColor;
      renderCommands(ctx, w, h, turtleState.canvasColor, drawingsArr, 0, drawingsLength);
      drawnCountRef.current = drawingsLength;
    } else if (drawingsLength > drawnCountRef.current) {
      renderCommands(
        ctx, w, h, turtleState.canvasColor,
        drawingsArr, drawnCountRef.current, drawingsLength,
      );
      drawnCountRef.current = drawingsLength;
    }

    lastDrawingsRef.current = drawingsArr;
  }, []);

  // Paint just the turtle sprite layer. Pure function of turtleState.
  const paintSprite = useCallback((turtleState: TurtleState) => {
    const canvas = turtleRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = turtleState.canvasWidth;
    const h = turtleState.canvasHeight;
    const rs = renderScaleRef.current;
    const bmpW = Math.max(1, Math.round(w * rs));
    const bmpH = Math.max(1, Math.round(h * rs));

    if (canvas.width !== bmpW || canvas.height !== bmpH) {
      canvas.width = bmpW;
      canvas.height = bmpH;
    } else {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, bmpW, bmpH);
    }

    if (!turtleState.visible) {
      lastSpriteRef.current = {
        x: turtleState.x, y: turtleState.y,
        angle: turtleState.angle, visible: false,
      };
      return;
    }

    const sprite = getTurtleSprite();
    if (!sprite) return;

    ctx.setTransform(rs, 0, 0, rs, 0, 0);
    ctx.save();
    ctx.translate(turtleState.x, turtleState.y);
    ctx.rotate((turtleState.angle * Math.PI) / 180);
    ctx.drawImage(sprite, -DRAW_SIZE / 2, -DRAW_SIZE / 2, DRAW_SIZE, DRAW_SIZE);
    ctx.restore();

    lastSpriteRef.current = {
      x: turtleState.x, y: turtleState.y,
      angle: turtleState.angle, visible: turtleState.visible,
    };
  }, []);

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

  // Refit when the viewport itself resizes — phone rotation, split-pane
  // drag, or mobile tab switch from hidden → visible where the layout box
  // only just got its dimensions. We remember whether the user has
  // manually panned/zoomed via a ref so we don't overwrite their view on
  // every tiny size change.
  const userAdjustedRef = useRef(false);
  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    let lastW = vp.clientWidth;
    let lastH = vp.clientHeight;
    const ro = new ResizeObserver(() => {
      const w = vp.clientWidth;
      const h = vp.clientHeight;
      if (w === lastW && h === lastH) return;
      lastW = w;
      lastH = h;
      // Only auto-refit if the user hasn't taken over the view (first
      // wheel / drag / pinch flips userAdjustedRef). Otherwise we'd
      // fight their zoom every time they nudge the split-pane.
      if (!userAdjustedRef.current) {
        const z = computeFitZoom();
        setZoom(z);
        setPan(centerPan(z));
      }
    });
    ro.observe(vp);
    return () => ro.disconnect();
  }, [computeFitZoom, centerPan]);

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
        // "Reset" is the user's explicit opt-back-in to auto-fit, so
        // we clear the manual-adjustment flag — from here on, layout
        // changes (phone rotation, split drag) will re-fit again.
        userAdjustedRef.current = false;
        const z = computeFitZoom();
        setZoom(z);
        setPan(centerPan(z));
      },
      fitToScreen: () => {
        userAdjustedRef.current = false;
        const z = computeFitZoom();
        setZoom(z);
        setPan(centerPan(z));
      },
      zoomIn: () => {
        userAdjustedRef.current = true;
        setZoom(z => Math.min(MAX_ZOOM, z * 1.2));
      },
      zoomOut: () => {
        userAdjustedRef.current = true;
        setZoom(z => Math.max(MIN_ZOOM, z / 1.2));
      },
      getZoom: () => effectiveZoom,
      renderFrame: (ts, d, dl) => {
        // Imperative per-frame update used during a run. Paints both
        // canvases without triggering any React state update, so the
        // rest of the app (toolbar, editor, inspector, split panes)
        // doesn't re-render 60× a second just because the turtle moved.
        liveInputsRef.current = { turtle: ts, drawings: d, drawingsLen: dl };
        paintDrawings(ts, d, dl);
        paintSprite(ts);
      },
      endRun: () => {
        // Props are now the authoritative state — drop the live cache
        // so subsequent zoom/resize repaints read the props.
        liveInputsRef.current = null;
      },
    }),
    [computeFitZoom, centerPan, effectiveZoom, paintDrawings, paintSprite],
  );

  // ── Wheel-to-zoom (zooms to cursor, like Figma/Photoshop). Wheel events
  // over the canvas are always captured so the page doesn't scroll while
  // the user is zooming. Any wheel inside the viewport zooms.
  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      userAdjustedRef.current = true;
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

  // ── Pan + pinch-zoom (unified pointer handling).
  //
  // Gesture model:
  //   • 1 pointer down  → pan      (mouse primary, trackpad tap-drag, 1-finger touch)
  //   • 2 pointers down → pinch    (zoom around midpoint + pan with midpoint)
  //   • extra pointers  → ignored  (keeps palms/3rd fingers from breaking the gesture)
  //
  // All touch gestures are captured so Safari/Chrome never try to scroll
  // the page while the user is manipulating the canvas. touch-action: none
  // on the viewport element in JSX is what makes this reliable on iOS.
  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;

    // Active pointers, keyed by pointerId. Map keeps insertion order so
    // the first two we see are "primary" and "secondary" for pinch math.
    const pointers = new Map<number, { x: number; y: number }>();

    // Pan state (single-pointer drag)
    let panning = false;
    let panStartClient = { x: 0, y: 0 };
    let panStartValue = { x: 0, y: 0 };

    // Pinch state (two-pointer)
    let pinching = false;
    let pinchStartDist = 0;
    let pinchStartMid = { x: 0, y: 0 };
    let pinchStartZoom = 1;
    let pinchStartPan = { x: 0, y: 0 };

    const first = () => {
      const it = pointers.values();
      const a = it.next().value;
      const b = it.next().value;
      return { a, b };
    };

    const dist = (a: { x: number; y: number }, b: { x: number; y: number }) =>
      Math.hypot(a.x - b.x, a.y - b.y);

    const midpoint = (a: { x: number; y: number }, b: { x: number; y: number }) => ({
      x: (a.x + b.x) / 2,
      y: (a.y + b.y) / 2,
    });

    const beginPinch = () => {
      const { a, b } = first();
      if (!a || !b) return;
      pinching = true;
      panning = false;
      pinchStartDist = Math.max(1, dist(a, b));
      pinchStartMid = midpoint(a, b);
      setZoom(z => {
        pinchStartZoom = z;
        return z;
      });
      setPan(p => {
        pinchStartPan = p;
        return p;
      });
    };

    const beginPan = (x: number, y: number) => {
      panning = true;
      pinching = false;
      panStartClient = { x, y };
      setPan(p => {
        panStartValue = p;
        return p;
      });
      vp.style.cursor = 'grabbing';
    };

    const onPointerDown = (e: PointerEvent) => {
      // Ignore right-click (context menu) and anything past two pointers
      // so a third finger doesn't restart the gesture mid-pinch.
      if (e.button === 2) return;
      if (pointers.size >= 2) return;

      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      try { vp.setPointerCapture(e.pointerId); } catch { /* ignore */ }

      if (pointers.size === 2) {
        beginPinch();
      } else {
        beginPan(e.clientX, e.clientY);
      }
      userAdjustedRef.current = true;
      // Prevent iOS/Android from treating this as a scroll gesture.
      e.preventDefault();
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (pinching && pointers.size >= 2) {
        const { a, b } = first();
        if (!a || !b) return;
        const rect = vp.getBoundingClientRect();
        const d = Math.max(1, dist(a, b));
        const mid = midpoint(a, b);
        const ratio = d / pinchStartDist;
        const newZoom = Math.min(
          MAX_ZOOM,
          Math.max(MIN_ZOOM, pinchStartZoom * ratio),
        );
        // Pinch math: keep the world-point originally under the pinch's
        // midpoint locked under the *current* midpoint. That gives both
        // scale-around-midpoint AND two-finger-drag panning in one formula.
        //   worldUnderStart = (pinchStartMid - rect - pinchStartPan) / (pinchStartZoom * sx)
        //   newPan = currentMid - rect - worldUnderStart * (newZoom * sx)
        const sx = externalScale;
        const worldX = (pinchStartMid.x - rect.left - pinchStartPan.x) / (pinchStartZoom * sx);
        const worldY = (pinchStartMid.y - rect.top - pinchStartPan.y) / (pinchStartZoom * sx);
        setZoom(newZoom);
        setPan({
          x: mid.x - rect.left - worldX * newZoom * sx,
          y: mid.y - rect.top - worldY * newZoom * sx,
        });
      } else if (panning) {
        setPan({
          x: panStartValue.x + (e.clientX - panStartClient.x),
          y: panStartValue.y + (e.clientY - panStartClient.y),
        });
      }
    };

    const onPointerUp = (e: PointerEvent) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.delete(e.pointerId);
      try { vp.releasePointerCapture(e.pointerId); } catch { /* ignore */ }

      if (pointers.size === 1 && pinching) {
        // Dropped from 2 → 1 finger: convert to a pan from the remaining
        // pointer's current position so the view doesn't jump.
        pinching = false;
        const { a } = first();
        if (a) beginPan(a.x, a.y);
      } else if (pointers.size === 0) {
        pinching = false;
        panning = false;
        vp.style.cursor = '';
      }
    };

    vp.addEventListener('pointerdown', onPointerDown, { passive: false });
    vp.addEventListener('pointermove', onPointerMove, { passive: false });
    vp.addEventListener('pointerup', onPointerUp);
    vp.addEventListener('pointercancel', onPointerUp);
    vp.addEventListener('pointerleave', onPointerUp);
    // Disable the browser's native gesture handling on iOS.
    const blockGesture = (e: Event) => e.preventDefault();
    vp.addEventListener('gesturestart', blockGesture as EventListener);
    vp.addEventListener('gesturechange', blockGesture as EventListener);
    vp.addEventListener('gestureend', blockGesture as EventListener);
    return () => {
      vp.removeEventListener('pointerdown', onPointerDown);
      vp.removeEventListener('pointermove', onPointerMove);
      vp.removeEventListener('pointerup', onPointerUp);
      vp.removeEventListener('pointercancel', onPointerUp);
      vp.removeEventListener('pointerleave', onPointerUp);
      vp.removeEventListener('gesturestart', blockGesture as EventListener);
      vp.removeEventListener('gesturechange', blockGesture as EventListener);
      vp.removeEventListener('gestureend', blockGesture as EventListener);
    };
  }, [externalScale]);

  // React-driven draw: fires on prop / state changes (e.g. run completion,
  // renderScale change from zoom bucket). During a live run the interpreter
  // instead calls `renderFrame` imperatively, bypassing React — see the
  // handle below. Both paths land in the same `paintDrawings` / `paintSprite`
  // routines, so the canvas stays in sync either way.
  //
  // Important: when the user zooms during a run, this effect fires with
  // STALE props (`drawings=[]`, `turtle=initial`) because runCode reset
  // them at run start. Painting those would wipe the canvas. We detect
  // "a run has been painted live since the last prop change" by consulting
  // `liveInputsRef` — if it's fresher than the incoming props, use it.
  useEffect(() => {
    const live = liveInputsRef.current;
    const useLive = live && live.drawingsLen > dLen;
    const ts = useLive ? live!.turtle : turtle;
    const d = useLive ? live!.drawings : drawings;
    const dl = useLive ? live!.drawingsLen : dLen;
    paintDrawings(ts, d, dl);
  }, [
    paintDrawings,
    turtle, turtle.canvasWidth, turtle.canvasHeight, turtle.canvasColor,
    drawings, dLen, renderScale,
  ]);

  useEffect(() => {
    const live = liveInputsRef.current;
    // Prefer live turtle during a run (same reasoning as above — props
    // are reset to the initial state until `runCode` resolves).
    const ts = live ? live.turtle : turtle;
    paintSprite(ts);
  }, [
    paintSprite,
    turtle, turtle.x, turtle.y, turtle.angle, turtle.visible,
    turtle.canvasWidth, turtle.canvasHeight,
    spriteTick, renderScale,
  ]);

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
    <div className="w-full h-full relative" style={{ minHeight: 0 }}>
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
              // With bitmap-side supersampling via `renderScale`, the canvas
              // has enough real pixels to stay crisp at most zoom levels.
              // Only at extreme zoom (beyond our RENDER_SCALE_CAP) does the
              // CSS upscale expose individual pixels — fall back to crisp
              // nearest-neighbour there so it at least looks intentional.
              imageRendering: totalScale > RENDER_SCALE_CAP * 1.5 ? 'pixelated' : 'auto',
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
              imageRendering: totalScale > RENDER_SCALE_CAP * 1.5 ? 'pixelated' : 'auto',
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
