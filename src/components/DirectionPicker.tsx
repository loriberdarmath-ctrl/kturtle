import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useT } from '../i18n/context';

/**
 * Direction Chooser — a refined, editorial reimagining of KTurtle's
 * legacy "Direction Chooser" dialog.
 *
 * Design intent
 * -------------
 * The original Qt dialog is a utilitarian plot: a tiny circle, four cardinal
 * labels in a sans-serif, two stiff spinboxes, two grey buttons. We keep the
 * mental model (an angular dial that snaps the user out of degree-counting)
 * but treat it like a compass instrument from a printed atlas:
 *
 *   • Cream paper background with a faint ink-grain compass wheel.
 *   • Serif numerals on the cardinal points (00, 90, 180, 270) so the
 *     bearing reads as a typographic mark, not a label.
 *   • A "previous" needle in muted ink and a "new" needle in the brand
 *     accent, both with hairline tips and small ringed pivots — the dial
 *     becomes a navigational drawing rather than a UI widget.
 *   • Drag the needle directly to set the new bearing, or tap any of the
 *     8 hash-mark detents to snap. Holding Shift snaps to 5°.
 *   • The generated KTurtle command is rendered in a code-style chip on
 *     the left so the user sees the round-trip from compass → text.
 *
 * Behaviour parity with KDE KTurtle
 * ---------------------------------
 *   • turnleft  N   — rotates the turtle counter-clockwise by N degrees
 *   • turnright N   — rotates the turtle clockwise by N degrees
 *   • direction N   — sets the absolute heading
 *
 * Like the original, the "command type" selector chooses whether the
 * delta is computed (turnleft / turnright) or whether the absolute new
 * heading is emitted (direction). The previous heading defaults to the
 * turtle's live angle but can be edited.
 */
export interface DirectionPickerProps {
  open: boolean;
  /** Live turtle heading in degrees (0 = up, clockwise). */
  initialAngle?: number;
  onClose: () => void;
  /** Insert generated code at the editor caret. */
  onInsertCode: (code: string) => void;
}

type CmdType = 'turnleft' | 'turnright' | 'direction';

const HASH_ANGLES = [0, 45, 90, 135, 180, 225, 270, 315];

const norm = (deg: number) => {
  let d = deg % 360;
  if (d < 0) d += 360;
  return d;
};

/** Compute the delta a turnleft/turnright would need to go from `from` → `to`. */
function deltaFor(type: CmdType, from: number, to: number): number {
  const f = norm(from);
  const t = norm(to);
  if (type === 'turnright') {
    let d = t - f;
    if (d < 0) d += 360;
    return d;
  }
  if (type === 'turnleft') {
    let d = f - t;
    if (d < 0) d += 360;
    return d;
  }
  return t;
}

function buildCommand(type: CmdType, from: number, to: number): string {
  const value = deltaFor(type, from, to);
  const rounded = Math.round(value * 100) / 100;
  const pretty = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2).replace(/\.?0+$/, '');
  return `${type} ${pretty}`;
}

