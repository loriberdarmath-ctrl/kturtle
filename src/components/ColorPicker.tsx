import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useT } from '../i18n/context';

/**
 * Modal HSV color picker with:
 *   - Saturation/value square (drag or click)
 *   - Hue slider
 *   - RGB + Hex numeric inputs (live-synced)
 *   - KTurtle command insertion helpers (pencolor / canvascolor)
 *   - Recent colors (persisted in localStorage)
 *
 * Works as a portal-less overlay; caller controls visibility.
 */
export interface ColorPickerProps {
  open: boolean;
  initialColor?: string; // hex, e.g. "#e86a2a"
  onClose: () => void;
  /** Called when the user clicks Insert or hits Enter — inserts code. */
  onInsertCode: (code: string) => void;
  /** Called when the user simply commits a color without inserting. */
  onApply?: (hex: string) => void;
}

const RECENT_KEY = 'kturtle.colorPicker.recent';
const DEFAULT_SWATCHES = [
  '#000000', '#ffffff', '#c85a2a', '#e8896a', '#e6c36a',
  '#9ab897', '#5f7a5a', '#6c8c61', '#3d6b8a', '#5b9bd5',
  '#8c6ba8', '#c06c84', '#f2a65a', '#a49c8c', '#d8d2c1',
  '#1a1814',
];

