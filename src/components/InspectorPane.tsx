import { memo, useEffect, useMemo, useRef } from 'react';
import { TurtleError } from '../interpreter/errors';
import { TurtleState } from '../interpreter/interpreter';
import { useT } from '../i18n/context';

/**
 * A cluster of errors that share a signature (same messageKey + args +
 * phase). We show the first occurrence in the list and attach the remaining
 * line numbers as metadata so the user sees "this exact mistake happened on
 * lines 14, 15, 16, …" instead of 50 near-identical rows they have to scroll
 * past. The individual errors remain available for the editor gutter.
 */
interface ErrorGroup {
  /** Representative error (the first occurrence). */
  error: TurtleError;
  /** Every line where this same error appears, sorted ascending. Always
   *  contains at least one entry (the representative error's line). */
  lines: number[];
  /** Total number of underlying errors rolled up into this group. */
  count: number;
}

/**
 * Group consecutive errors that share the same root cause. Signature is
 * `phase|messageKey|args` — when messageKey is missing we fall back to the
 * literal message so unkeyed errors still dedupe sensibly.
 *
 * Groups preserve the original order of first appearance so the list still
 * reads top-to-bottom with respect to source location.
 */
function groupErrors(errors: TurtleError[]): ErrorGroup[] {
  const groups: ErrorGroup[] = [];
  const bySig = new Map<string, ErrorGroup>();
  for (const err of errors) {
    const sig = `${err.phase}|${err.messageKey ?? err.message}|${(err.messageArgs ?? []).join('\u0001')}`;
    const existing = bySig.get(sig);
    if (existing) {
      existing.count++;
      if (!existing.lines.includes(err.line)) {
        existing.lines.push(err.line);
        existing.lines.sort((a, b) => a - b);
      }
    } else {
      const group: ErrorGroup = { error: err, lines: [err.line], count: 1 };
      bySig.set(sig, group);
      groups.push(group);
    }
  }
  return groups;
}

export type InspectorTab = 'errors' | 'output' | 'turtle';

interface InspectorPaneProps {
  /** Full error list — every parse + runtime problem found in the program. */
  errors: TurtleError[];
  output: string[];
  turtle: TurtleState;
  variables: Record<string, number | string>;
  functionNames: string[];
  code: string;
  activeTab: InspectorTab;
  onTabChange: (t: InspectorTab) => void;
  onJumpToLine: (line: number) => void;
  onClose?: () => void;
}

/**
 * Right-side inspector, modelled on KTurtle's docked Inspector + Errors
 * panels but combined into a single tabbed pane. Always visible in the
 * right column; tabs switch between:
 *   - Errors:   translated, line-accurate diagnostics
 *   - Output:   print log
 *   - Turtle:   live state, variables, functions
 */
