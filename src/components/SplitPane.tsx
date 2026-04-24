import {
  ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

/**
 * Two-pane horizontal splitter with a draggable divider. Designed to be
 * nested (pane2 of the outer split is another SplitPane for a 3-column
 * layout). Sizes persist to localStorage under `storageKey`.
 *
 *   |------- pane1 -------||-------- pane2 --------|
 *                       drag
 *
 * Invariants:
 *   - Each pane respects `min1`/`min2` in pixels
 *   - The fraction is stored, so sizes scale with the window
 *   - Keyboard: ←/→ on the handle moves 16px; Home/End snap to 20/80
 */
interface SplitPaneProps {
  children: [ReactNode, ReactNode];
  /** Initial split as a fraction (0..1) of first pane. */
  defaultFraction?: number;
  min1?: number;
  min2?: number;
  storageKey?: string;
  className?: string;
  /** ARIA label for the resize handle. */
  handleLabel?: string;
}

export function SplitPane({
  children,
  defaultFraction = 0.5,
  min1 = 220,
  min2 = 220,
  storageKey,
  className = '',
  handleLabel = 'Resize',
}: SplitPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [fraction, setFraction] = useState<number>(() => {
    if (!storageKey) return defaultFraction;
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const f = parseFloat(raw);
        if (!isNaN(f) && f > 0.05 && f < 0.95) return f;
      }
    } catch {
      /* ignore */
    }
    return defaultFraction;
  });
  const [dragging, setDragging] = useState(false);

  // Persist fraction (debounced-ish via effect) so quick drags don't write
  // on every frame.
  useEffect(() => {
    if (!storageKey || dragging) return;
    try {
      localStorage.setItem(storageKey, String(fraction));
    } catch {
      /* ignore */
    }
  }, [fraction, dragging, storageKey]);

  const applyDelta = useCallback(
    (clientX: number) => {
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const total = rect.width;
      if (total <= 0) return;
      const rawPx = clientX - rect.left;
      // Enforce min sizes as fractions of total
      const minF1 = min1 / total;
      const minF2 = min2 / total;
      const newF = Math.min(1 - minF2, Math.max(minF1, rawPx / total));
      setFraction(newF);
    },
    [min1, min2],
  );

  // Pointer-based dragging — works with mouse, touch, and pen.
  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: PointerEvent) => {
      e.preventDefault();
      applyDelta(e.clientX);
    };
    const onUp = () => setDragging(false);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    // Disable selection + change cursor while dragging
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [dragging, applyDelta]);

  // If the window resizes below the min widths of either pane, nudge the
  // fraction back into the valid range on the next frame.
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const total = el.clientWidth;
      if (total <= 0) return;
      const minF1 = min1 / total;
      const minF2 = min2 / total;
      if (fraction < minF1) setFraction(Math.min(minF1, 1 - minF2));
      else if (fraction > 1 - minF2) setFraction(Math.max(minF1, 1 - minF2));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [fraction, min1, min2]);

  const onKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const el = containerRef.current;
    if (!el) return;
    const total = el.clientWidth;
    if (total <= 0) return;
    const step = 16 / total;
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      setFraction(f => Math.max(min1 / total, f - step));
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      setFraction(f => Math.min(1 - min2 / total, f + step));
    } else if (e.key === 'Home') {
      e.preventDefault();
      setFraction(Math.max(min1 / total, 0.2));
    } else if (e.key === 'End') {
      e.preventDefault();
      setFraction(Math.min(1 - min2 / total, 0.8));
    }
  };

  return (
    <div
      ref={containerRef}
      className={`flex w-full h-full relative ${className}`}
      style={{ minHeight: 0 }}
    >
      <div style={{ width: `${fraction * 100}%`, minWidth: 0 }} className="h-full flex flex-col">
        {children[0]}
      </div>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={handleLabel}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(fraction * 100)}
        tabIndex={0}
        onPointerDown={e => {
          (e.target as Element).setPointerCapture?.(e.pointerId);
          setDragging(true);
        }}
        onKeyDown={onKey}
        className={`relative z-10 cursor-col-resize select-none flex-shrink-0 group ${
          dragging ? 'bg-accent/30' : 'bg-transparent'
        }`}
        style={{ width: 6, margin: '0 -3px' }}
      >
        {/* Visible rail — a thin line with a subtle highlight on hover */}
        <div
          className={`absolute inset-y-0 left-1/2 -translate-x-1/2 transition-colors ${
            dragging ? 'bg-accent' : 'bg-line group-hover:bg-accent/60'
          }`}
          style={{ width: 1 }}
        />
        {/* Grip dots, centered */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col gap-[3px] opacity-0 group-hover:opacity-100 transition-opacity">
          <span className="w-1 h-1 rounded-full bg-ink-400" />
          <span className="w-1 h-1 rounded-full bg-ink-400" />
          <span className="w-1 h-1 rounded-full bg-ink-400" />
        </div>
      </div>
      <div style={{ width: `${(1 - fraction) * 100}%`, minWidth: 0 }} className="h-full flex flex-col">
        {children[1]}
      </div>
    </div>
  );
}