export function ColorPicker({ open, initialColor = '#c85a2a', onClose, onInsertCode, onApply }: ColorPickerProps) {
  const { t } = useT();
  const [hsv, setHsv] = useState(() => hexToHsv(initialColor));
  const [hexInput, setHexInput] = useState(initialColor);
  const [recent, setRecent] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
    } catch {
      return [];
    }
  });
  const svRef = useRef<HTMLDivElement>(null);

  // When opened, reset state from the latest initial color.
  useEffect(() => {
    if (open) {
      const newHsv = hexToHsv(initialColor);
      setHsv(newHsv);
      setHexInput(initialColor);
    }
  }, [open, initialColor]);

  const currentHex = useMemo(() => hsvToHex(hsv.h, hsv.s, hsv.v), [hsv]);
  const currentRgb = useMemo(() => hexToRgb(currentHex), [currentHex]);

  // Keep the hex input in sync unless the user is actively typing into it.
  useEffect(() => {
    setHexInput(currentHex);
  }, [currentHex]);

  const rememberRecent = useCallback(() => {
    setRecent(prev => {
      const next = [currentHex, ...prev.filter(c => c !== currentHex)].slice(0, 12);
      try {
        localStorage.setItem(RECENT_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, [currentHex]);

  // Update HSV from a pointer event's coordinates relative to the SV square.
  // Used by the inline pointer handlers on the SV div below. Uses React's
  // synthetic PointerEvent so the listeners attach reliably every render —
  // a previous `useEffect`-based approach sometimes bound to a stale null
  // ref when the modal first mounted.
  const updateFromPointer = useCallback((clientX: number, clientY: number) => {
    const el = svRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const x = Math.min(rect.width, Math.max(0, clientX - rect.left));
    const y = Math.min(rect.height, Math.max(0, clientY - rect.top));
    const s = x / rect.width;
    const v = 1 - y / rect.height;
    setHsv(cur => ({ ...cur, s, v }));
  }, []);

  const draggingRef = useRef(false);

  // ESC to close
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const insertPen = () => {
    rememberRecent();
    onInsertCode(`pencolor ${currentRgb.r}, ${currentRgb.g}, ${currentRgb.b}\n`);
    onApply?.(currentHex);
    onClose();
  };
  const insertCanvas = () => {
    rememberRecent();
    onInsertCode(`canvascolor ${currentRgb.r}, ${currentRgb.g}, ${currentRgb.b}\n`);
    onApply?.(currentHex);
    onClose();
  };

  const hueColor = `hsl(${hsv.h * 360}, 100%, 50%)`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-ink-900/30 backdrop-blur-sm anim-fade overflow-y-auto"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={t('color.title')}
    >
      {/*
        Modal layout strategy: the dialog is constrained to 90vh so it never
        exceeds the viewport. The header + footer are fixed (flex-shrink-0)
        and the middle body scrolls independently when content is taller
        than available space (common on short laptop screens / landscape
        phones). This is what was causing the footer to overflow before.
      */}
      <div
        className="surface w-full max-w-[460px] anim-rise flex flex-col max-h-[calc(100vh-1.5rem)] sm:max-h-[min(92vh,720px)] my-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-line flex-shrink-0">
          <h3 className="font-display text-[17px] text-ink-900" style={{ letterSpacing: '-0.01em' }}>
            {t('color.title')}
          </h3>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full hover:bg-paper-soft text-ink-500 hover:text-ink-900 inline-flex items-center justify-center transition-colors"
            aria-label={t('color.cancel')}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-5 space-y-4">
          {/* SV square — pointer-driven saturation/value picker. Click to
              jump, drag to scrub. Pointer capture keeps events flowing even
              if the cursor leaves the square mid-drag. */}
          <div
            ref={svRef}
            onPointerDown={e => {
              e.preventDefault();
              draggingRef.current = true;
              (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
              updateFromPointer(e.clientX, e.clientY);
            }}
            onPointerMove={e => {
              if (!draggingRef.current) return;
              updateFromPointer(e.clientX, e.clientY);
            }}
            onPointerUp={e => {
              draggingRef.current = false;
              try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* ignore */ }
            }}
            onPointerCancel={e => {
              draggingRef.current = false;
              try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* ignore */ }
            }}
            className="relative w-full rounded-lg overflow-hidden border border-line cursor-crosshair select-none"
            style={{
              aspectRatio: '4 / 3',
              background: `linear-gradient(to top, #000 0%, transparent 100%), linear-gradient(to right, #fff 0%, ${hueColor} 100%)`,
              touchAction: 'none',
            }}
          >
            <div
              aria-hidden
              className="absolute pointer-events-none"
              style={{
                left: `${hsv.s * 100}%`,
                top: `${(1 - hsv.v) * 100}%`,
                width: 14,
                height: 14,
                border: '2px solid #fff',
                borderRadius: '50%',
                transform: 'translate(-50%, -50%)',
                boxShadow: '0 0 0 1px rgba(0,0,0,0.35), 0 2px 6px rgba(0,0,0,0.25)',
              }}
            />
          </div>

          {/* Hue slider */}
          <label className="block">
            <span className="text-[11px] uppercase tracking-[0.12em] text-ink-500 mb-1.5 inline-block">
              {t('color.hue')}
            </span>
            <input
              type="range"
              min={0}
              max={360}
              step={1}
              value={Math.round(hsv.h * 360)}
              onChange={e => setHsv(cur => ({ ...cur, h: Number(e.target.value) / 360 }))}
              className="w-full hue-slider"
              style={{
                background:
                  'linear-gradient(to right, #f00 0%, #ff0 17%, #0f0 33%, #0ff 50%, #00f 67%, #f0f 83%, #f00 100%)',
              }}
            />
          </label>

          {/* Numeric inputs: RGB + Hex */}
          <div className="grid grid-cols-4 gap-2">
            <NumField
              label="R"
              value={currentRgb.r}
              onChange={v => {
                const hex = rgbToHex({ r: clamp(v, 0, 255), g: currentRgb.g, b: currentRgb.b });
                setHsv(hexToHsv(hex));
              }}
            />
            <NumField
              label="G"
              value={currentRgb.g}
              onChange={v => {
                const hex = rgbToHex({ r: currentRgb.r, g: clamp(v, 0, 255), b: currentRgb.b });
                setHsv(hexToHsv(hex));
              }}
            />
            <NumField
              label="B"
              value={currentRgb.b}
              onChange={v => {
                const hex = rgbToHex({ r: currentRgb.r, g: currentRgb.g, b: clamp(v, 0, 255) });
                setHsv(hexToHsv(hex));
              }}
            />
            <label className="flex flex-col gap-1">
              <span className="text-[10.5px] uppercase tracking-[0.1em] text-ink-500">{t('color.hex')}</span>
              <input
                value={hexInput}
                onChange={e => setHexInput(e.target.value)}
                onBlur={() => {
                  if (/^#?[0-9a-fA-F]{6}$/.test(hexInput)) {
                    const h = hexInput.startsWith('#') ? hexInput : `#${hexInput}`;
                    setHsv(hexToHsv(h));
                  } else {
                    setHexInput(currentHex);
                  }
                }}
                className="px-2 py-1 text-[12.5px] font-mono border border-line rounded-md outline-none focus:border-accent bg-white"
              />
            </label>
          </div>

          {/* Preview + swatches */}
          <div className="flex items-center gap-3">
            <div
              className="w-12 h-12 rounded-lg border border-line flex-shrink-0"
              style={{ backgroundColor: currentHex }}
              aria-label="Preview"
            />
            <div className="flex-1 grid grid-cols-8 gap-1.5">
              {DEFAULT_SWATCHES.map(hex => (
                <button
                  key={hex}
                  type="button"
                  onClick={() => setHsv(hexToHsv(hex))}
                  className="aspect-square rounded-md border border-line hover:scale-110 transition-transform"
                  style={{ backgroundColor: hex }}
                  aria-label={hex}
                  title={hex}
                />
              ))}
            </div>
          </div>

          {recent.length > 0 && (
            <div>
              <div className="text-[10.5px] uppercase tracking-[0.12em] text-ink-500 mb-1.5">
                {t('color.recent')}
              </div>
              <div className="grid grid-cols-12 gap-1.5">
                {recent.map(hex => (
                  <button
                    key={hex}
                    type="button"
                    onClick={() => setHsv(hexToHsv(hex))}
                    className="aspect-square rounded-md border border-line hover:scale-110 transition-transform"
                    style={{ backgroundColor: hex }}
                    aria-label={hex}
                    title={hex}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer — always pinned at bottom; body scrolls above it. */}
        <div className="px-5 py-3 border-t border-line bg-paper-soft/50 flex flex-wrap gap-2 flex-shrink-0">
          <button
            onClick={insertPen}
            className="inline-flex items-center gap-2 px-3.5 py-2 bg-ink-900 text-paper rounded-full text-[12.5px] font-medium hover:bg-accent transition-colors"
          >
            {t('color.insertPen')}
          </button>
          <button
            onClick={insertCanvas}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-full border border-line bg-white text-ink-800 hover:border-accent hover:text-accent text-[12.5px] font-medium transition-colors"
          >
            {t('color.insertCanvas')}
          </button>
          <button
            onClick={() => {
              navigator.clipboard?.writeText(currentHex);
              rememberRecent();
            }}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-full text-ink-600 hover:text-ink-900 text-[12.5px] transition-colors"
          >
            {t('color.copy')}
          </button>
          <button
            onClick={onClose}
            className="ml-auto inline-flex items-center px-3.5 py-2 text-ink-500 hover:text-ink-900 text-[12.5px]"
          >
            {t('color.cancel')}
          </button>
        </div>
      </div>
    </div>
  );
}

function NumField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10.5px] uppercase tracking-[0.1em] text-ink-500">{label}</span>
      <input
        type="number"
        min={0}
        max={255}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="px-2 py-1 text-[12.5px] font-mono border border-line rounded-md outline-none focus:border-accent bg-white tab-nums"
      />
    </label>
  );
}

// ── Color math helpers ──────────────────────────────────────────────
function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n));
}