function InspectorPaneImpl({
  errors,
  output,
  turtle,
  variables,
  functionNames,
  code,
  activeTab,
  onTabChange,
  onJumpToLine,
  onClose,
}: InspectorPaneProps) {
  const { t } = useT();
  const outputScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (activeTab === 'output' && outputScrollRef.current) {
      outputScrollRef.current.scrollTop = outputScrollRef.current.scrollHeight;
    }
  }, [output, activeTab]);

  // Collapse near-identical errors into groups so 50 repeated "expected value
  // for 'go' but found 'pendown'" rows render as ONE row with a "×50 on
  // lines 14, 15, 16…" badge. The tab count still shows the total problem
  // count (errors.length) because that's what the user cares about at a glance.
  const errorGroups = useMemo(() => groupErrors(errors), [errors]);

  const counts = {
    errors: errors.length,
    output: output.length,
  };

  return (
    <div className="flex flex-col h-full bg-white min-w-0">
      {/* Pane header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-line bg-paper-soft/60 flex-shrink-0">
        <div className="flex items-baseline gap-2 min-w-0">
          <h2 className="text-[12.5px] font-medium text-ink-900 uppercase tracking-[0.1em] truncate">
            {t('pane.inspector')}
          </h2>
          <span className="text-[11px] text-ink-500 italic truncate">
            {t('pane.inspector.subtitle')}
          </span>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="text-ink-400 hover:text-ink-900 transition-colors"
            aria-label={t('pane.hide')}
            title={t('pane.hide')}
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>
        )}
      </div>

      {/* Tab bar */}
      <div className="flex items-stretch border-b border-line bg-white flex-shrink-0">
        <InspectorTabBtn
          label={t('console.tab.errors')}
          badge={counts.errors}
          active={activeTab === 'errors'}
          tone={errors.length > 0 ? 'error' : 'muted'}
          onClick={() => onTabChange('errors')}
        />
        <InspectorTabBtn
          label={t('console.tab.output')}
          badge={counts.output}
          active={activeTab === 'output'}
          tone="muted"
          onClick={() => onTabChange('output')}
        />
        <InspectorTabBtn
          label={t('inspector.turtle')}
          active={activeTab === 'turtle'}
          tone="muted"
          onClick={() => onTabChange('turtle')}
        />
      </div>

      {/* Body — scrolls independently */}
      <div className="flex-1 overflow-auto min-h-0">
        {activeTab === 'errors' && (
          <div className="font-sans text-[13px]">
            {errors.length === 0 ? (
              <div className="p-4">
                <EmptyHint>{t('console.errors.empty')}</EmptyHint>
              </div>
            ) : (
              <>
                {/* Summary bar — total count, unique cause count, spread across lines. */}
                <div className="px-4 py-2 border-b border-line bg-[#fbeee7]/50 flex items-center justify-between gap-2">
                  <span className="text-[11.5px] text-[#9c3a17] font-medium">
                    {errorGroups.length < errors.length
                      ? t(
                          'console.errorsFoundGrouped',
                          errors.length,
                          new Set(errors.map(e => e.line)).size,
                          errorGroups.length,
                        )
                      : t('console.errorsFound', errors.length)}
                  </span>
                  <span className="text-[10.5px] text-ink-500 font-mono tab-nums">
                    {summarizeErrorLines(errors)}
                  </span>
                </div>
                <ul className="divide-y divide-line">
                  {errorGroups.map((group, i) => (
                    <ErrorRow
                      key={`${group.error.line}-${group.error.column ?? 0}-${i}`}
                      group={group}
                      index={i + 1}
                      code={code}
                      t={t}
                      onJumpToLine={onJumpToLine}
                    />
                  ))}
                </ul>
              </>
            )}
          </div>
        )}

        {activeTab === 'output' && (
          <div ref={outputScrollRef} className="p-4 font-mono text-[13px] text-ink-800 leading-relaxed h-full">
            {output.length === 0 ? (
              <EmptyHint>{t('console.output.empty')}</EmptyHint>
            ) : (
              output.map((line, i) => (
                <div key={i} className="flex gap-3">
                  <span className="text-ink-400 select-none tab-nums text-[11px] pt-0.5 w-7 text-right">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <span className="flex-1 break-all whitespace-pre-wrap">{line}</span>
                </div>
              ))
            )}
          </div>
        )}

        {activeTab === 'turtle' && (
          <div className="p-4 space-y-4">
            <InspectorSection title={t('inspector.turtle')}>
              <InspectRow label={t('inspector.turtle.position')} value={`${Math.round(turtle.x)}, ${Math.round(turtle.y)}`} />
              <InspectRow label={t('inspector.turtle.heading')} value={`${Math.round(turtle.angle % 360)}°`} />
              <InspectRow
                label={t('inspector.turtle.pen')}
                value={turtle.penDown ? t('inspector.turtle.pen.down') : t('inspector.turtle.pen.up')}
                swatch={turtle.penColor}
              />
              <InspectRow label={t('inspector.turtle.penWidth')} value={`${turtle.penWidth}`} />
              <InspectRow
                label={t('inspector.turtle.canvas')}
                value={`${turtle.canvasWidth} × ${turtle.canvasHeight}`}
                swatch={turtle.canvasColor}
              />
              <InspectRow
                label={t('inspector.turtle.visible')}
                value={turtle.visible ? t('inspector.turtle.yes') : t('inspector.turtle.no')}
              />
            </InspectorSection>

            <InspectorSection title={t('inspector.variables')}>
              {Object.keys(variables).length > 0 ? (
                Object.entries(variables).map(([name, value]) => (
                  <InspectRow
                    key={name}
                    label={`$${name}`}
                    value={typeof value === 'string' ? `"${value}"` : String(value)}
                    mono
                  />
                ))
              ) : (
                <div className="px-3 py-2 text-[12.5px] text-ink-500 italic">
                  {t('inspector.variables.empty')}
                </div>
              )}
            </InspectorSection>

            <InspectorSection title={t('inspector.functions')}>
              {functionNames.length > 0 ? (
                functionNames.map(name => (
                  <div key={name} className="px-3 py-2 flex items-center gap-2">
                    <svg className="w-3 h-3 text-ink-400" fill="currentColor" viewBox="0 0 12 12">
                      <path d="M3 3h6v2H5v2h3v2H5v1H3z" />
                    </svg>
                    <span className="font-mono text-[12.5px] text-ink-900">{name}</span>
                  </div>
                ))
              ) : (
                <div className="px-3 py-2 text-[12.5px] text-ink-500 italic">
                  {t('inspector.functions.empty')}
                </div>
              )}
            </InspectorSection>
          </div>
        )}
      </div>
    </div>
  );
}

