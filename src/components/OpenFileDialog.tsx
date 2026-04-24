import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useT } from '../i18n/context';
import { examples } from '../examples';
import { list as listRecent, remove as removeRecent, clear as clearRecent, RecentFile } from '../utils/recentFiles';
import { fromKTurtleFile } from '../interpreter/ktFileFormat';

/**
 * KTurtle-style Open dialog. Three tabs:
 *   1. Examples       — built-in programs bundled with the app
 *   2. Recent         — files the user has opened or saved before
 *   3. From computer  — invokes the OS file picker
 *
 * Every entry renders a small source preview, a line count, and a byte
 * size — the same metadata KFileDialog shows on KDE. Selecting an item
 * calls `onPick(name, code)` and closes the dialog.
 */
type Tab = 'examples' | 'recent' | 'computer';

interface OpenFileDialogProps {
  open: boolean;
  onClose: () => void;
  onPick: (name: string, code: string) => void;
}

export function OpenFileDialog({ open, onClose, onPick }: OpenFileDialogProps) {
  const { t } = useT();
  const [tab, setTab] = useState<Tab>('examples');
  const [recent, setRecent] = useState<RecentFile[]>([]);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Refresh recent list each time the dialog opens
  useEffect(() => {
    if (open) {
      setRecent(listRecent());
      setQuery('');
      setSelected(null);
      setTab(listRecent().length > 0 ? 'recent' : 'examples');
      requestAnimationFrame(() => searchRef.current?.focus());
    }
  }, [open]);

  // ESC / arrow-key navigation
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const items = useMemo(() => {
    if (tab === 'examples') {
      return Object.entries(examples).map(([name, code]) => ({
        id: `example:${name}`,
        name,
        code,
        subtitle: exampleSubtitle(code),
        kind: 'example' as const,
      }));
    }
    if (tab === 'recent') {
      return recent.map(r => ({
        id: `recent:${r.name}:${r.touchedAt}`,
        name: r.name,
        code: r.code,
        subtitle: recentSubtitle(r),
        kind: 'recent' as const,
        touchedAt: r.touchedAt,
      }));
    }
    return [];
  }, [tab, recent]);

  const filtered = useMemo(() => {
    if (!query.trim()) return items;
    const q = query.toLowerCase();
    return items.filter(i => i.name.toLowerCase().includes(q) || i.code.toLowerCase().includes(q));
  }, [items, query]);

  const handlePickFromComputer = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.turtle,.logo,.txt,text/plain';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        // Auto-detect: fromKTurtleFile() strips the magic header +
        // @(english) wrappers if present, or returns the text unchanged
        // for hand-edited plain-text programs and legacy files.
        const raw = String(reader.result || '');
        onPick(file.name, fromKTurtleFile(raw));
        onClose();
      };
      reader.readAsText(file);
    };
    input.click();
  }, [onClose, onPick]);

  const selectedItem = useMemo(() => filtered.find(i => i.id === selected), [filtered, selected]);
  // Auto-select the first item in the list when filter results change.
  useEffect(() => {
    if (filtered.length > 0 && !filtered.find(i => i.id === selected)) {
      setSelected(filtered[0].id);
    } else if (filtered.length === 0) {
      setSelected(null);
    }
  }, [filtered, selected]);

  const openSelected = () => {
    if (!selectedItem) return;
    onPick(selectedItem.name, selectedItem.code);
    onClose();
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-stretch sm:items-center justify-center p-0 sm:p-4 bg-ink-900/30 backdrop-blur-sm anim-fade overflow-hidden"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={t('file.open.title')}
      style={{ paddingTop: 'env(safe-area-inset-top)' }}
    >
      {/*
        On phones the dialog takes the whole viewport (cleaner than a
        cramped centered modal); on tablets/desktop it's a proper dialog
        with a max width.
      */}
      <div
        className="surface w-full max-w-[820px] anim-sheet sm:anim-rise flex flex-col max-h-[var(--app-vh)] sm:max-h-[min(90vh,680px)] my-0 sm:my-auto overflow-hidden rounded-none sm:rounded-[14px] border-0 sm:border"
        onClick={e => e.stopPropagation()}
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-line flex-shrink-0">
          <div>
            <h3 className="font-display text-[18px] text-ink-900" style={{ letterSpacing: '-0.01em' }}>
              {t('file.open.title')}
            </h3>
            <p className="text-[11.5px] text-ink-500 mt-0.5">
              {t('file.open.hint')}
            </p>
          </div>
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

        {/* Body: sidebar tabs + list + preview.
            Mobile  (<640px) : tab pills row at top, list fills the rest,
                               preview hidden (tap a row to open directly).
            Tablet  (≥640)   : keep the 2-column layout (tabs | list), preview hidden.
            Desktop (≥768)   : full 3-column layout with preview pane.
         */}
        <div className="flex-1 min-h-0 flex flex-col sm:grid sm:grid-cols-[200px_1fr] md:grid-cols-[200px_1.3fr_1fr]">
          {/* Sidebar — pills on mobile, stacked sidebar on sm+ */}
          <aside className="sm:border-r sm:border-line sm:bg-paper-soft/40 py-2 flex flex-row sm:flex-col gap-1 sm:gap-0 px-3 sm:px-0 flex-shrink-0 border-b sm:border-b-0 border-line overflow-x-auto sm:overflow-visible toolbar-scroll">
            <SidebarTab
              label={t('file.open.tab.recent')}
              active={tab === 'recent'}
              count={recent.length}
              onClick={() => setTab('recent')}
              icon={
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              }
            />
            <SidebarTab
              label={t('file.open.tab.examples')}
              active={tab === 'examples'}
              count={Object.keys(examples).length}
              onClick={() => setTab('examples')}
              icon={
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
                />
              }
            />
            <div className="my-1.5 border-t border-line mx-3" />
            <SidebarTab
              label={t('file.open.tab.computer')}
              active={tab === 'computer'}
              onClick={() => {
                setTab('computer');
                handlePickFromComputer();
              }}
              icon={
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9 17v-6h13m-5-4V3h-6v4M3 7h16v10H3V7z"
                />
              }
            />

            <div className="mt-auto px-3 pt-3">
              {tab === 'recent' && recent.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    if (window.confirm(t('file.open.clearConfirm'))) {
                      clearRecent();
                      setRecent([]);
                    }
                  }}
                  className="w-full text-[11px] text-ink-500 hover:text-[#9c3a17] transition-colors py-1"
                >
                  {t('file.open.clearRecent')}
                </button>
              )}
            </div>
          </aside>

          {/* Middle: search + list */}
          <div className="flex flex-col min-w-0 border-r border-line">
            <div className="px-3 pt-3 pb-2 flex-shrink-0">
              <div className="relative">
                <svg
                  className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink-400 pointer-events-none"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                  />
                </svg>
                <input
                  ref={searchRef}
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder={t('file.open.search')}
                  className="w-full pl-8 pr-3 py-1.5 text-[12.5px] bg-white border border-line rounded-md outline-none focus:border-accent transition-colors"
                />
              </div>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-2">
              {filtered.length === 0 ? (
                <EmptyState
                  label={
                    tab === 'recent'
                      ? t('file.open.empty.recent')
                      : tab === 'examples'
                        ? t('file.open.empty.examples')
                        : ''
                  }
                  hint={tab === 'recent' ? t('file.open.empty.recentHint') : ''}
                />
              ) : (
                <ul role="listbox" aria-label={tab}>
                  {filtered.map(item => {
                    const isSel = item.id === selected;
                    return (
                      <li key={item.id}>
                        <button
                          type="button"
                          role="option"
                          aria-selected={isSel}
                          onClick={() => {
                            // On desktop (md+) clicking selects for preview;
                            // on mobile (preview hidden) there's no second
                            // step, so click = open immediately. matchMedia
                            // rather than a JS breakpoint so this works
                            // even in an SSR-hydrated shell.
                            const isCompact =
                              typeof window !== 'undefined' &&
                              window.matchMedia &&
                              window.matchMedia('(max-width: 767px)').matches;
                            if (isCompact) {
                              onPick(item.name, item.code);
                              onClose();
                            } else {
                              setSelected(item.id);
                            }
                          }}
                          onDoubleClick={() => {
                            setSelected(item.id);
                            onPick(item.name, item.code);
                            onClose();
                          }}
                          className={`touch-target w-full text-left px-3 py-3 sm:py-2 rounded-md transition-colors flex items-start gap-2.5 group ${
                            isSel
                              ? 'bg-accent-wash/70 text-ink-900'
                              : 'hover:bg-paper-soft active:bg-paper-soft text-ink-800'
                          }`}
                        >
                          <FileIcon kind={item.kind} />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-baseline justify-between gap-2 min-w-0">
                              <span className="text-[13px] font-medium truncate">{item.name}</span>
                              {item.kind === 'recent' && 'touchedAt' in item && (
                                <span className="text-[10.5px] text-ink-500 font-mono flex-shrink-0">
                                  {formatWhen(item.touchedAt, t)}
                                </span>
                              )}
                            </div>
                            <div className="text-[11.5px] text-ink-500 mt-0.5 truncate font-mono">
                              {item.subtitle}
                            </div>
                          </div>
                          {item.kind === 'recent' && (
                            <button
                              type="button"
                              onClick={e => {
                                e.stopPropagation();
                                removeRecent(item.name);
                                setRecent(listRecent());
                              }}
                              className="opacity-0 group-hover:opacity-100 w-5 h-5 rounded text-ink-400 hover:text-[#9c3a17] hover:bg-white inline-flex items-center justify-center transition-opacity"
                              aria-label={t('file.open.removeOne')}
                              title={t('file.open.removeOne')}
                            >
                              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            </button>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>

          {/* Right: preview — hidden below the md breakpoint. On phones the
              list entries are direct-pick (tap to open), so a preview pane
              would just eat half the viewport for no reason. */}
          <div className="hidden md:flex flex-col min-w-0 bg-paper-soft/30">
            {selectedItem ? (
              <>
                <div className="px-4 py-2.5 border-b border-line flex-shrink-0">
                  <div className="text-[11px] uppercase tracking-[0.12em] text-ink-500">
                    {t('file.open.preview')}
                  </div>
                  <div className="text-[13px] font-medium text-ink-900 truncate mt-0.5">
                    {selectedItem.name}
                  </div>
                </div>
                <div className="flex-1 min-h-0 overflow-auto">
                  <pre
                    className="m-0 px-4 py-3 font-mono text-[11.5px] text-ink-800 leading-relaxed whitespace-pre"
                    style={{ fontVariantLigatures: 'none' }}
                  >
                    {selectedItem.code || `(${t('file.open.noPreview')})`}
                  </pre>
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center p-6 text-[12px] text-ink-500 italic text-center leading-relaxed">
                {t('file.open.selectHint')}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-line bg-paper-soft/50 flex flex-wrap items-center gap-2 flex-shrink-0">
          <button
            onClick={handlePickFromComputer}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-line bg-white text-[12.5px] text-ink-800 hover:border-accent hover:text-accent transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 17v-6h13m-5-4V3h-6v4M3 7h16v10H3V7z" />
            </svg>
            {t('file.open.browse')}
          </button>

          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-[12.5px] text-ink-500 hover:text-ink-900 rounded-md transition-colors"
            >
              {t('color.cancel')}
            </button>
            <button
              onClick={openSelected}
              disabled={!selectedItem}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-ink-900 text-paper rounded-md text-[12.5px] font-medium hover:bg-accent transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {t('file.open.action')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────── helpers ───────────────────────

function SidebarTab({
  label,
  active,
  count,
  onClick,
  icon,
}: {
  label: string;
  active: boolean;
  count?: number;
  onClick: () => void;
  icon: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        // Mobile: rounded pill, horizontal scroll. No left-border accent.
        'flex-shrink-0 inline-flex sm:flex items-center gap-2',
        'rounded-full sm:rounded-none',
        'px-3 py-1.5 sm:px-4 sm:py-2 text-left text-[12.5px] transition-colors',
        // Desktop: current "sidebar-tab" look with left accent stripe
        active
          ? 'bg-accent-wash/60 sm:bg-white text-ink-900 font-medium sm:border-l-2 sm:border-accent sm:-ml-px sm:pl-[15px]'
          : 'bg-paper-soft sm:bg-transparent text-ink-700 hover:bg-white/60 hover:text-ink-900',
      ].join(' ')}
    >
      <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
        {icon}
      </svg>
      <span className="truncate sm:flex-1">{label}</span>
      {count !== undefined && count > 0 && (
        <span className={`text-[10.5px] font-mono tab-nums ${active ? 'text-accent' : 'text-ink-400'}`}>
          {count}
        </span>
      )}
    </button>
  );
}

function FileIcon({ kind }: { kind: 'example' | 'recent' }) {
  return (
    <div
      className={`mt-0.5 w-7 h-8 rounded flex items-center justify-center flex-shrink-0 ${
        kind === 'example' ? 'bg-sage-wash text-sage border border-sage/20' : 'bg-paper-sunk text-ink-500 border border-line'
      }`}
      aria-hidden
    >
      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.6}>
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M9 12h6m-6 4h6M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h12a2 2 0 002-2V7a2 2 0 00-2-2h-2M8 5a2 2 0 002 2h4a2 2 0 002-2M8 5a2 2 0 012-2h4a2 2 0 012 2"
        />
      </svg>
    </div>
  );
}

function EmptyState({ label, hint }: { label: string; hint?: string }) {
  return (
    <div className="px-4 py-8 text-center">
      <div className="text-[13px] text-ink-700 font-medium">{label}</div>
      {hint && <div className="text-[11.5px] text-ink-500 mt-1">{hint}</div>}
    </div>
  );
}

function exampleSubtitle(code: string): string {
  // Look for the first meaningful comment line, otherwise fall back to
  // "N lines · X chars". Matches how KTurtle shows an example description.
  const m = code.match(/^\s*#\s*([^\n]+)/);
  if (m) return m[1].trim();
  const lines = code.split('\n').length;
  return `${lines} lines · ${code.length} chars`;
}

function recentSubtitle(r: RecentFile): string {
  return `${r.lines} lines · ${formatBytes(r.size)}`;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} kB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function formatWhen(ms: number, t: (k: string, ...a: (string | number)[]) => string): string {
  const diff = Date.now() - ms;
  const m = Math.floor(diff / 60_000);
  if (m < 1) return t('file.when.justNow');
  if (m < 60) return t('file.when.minutesAgo', m);
  const h = Math.floor(m / 60);
  if (h < 24) return t('file.when.hoursAgo', h);
  const d = Math.floor(h / 24);
  if (d < 30) return t('file.when.daysAgo', d);
  return new Date(ms).toLocaleDateString();
}