interface Rgb { r: number; g: number; b: number }
interface Hsv { h: number; s: number; v: number }

function hexToRgb(hex: string): Rgb {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return { r: 0, g: 0, b: 0 };
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
}

function rgbToHex({ r, g, b }: Rgb): string {
  const h = (n: number) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

function rgbToHsv({ r, g, b }: Rgb): Hsv {
  const rr = r / 255, gg = g / 255, bb = b / 255;
  const max = Math.max(rr, gg, bb), min = Math.min(rr, gg, bb);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === rr) h = ((gg - bb) / d) % 6;
    else if (max === gg) h = (bb - rr) / d + 2;
    else h = (rr - gg) / d + 4;
    h /= 6;
    if (h < 0) h += 1;
  }
  const s = max === 0 ? 0 : d / max;
  const v = max;
  return { h, s, v };
}

function hsvToRgb(h: number, s: number, v: number): Rgb {
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  let r = 0, g = 0, b = 0;
  switch (i % 6) {
    case 0: r = v; g = t; b = p; break;
    case 1: r = q; g = v; b = p; break;
    case 2: r = p; g = v; b = t; break;
    case 3: r = p; g = q; b = v; break;
    case 4: r = t; g = p; b = v; break;
    case 5: r = v; g = p; b = q; break;
  }
  return { r: r * 255, g: g * 255, b: b * 255 };
}

function hexToHsv(hex: string): Hsv {
  return rgbToHsv(hexToRgb(hex));
}

function hsvToHex(h: number, s: number, v: number): string {
  return rgbToHex(hsvToRgb(h, s, v));
}