function InspectorTabBtn({
  label,
  badge,
  active,
  tone,
  onClick,
}: {
  label: string;
  badge?: number;
  active: boolean;
  tone: 'error' | 'muted';
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative flex-1 px-3 py-2 text-[12px] font-medium transition-colors border-r border-line last:border-r-0 ${
        active ? 'bg-white text-ink-900' : 'text-ink-600 hover:text-ink-900 hover:bg-paper-soft/60'
      }`}
    >
      <span className="inline-flex items-center gap-1.5">
        {label}
        {badge !== undefined && badge > 0 && (
          <span
            className={`inline-flex items-center justify-center min-w-[16px] h-[16px] px-1 rounded-full text-[10px] font-mono tab-nums ${
              tone === 'error'
                ? 'bg-[#fbeee7] text-[#9c3a17] border border-[#f1d6cc]'
                : 'bg-paper-soft text-ink-600 border border-line'
            }`}
          >
            {badge}
          </span>
        )}
      </span>
      {active && <span className="absolute left-0 right-0 -bottom-px h-[2px] bg-accent" />}
    </button>
  );
}

function EmptyHint({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 text-[12.5px] text-ink-500 italic leading-relaxed">
      <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      <span>{children}</span>
    </div>
  );
}

function InspectorSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10.5px] uppercase tracking-[0.12em] text-ink-500 mb-1.5 font-medium">{title}</div>
      <div className="divide-y divide-line border border-line rounded-lg bg-white overflow-hidden">
        {children}
      </div>
    </div>
  );
}

function InspectRow({
  label,
  value,
  swatch,
  mono,
}: {
  label: string;
  value: string;
  swatch?: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center justify-between px-3 py-2 min-w-0">
      <span className={`text-[12px] text-ink-600 truncate ${mono ? 'font-mono' : ''}`}>{label}</span>
      <span className="inline-flex items-center gap-2 font-mono text-[12.5px] text-ink-900 tab-nums flex-shrink-0 ml-2">
        {swatch && (
          <span
            className="w-3 h-3 rounded-sm border border-line flex-shrink-0"
            style={{ backgroundColor: swatch }}
          />
        )}
        {value}
      </span>
    </div>
  );
}

function getLineSnippet(code: string, line: number): string {
  if (!code || line < 1) return '';
  const lines = code.split('\n');
  return lines[line - 1] ?? '';
}

/**
 * One row in the error list. Click to jump the editor to the line; the row
 * expands (via native <details>) to reveal the source snippet + caret so
 * the user can see the exact location without leaving the inspector.
 */
function ErrorRow({
  group,
  index,
  code,
  t,
  onJumpToLine,
}: {
  group: ErrorGroup;
  index: number;
  code: string;
  t: (key: string, ...args: (string | number)[]) => string;
  onJumpToLine: (line: number) => void;
}) {
  const { error, lines, count } = group;
  const snippet = getLineSnippet(code, error.line);
  const phaseTone =
    error.phase === 'runtime'
      ? 'bg-[#fbeee7] border-[#f1d6cc] text-[#c85a2a]'
      : 'bg-[#fff4e0] border-[#f0dcb4] text-[#8f6a1a]';

  // When the error repeats on many lines, render every affected line number
  // as its own clickable chip — no "representative" line in the header, and
  // no hidden ▼-style disclosure. Previously the header said "line 16" (the
  // first occurrence) while clicking jumped elsewhere, which looked like a
  // bug. Now the header is phase+count only; the chip row is the single
  // source of truth for "which lines", and clicking any chip jumps to *that*
  // exact line. For single-occurrence errors we still show one chip so the
  // visual is consistent and the click target is explicit.
  const MAX_LINES_SHOWN = 10;
  const shownLines = lines.slice(0, MAX_LINES_SHOWN);
  const hiddenLines = lines.length - shownLines.length;

  // Clicking the main row jumps to the *first* affected line as a sensible
  // default (progressive disclosure: individual chips below for the rest).
  const primaryLine = lines[0];

  // Snippet line numbers — show the representative error line in the snippet
  // when there's only one, otherwise pick the primary (first) line. The snippet
  // is purely informational; the chips above are the real navigation surface.
  const snippetLine = lines.length === 1 ? error.line : primaryLine;

  return (
    <li className="group">
      {/* Use a <div> (not <button>) as the outer interactive surface because
          we embed real <button>s (the line chips) inside. Nested buttons are
          invalid HTML and, worse, some browsers fire the outer click handler
          even after stopPropagation on the inner button — which caused the
          observed "clicking L16 jumped to the primary line" bug. */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => onJumpToLine(primaryLine)}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onJumpToLine(primaryLine);
          }
        }}
        className="w-full text-left px-4 py-3 hover:bg-paper-soft/60 transition-colors flex items-start gap-3 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      >
        <div className={`mt-0.5 w-6 h-6 rounded-md border flex items-center justify-center flex-shrink-0 ${phaseTone}`}>
          <span className="text-[10.5px] font-mono tab-nums font-semibold">{index}</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-[10.5px] uppercase tracking-[0.12em] font-medium text-[#9c3a17]">
              {t(`console.phase.${error.phase}`)}
            </span>
            {count > 1 && (
              <span
                className="inline-flex items-center gap-0.5 text-[10px] font-mono tab-nums font-semibold px-1.5 py-[1px] rounded-full bg-[#fbeee7] text-[#9c3a17] border border-[#f1d6cc]"
                title={t('console.repeatedOn', count - 1)}
              >
                ×{count}
              </span>
            )}
            {/* One chip per affected line. Each is a real <button> so
                stopPropagation reliably blocks the outer row click. */}
            <span className="inline-flex flex-wrap items-center gap-1">
              {shownLines.map(l => (
                <button
                  key={l}
                  type="button"
                  onClick={e => {
                    e.stopPropagation();
                    onJumpToLine(l);
                  }}
                  className="inline-flex items-center gap-1 px-1.5 py-[1px] rounded bg-paper-soft/80 hover:bg-accent/10 border border-line hover:border-accent/40 text-[10.5px] font-mono tab-nums text-ink-700 hover:text-accent cursor-pointer transition-colors"
                  title={t('console.jumpToLine', l)}
                >
                  <span className="text-ink-500">L</span>
                  {l}
                </button>
              ))}
              {hiddenLines > 0 && (
                <span className="text-[10.5px] text-ink-500 font-mono tab-nums">
                  +{hiddenLines}
                </span>
              )}
            </span>
            {error.column !== undefined && lines.length === 1 && (
              <span className="text-[10.5px] text-ink-500 font-mono">
                {t('console.column', error.column)}
              </span>
            )}
          </div>
          <p className="text-ink-900 leading-snug mt-1 text-[13px]">
            {error.messageKey ? t(error.messageKey, ...(error.messageArgs || [])) : error.message}
          </p>
          {snippet && (
            <pre className="mt-2 font-mono text-[11.5px] bg-white border border-line rounded px-2 py-1.5 overflow-x-auto">
              <span className="text-ink-400 select-none tab-nums mr-2">
                {String(snippetLine).padStart(3, ' ')}
              </span>
              <span className="text-ink-900">{snippet}</span>
              {error.column !== undefined && lines.length === 1 && (
                <span className="block text-[#c85a2a]">
                  <span className="text-ink-400 select-none mr-2">{'   '}</span>
                  {' '.repeat(Math.max(0, (error.column || 1) - 1))}
                  <span aria-hidden>▲</span>
                </span>
              )}
            </pre>
          )}
        </div>
        <svg
          className="w-3 h-3 text-ink-300 group-hover:text-accent flex-shrink-0 mt-1 transition-colors"
          viewBox="0 0 12 12"
          fill="currentColor"
        >
          <path d="M4.5 2.5l3.5 3.5-3.5 3.5V6.5H1v-1h3.5z" />
        </svg>
      </div>
    </li>
  );
}

/** "3 problems on lines 4, 7, 12" — helps users gauge spread at a glance. */
function summarizeErrorLines(errors: TurtleError[]): string {
  const lines = Array.from(new Set(errors.map(e => e.line))).sort((a, b) => a - b);
  if (lines.length === 0) return '';
  if (lines.length <= 4) return `lines ${lines.join(', ')}`;
  return `${lines.length} lines`;
}

export const InspectorPane = memo(InspectorPaneImpl);