export function DirectionPicker({ open, initialAngle = 0, onClose, onInsertCode }: DirectionPickerProps) {
  const { t } = useT();
  const [cmdType, setCmdType] = useState<CmdType>('turnleft');
  const [prevDir, setPrevDir] = useState(() => Math.round(norm(initialAngle)));
  const [newDir, setNewDir] = useState(() => Math.round(norm(initialAngle + 90)));
  const dialRef = useRef<SVGSVGElement>(null);
  const draggingRef = useRef<'new' | 'prev' | null>(null);

  // Re-seed from the live turtle heading every time the dialog opens.
  useEffect(() => {
    if (open) {
      const a = Math.round(norm(initialAngle));
      setPrevDir(a);
      setNewDir(norm(a + 90));
    }
  }, [open, initialAngle]);

  // Pointer → angle math, in compass space (0 = up, clockwise).
  const pointerToAngle = useCallback((clientX: number, clientY: number, snap5: boolean) => {
    const el = dialRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = clientX - cx;
    const dy = clientY - cy;
    // atan2(y, x) gives mathematical angle (0 = right, CCW). We want
    // 0 = up (negative y) and CW positive, so:
    let a = Math.atan2(dx, -dy) * (180 / Math.PI);
    a = norm(a);
    if (snap5) a = Math.round(a / 5) * 5;
    else a = Math.round(a);
    return a % 360;
  }, []);

  // Global pointer listeners while dragging — outside the SVG so we keep
  // tracking even when the user's finger leaves the dial.
  useEffect(() => {
    if (!open) return;
    const onMove = (e: PointerEvent) => {
      const target = draggingRef.current;
      if (!target) return;
      const a = pointerToAngle(e.clientX, e.clientY, e.shiftKey);
      if (a === null) return;
      if (target === 'new') setNewDir(a);
      else setPrevDir(a);
    };
    const onUp = () => { draggingRef.current = null; };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [open, pointerToAngle]);

  // ESC closes the dialog. Enter inserts.
  const command = useMemo(() => buildCommand(cmdType, prevDir, newDir), [cmdType, prevDir, newDir]);

  const insert = useCallback(() => {
    onInsertCode(command + '\n');
    onClose();
  }, [command, onClose, onInsertCode]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'Enter' && !(e.target instanceof HTMLInputElement && e.target.type === 'number')) {
        insert();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, insert]);

  if (!open) return null;

  // ── Geometry for the SVG dial ──────────────────────────────────────
  // The viewBox is centred at (0, 0) so all coordinates are in compass
  // space. Up = -y, right = +x, clockwise positive. Ranges below are
  // tuned so the legend (00, 90, 180, 270) sits *outside* the wheel.
  const R_OUTER = 96;
  const R_INNER = 78;
  const R_NEEDLE = 70;
  const R_HASH_OUT = 92;
  const R_HASH_IN = 84;

  const angleToXY = (deg: number, r: number) => {
    const rad = ((deg - 90) * Math.PI) / 180;
    return { x: Math.cos(rad) * r, y: Math.sin(rad) * r };
  };

  const newTip = angleToXY(newDir, R_NEEDLE);
  const prevTip = angleToXY(prevDir, R_NEEDLE);

  // Cardinal labels we hand-place outside the wheel. KDE's dialog uses
  // 0 / 90 / 180 / 270; we keep that as it's the canonical grade.
  const cardinals: { deg: number; label: string }[] = [
    { deg: 0,   label: '00'  },
    { deg: 90,  label: '90'  },
    { deg: 180, label: '180' },
    { deg: 270, label: '270' },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-ink-900/30 backdrop-blur-sm anim-fade overflow-hidden"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={t('direction.title')}
      style={{ paddingTop: 'env(safe-area-inset-top)' }}
    >
      <div
        className="anim-pop bg-paper rounded-t-2xl sm:rounded-2xl shadow-paper border border-line w-full sm:max-w-[640px] max-h-[100dvh] sm:max-h-[92dvh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
        style={{ fontFamily: 'var(--font-sans)' }}
      >
        {/* ── Header ─────────────────────────────────────────────── */}
        <div className="px-5 pt-5 pb-3 flex items-baseline gap-3 flex-shrink-0">
          <h2
            className="text-[18px] tracking-tight text-ink-900"
            style={{ fontFamily: 'var(--font-serif)' }}
          >
            {t('direction.title')}
          </h2>
          <span className="text-[10.5px] uppercase tracking-[0.2em] text-ink-400">
            {t('direction.subtitle')}
          </span>
          <button
            onClick={onClose}
            aria-label={t('color.cancel')}
            className="ml-auto -mr-1 w-8 h-8 inline-flex items-center justify-center rounded-full text-ink-400 hover:text-ink-900 hover:bg-paper-soft transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M2 2 L12 12 M12 2 L2 12" />
            </svg>
          </button>
        </div>

        <div className="px-5 pb-2 flex-1 overflow-y-auto">
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_220px] gap-5 items-start">

            {/* ── Compass dial ─────────────────────────────────────── */}
            <div className="relative mx-auto w-full max-w-[300px] aspect-square select-none">
              {/* Paper grain ring backdrop, drawn with subtle conic gradient
                  to evoke an etched compass face without the busyness. */}
              <div
                aria-hidden
                className="absolute inset-0 rounded-full"
                style={{
                  background:
                    'radial-gradient(circle at 50% 45%, #fbf6e8 0%, #f4ecd6 60%, #ede2c0 100%)',
                  boxShadow:
                    'inset 0 0 0 1px rgba(120,108,86,0.2), inset 0 -8px 30px -8px rgba(120,108,86,0.18), 0 8px 30px -16px rgba(26,24,20,0.18)',
                }}
              />
              <svg
                ref={dialRef}
                viewBox="-125 -125 250 250"
                className="absolute inset-0 w-full h-full"
                onPointerDown={e => {
                  if (e.target instanceof Element && e.target.closest('[data-handle]')) return;
                  // Bare-dial click: move "new" needle to clicked angle.
                  const a = pointerToAngle(e.clientX, e.clientY, e.shiftKey);
                  if (a === null) return;
                  setNewDir(a);
                  draggingRef.current = 'new';
                  (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
                }}
              >
                {/* Crosshair gridlines — quartered into the four compass
                    quadrants, hairline weight so the dial reads as drawn
                    rather than chromed. */}
                <g stroke="rgba(120,108,86,0.28)" strokeWidth="0.6">
                  <line x1={-R_OUTER} y1={0} x2={R_OUTER} y2={0} />
                  <line x1={0} y1={-R_OUTER} x2={0} y2={R_OUTER} />
                  <line
                    x1={-R_OUTER * Math.SQRT1_2} y1={-R_OUTER * Math.SQRT1_2}
                    x2={R_OUTER * Math.SQRT1_2}  y2={R_OUTER * Math.SQRT1_2}
                  />
                  <line
                    x1={R_OUTER * Math.SQRT1_2}  y1={-R_OUTER * Math.SQRT1_2}
                    x2={-R_OUTER * Math.SQRT1_2} y2={R_OUTER * Math.SQRT1_2}
                  />
                </g>

                {/* Outer ring */}
                <circle cx={0} cy={0} r={R_OUTER} fill="none" stroke="rgba(60,52,40,0.55)" strokeWidth="1" />
                <circle cx={0} cy={0} r={R_INNER} fill="none" stroke="rgba(120,108,86,0.45)" strokeWidth="0.6" />

                {/* 8 detent hashes */}
                {HASH_ANGLES.map(a => {
                  const o = angleToXY(a, R_HASH_OUT);
                  const i = angleToXY(a, R_HASH_IN);
                  return (
                    <line
                      key={a}
                      x1={i.x} y1={i.y}
                      x2={o.x} y2={o.y}
                      stroke="rgba(60,52,40,0.7)"
                      strokeWidth={a % 90 === 0 ? 1.4 : 0.8}
                      strokeLinecap="round"
                    />
                  );
                })}

                {/* Cardinal numerals — serif so they read like atlas marks. */}
                {cardinals.map(({ deg, label }) => {
                  const p = angleToXY(deg, R_OUTER + 18);
                  return (
                    <text
                      key={deg}
                      x={p.x}
                      y={p.y}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      style={{
                        fontFamily: 'var(--font-serif)',
                        fontSize: 13,
                        fontStyle: 'italic',
                        fill: 'rgba(60,52,40,0.7)',
                        letterSpacing: '0.08em',
                      }}
                    >
                      {label}
                    </text>
                  );
                })}

                {/* Detent dots — clickable affordances at every 45°. */}
                {HASH_ANGLES.map(a => {
                  const p = angleToXY(a, R_INNER - 6);
                  return (
                    <circle
                      key={`d-${a}`}
                      cx={p.x}
                      cy={p.y}
                      r={4}
                      fill="transparent"
                      stroke="transparent"
                      style={{ cursor: 'pointer' }}
                      onPointerDown={e => {
                        e.stopPropagation();
                        setNewDir(a);
                      }}
                    />
                  );
                })}

                {/* Previous-direction needle — muted ink, hairline. */}
                <g style={{ pointerEvents: 'none' }}>
                  <line
                    x1={0} y1={0}
                    x2={prevTip.x} y2={prevTip.y}
                    stroke="rgba(60,52,40,0.55)"
                    strokeWidth="1.4"
                    strokeLinecap="round"
                  />
                  <circle cx={prevTip.x} cy={prevTip.y} r={3.2} fill="rgba(60,52,40,0.7)" />
                </g>

                {/* New-direction needle — accent, draggable. */}
                <g
                  data-handle="new"
                  style={{ cursor: 'grab' }}
                  onPointerDown={e => {
                    e.stopPropagation();
                    draggingRef.current = 'new';
                    const a = pointerToAngle(e.clientX, e.clientY, e.shiftKey);
                    if (a !== null) setNewDir(a);
                  }}
                >
                  {/* invisible hit-area along the needle */}
                  <line
                    x1={0} y1={0}
                    x2={newTip.x} y2={newTip.y}
                    stroke="transparent"
                    strokeWidth="14"
                    strokeLinecap="round"
                  />
                  <line
                    x1={0} y1={0}
                    x2={newTip.x} y2={newTip.y}
                    stroke="var(--color-accent, #c85a2a)"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                  />
                  <circle cx={newTip.x} cy={newTip.y} r={6} fill="var(--color-accent, #c85a2a)" />
                  <circle cx={newTip.x} cy={newTip.y} r={2.4} fill="#fff" />
                </g>

                {/* Pivot pin */}
                <circle cx={0} cy={0} r={5} fill="#fbf6e8" stroke="rgba(60,52,40,0.7)" strokeWidth="1" />
                <circle cx={0} cy={0} r={1.5} fill="rgba(60,52,40,0.7)" />
              </svg>
            </div>

            {/* ── Inputs column ────────────────────────────────────── */}
            <div className="flex flex-col gap-3.5">
              <Field label={t('direction.commandType')}>
                <div className="flex flex-wrap gap-1">
                  {(['turnleft','turnright','direction'] as CmdType[]).map(c => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setCmdType(c)}
                      className={
                        'px-2.5 py-1.5 text-[11.5px] tracking-tight rounded-full border transition-colors ' +
                        (cmdType === c
                          ? 'border-accent text-accent bg-accent-wash'
                          : 'border-line text-ink-700 hover:border-ink-400 hover:text-ink-900')
                      }
                      style={{ fontFamily: 'var(--font-mono)' }}
                    >
                      {c}
                    </button>
                  ))}
                </div>
              </Field>

              <NumberField
                label={t('direction.previous')}
                value={prevDir}
                onChange={v => setPrevDir(norm(v))}
              />
              <NumberField
                label={t('direction.new')}
                value={newDir}
                onChange={v => setNewDir(norm(v))}
              />

              <div className="text-[10.5px] text-ink-400 leading-relaxed">
                {t('direction.hint')}
              </div>
            </div>
          </div>
        </div>

        {/* ── Footer ─────────────────────────────────────────────── */}
        <div className="px-5 py-3 border-t border-line bg-paper-soft/50 flex flex-wrap items-center gap-2 flex-shrink-0">
          <code
            className="px-3 py-1.5 rounded-md border border-line bg-white/60 text-[12.5px] text-ink-800 tab-nums"
            style={{ fontFamily: 'var(--font-mono)' }}
          >
            {command}
          </code>
          <button
            onClick={insert}
            className="ml-auto inline-flex items-center gap-2 px-3.5 py-2 bg-ink-900 text-paper rounded-full text-[12.5px] font-medium hover:bg-accent transition-colors"
          >
            {t('direction.insert')}
          </button>
          <button
            onClick={() => {
              navigator.clipboard?.writeText(command);
            }}
            className="inline-flex items-center px-3 py-2 rounded-full border border-line bg-white/60 text-ink-700 hover:border-accent hover:text-accent text-[12.5px] transition-colors"
          >
            {t('direction.copy')}
          </button>
          <button
            onClick={onClose}
            className="inline-flex items-center px-3 py-2 text-ink-500 hover:text-ink-900 text-[12.5px]"
          >
            {t('color.cancel')}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[10.5px] uppercase tracking-[0.14em] text-ink-500">{label}</span>
      {children}
    </label>
  );
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <Field label={label}>
      <div className="flex items-center border border-line rounded-md bg-white overflow-hidden focus-within:border-accent">
        <input
          type="number"
          min={0}
          max={359}
          value={value}
          onChange={e => {
            const n = Number(e.target.value);
            if (Number.isFinite(n)) onChange(n);
          }}
          className="flex-1 px-2.5 py-1.5 text-[13px] tab-nums outline-none bg-transparent"
          style={{ fontFamily: 'var(--font-mono)' }}
        />
        <div className="flex flex-col border-l border-line">
          <button
            type="button"
            onClick={() => onChange(value + 1)}
            className="px-2 py-0.5 text-[10px] text-ink-500 hover:text-ink-900 hover:bg-paper-soft border-b border-line"
            tabIndex={-1}
          >▲</button>
          <button
            type="button"
            onClick={() => onChange(value - 1)}
            className="px-2 py-0.5 text-[10px] text-ink-500 hover:text-ink-900 hover:bg-paper-soft"
            tabIndex={-1}
          >▼</button>
        </div>
      </div>
    </Field>
  );
}

