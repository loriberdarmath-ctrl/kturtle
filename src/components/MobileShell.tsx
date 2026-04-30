import { memo, RefObject, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { TurtleState, DrawCommand } from '../interpreter/interpreter';
import { TurtleError } from '../interpreter/errors';
import { CodeEditor, CodeEditorHandle } from './CodeEditor';
import { TurtleCanvas, TurtleCanvasHandle } from './TurtleCanvas';
import { InspectorPane, InspectorTab } from './InspectorPane';
import { ColorPicker } from './ColorPicker';
import { OpenFileDialog } from './OpenFileDialog';
import { useT } from '../i18n/context';
import { examples } from '../examples';
import { exportPngFile } from '../utils/nativeIO';

/**
 * Single prop-bundle so App.tsx only has to hand over one object.
 * MobileShell is purely a presentational re-arrangement of the same state
 * the desktop shell uses; it owns no runtime state of its own that
 * matters to the interpreter.
 */
export interface MobileShellApp {
  code: string;
  setCode: (c: string) => void;
  /** Lower-priority copy of `code` — use in subtrees where lag of a
   *  few ms between keystroke and render is acceptable (e.g. error
   *  snippet lookup in the Inspector). */
  deferredCode: string;
  fileName: string;
  turtle: TurtleState;
  drawings: DrawCommand[];
  drawingsLen: number;
  errors: TurtleError[];
  error?: TurtleError;
  output: string[];
  variables: Record<string, number | string>;
  functionNames: string[];
  executingLine?: number;
  isRunning: boolean;
  runCode: () => void;
  resetCanvas: () => void;
  saveFile: () => void;
  openFile: () => void;
  newFile: () => void;
  exportSvg: () => void;
  exportPngFromCanvas: () => string | null;
  canvasRef: RefObject<TurtleCanvasHandle | null>;
  editorRef: RefObject<CodeEditorHandle | null>;
  speedIdx: number;
  setSpeedIdx: (n: number) => void;
  speedLabel: string;
  speedStepsLen: number;
  inspectorTab: InspectorTab;
  setInspectorTab: (t: InspectorTab) => void;
  mobileView: 'code' | 'canvas' | 'console';
  setMobileView: (v: 'code' | 'canvas' | 'console') => void;
  showMobileMore: boolean;
  setShowMobileMore: (v: boolean) => void;
  canvasZoomDisplay: number;
  setCanvasZoomDisplay: (n: number) => void;
  setShowColorPicker: (v: boolean) => void;
  setShowOpenDialog: (v: boolean) => void;
  setShowExportModal: (v: boolean) => void;
  setExportedImage: (s: string | null) => void;
  handleFilePicked: (name: string, code: string) => void;
  exportedImage: string | null;
  showExportModal: boolean;
  showColorPicker: boolean;
  showOpenDialog: boolean;
}

/**
 * Mobile shell.
 *
 * Layout (top → bottom):
 *   1. Slim top bar — brand + contextual action (depending on tab)
 *   2. Full-bleed workspace slot (Code / Canvas / Console)
 *   3. Persistent run-bar with Run/Stop, speed dial, and a "…" drawer
 *   4. Bottom tab bar (Code, Canvas, Console)
 *
 * Design choices worth calling out:
 *   • The Run button is duplicated on every tab so it's always one thumb-
 *     length away — the single most important action in the app.
 *   • When the user starts a run, we auto-switch to the Canvas tab in
 *     App.tsx; the animation plays where they're already looking.
 *   • Modals render full-screen with safe-area padding so the keyboard /
 *     notch / home-indicator never eat interactive content.
 *   • Font sizes in the toolbar stay ≥ 12px so labels read on a 4.7" screen,
 *     but iconography is the primary language — labels support, not lead.
 */
function MobileShellImpl({ app }: { app: MobileShellApp }) {
  const { t, locale, setLocale, locales } = useT();
  const {
    code, setCode, deferredCode, fileName, turtle, drawings, drawingsLen, errors, error,
    output, variables, functionNames, executingLine,
    isRunning, runCode, resetCanvas,
    saveFile, openFile, newFile, exportSvg, exportPngFromCanvas,
    canvasRef, editorRef,
    speedIdx, setSpeedIdx, speedLabel, speedStepsLen,
    inspectorTab, setInspectorTab,
    mobileView, setMobileView,
    showMobileMore, setShowMobileMore,
    canvasZoomDisplay, setCanvasZoomDisplay,
    setShowColorPicker, setShowOpenDialog,
    setShowExportModal, setExportedImage,
    handleFilePicked,
    showColorPicker, showOpenDialog,
    exportedImage, showExportModal,
  } = app;

  // Examples sheet — opened from the More drawer. Kept separate from
  // the OpenFileDialog so we can offer a phone-tuned one-tap picker
  // without touching the desktop dialog.
  const [showExamplesSheet, setShowExamplesSheet] = useState(false);
  const [showLangSheet, setShowLangSheet] = useState(false);

  return (
    <div className="app-shell flex flex-col text-ink-900 overflow-hidden bg-paper">
      {/* ── Top bar ──────────────────────────────────────────────── */}
      <MobileTopBar
        t={t}
        fileName={fileName}
        errorCount={errors.length}
        onOpenMore={() => setShowMobileMore(true)}
        view={mobileView}
      />

      {/* ── Workspace slot ───────────────────────────────────────── */}
      {/* Keep all three mounted so state (caret position, canvas zoom,
          scroll) survives tab switches. Hidden tabs are display:none so
          their layout doesn't affect sibling flex calc. */}
      <main className="flex-1 min-h-0 relative overflow-hidden no-overscroll">
        <TabSlot active={mobileView === 'code'}>
          <div className="h-full flex flex-col bg-white">
            <CodeEditor
              ref={editorRef}
              code={code}
              onChange={setCode}
              errors={errors}
              executingLine={executingLine}
            />
          </div>
        </TabSlot>

        <TabSlot active={mobileView === 'canvas'}>
          <MobileCanvasPane
            canvasRef={canvasRef}
            turtle={turtle}
            drawings={drawings}
            drawingsLen={drawingsLen}
            zoomDisplay={canvasZoomDisplay}
            setZoomDisplay={setCanvasZoomDisplay}
            t={t}
            isRunning={isRunning}
          />
        </TabSlot>

        <TabSlot active={mobileView === 'console'}>
          <InspectorPane
            errors={errors}
            output={output}
            turtle={turtle}
            variables={variables}
            functionNames={functionNames}
            code={deferredCode}
            activeTab={inspectorTab}
            onTabChange={setInspectorTab}
            onJumpToLine={line => {
              // Switch to Code and jump — users expect tapping a problem
              // to take them straight to the source.
              setMobileView('code');
              // rAF so the code panel has time to mount/size.
              requestAnimationFrame(() => editorRef.current?.jumpToLine(line));
            }}
          />
        </TabSlot>
      </main>

      {/* ── Persistent run bar (above the tabs) ──────────────────── */}
      <MobileRunBar
        t={t}
        isRunning={isRunning}
        runCode={runCode}
        speedIdx={speedIdx}
        setSpeedIdx={setSpeedIdx}
        speedLabel={speedLabel}
        speedStepsLen={speedStepsLen}
        error={error}
        onJumpToError={() => {
          if (!error) return;
          setMobileView('code');
          requestAnimationFrame(() => editorRef.current?.jumpToLine(error.line));
        }}
        onOpenMore={() => setShowMobileMore(true)}
      />

      {/* ── Bottom tab bar ───────────────────────────────────────── */}
      <nav
        className="mobile-tabbar flex-shrink-0"
        aria-label={t('pane.workspace') || 'Workspace'}
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <TabButton
          icon={<IconCode />}
          label={t('pane.editor')}
          active={mobileView === 'code'}
          onClick={() => setMobileView('code')}
        />
        <TabButton
          icon={<IconCanvas />}
          label={t('pane.canvas')}
          active={mobileView === 'canvas'}
          onClick={() => setMobileView('canvas')}
        />
        <TabButton
          icon={<IconConsole />}
          label={t('pane.inspector')}
          badge={errors.length > 0 ? errors.length : undefined}
          active={mobileView === 'console'}
          onClick={() => {
            setMobileView('console');
            if (errors.length > 0) setInspectorTab('errors');
          }}
        />
      </nav>

      {/* ── "More" bottom sheet ──────────────────────────────────── */}
      {showMobileMore && (
        <BottomSheet onClose={() => setShowMobileMore(false)} title={t('toolbar.more') || 'More'}>
          <div className="grid grid-cols-4 gap-2 p-4">
            <SheetAction
              icon={<IconNewFile />}
              label={t('toolbar.file.new')}
              onClick={() => { newFile(); setShowMobileMore(false); }}
            />
            <SheetAction
              icon={<IconOpen />}
              label={t('toolbar.file.open')}
              onClick={() => { openFile(); setShowMobileMore(false); }}
            />
            <SheetAction
              icon={<IconSave />}
              label={t('toolbar.file.save')}
              onClick={() => { saveFile(); setShowMobileMore(false); }}
            />
            <SheetAction
              icon={<IconExamples />}
              label={t('toolbar.examples') || 'Examples'}
              onClick={() => { setShowExamplesSheet(true); setShowMobileMore(false); }}
            />

            <SheetAction
              icon={<IconReset />}
              label={t('toolbar.clear')}
              onClick={() => { resetCanvas(); setShowMobileMore(false); }}
            />
            <SheetAction
              icon={<IconColor />}
              label={t('toolbar.colorPicker')}
              onClick={() => { setShowColorPicker(true); setShowMobileMore(false); }}
            />
            <SheetAction
              icon={<IconImage />}
              label={t('toolbar.file.exportPng')}
              onClick={() => {
                const img = exportPngFromCanvas();
                if (img) { setExportedImage(img); setShowExportModal(true); }
                setShowMobileMore(false);
              }}
            />
            <SheetAction
              icon={<IconSvg />}
              label={t('toolbar.file.exportSvg')}
              onClick={() => { exportSvg(); setShowMobileMore(false); }}
            />

            <SheetAction
              icon={<IconGlobe />}
              label={locale.toUpperCase()}
              onClick={() => { setShowLangSheet(true); setShowMobileMore(false); }}
            />
          </div>
          {/*
            Author credit, tucked at the bottom of the More sheet so it
            never steals focus from actions but is always one tap away.
            Serif + muted ink matches the desktop footer signature.
          */}
          <div
            className="px-5 pb-5 pt-1 text-center italic text-[11.5px] text-ink-400"
            style={{ fontFamily: 'var(--font-serif)' }}
          >
            {t('footer.author')}
          </div>
        </BottomSheet>
      )}

      {/* Examples quick-picker */}
      {showExamplesSheet && (
        <BottomSheet onClose={() => setShowExamplesSheet(false)} title={t('toolbar.examples') || 'Examples'}>
          <ul className="divide-y divide-line">
            {Object.keys(examples).map(name => (
              <li key={name}>
                <button
                  type="button"
                  className="w-full text-left px-5 py-4 flex items-center justify-between gap-3 active:bg-paper-soft touch-target"
                  onClick={() => {
                    setCode(examples[name]);
                    resetCanvas();
                    setShowExamplesSheet(false);
                    setMobileView('code');
                  }}
                >
                  <span className="font-mono text-[14px] text-ink-900">{name}</span>
                  <svg className="w-4 h-4 text-ink-400" viewBox="0 0 12 12" fill="currentColor" aria-hidden>
                    <path d="M4.5 2.5l3.5 3.5-3.5 3.5V6.5H1v-1h3.5z" />
                  </svg>
                </button>
              </li>
            ))}
          </ul>
        </BottomSheet>
      )}

      {/* Language picker */}
      {showLangSheet && (
        <BottomSheet onClose={() => setShowLangSheet(false)} title={t('toolbar.language') || 'Language'}>
          <ul className="divide-y divide-line">
            {locales.map(l => (
              <li key={l.code}>
                <button
                  type="button"
                  className={`w-full text-left px-5 py-4 flex items-center justify-between gap-3 active:bg-paper-soft touch-target ${
                    locale === l.code ? 'text-accent font-medium' : 'text-ink-800'
                  }`}
                  onClick={() => { setLocale(l.code); setShowLangSheet(false); }}
                >
                  <span className="text-[15px]">{l.native}</span>
                  <span className="font-mono text-[12px] text-ink-400 uppercase">{l.code}</span>
                </button>
              </li>
            ))}
          </ul>
        </BottomSheet>
      )}

      {/* Desktop modals — they already handle small viewports via their own
          max-h / overflow rules. Rendered here so mobile users can still use
          the color picker, open dialog, SVG converter, and PNG export. */}
      <ColorPicker
        open={showColorPicker}
        initialColor={turtle.penColor}
        onClose={() => setShowColorPicker(false)}
        onInsertCode={text => editorRef.current?.insertAtCaret(text)}
      />

      <OpenFileDialog
        open={showOpenDialog}
        onClose={() => setShowOpenDialog(false)}
        onPick={handleFilePicked}
      />

      {showExportModal && exportedImage && (
        <MobilePngExport
          image={exportedImage}
          fileName={fileName}
          t={t}
          onClose={() => setShowExportModal(false)}
        />
      )}

    </div>
  );
}

export const MobileShell = memo(MobileShellImpl);

// ────────────────────────────────────────────────────────────────────
//  Pieces
// ────────────────────────────────────────────────────────────────────

/** Renders its children absolutely-positioned; hidden tabs just go
 *  display:none so their React trees stay mounted (scroll state etc.
 *  survives tab switches). */
function TabSlot({ active, children }: { active: boolean; children: React.ReactNode }) {
  return (
    <div
      className="absolute inset-0 flex flex-col min-h-0"
      style={{ visibility: active ? 'visible' : 'hidden', pointerEvents: active ? 'auto' : 'none' }}
      aria-hidden={!active}
    >
      {children}
    </div>
  );
}

function MobileTopBar({
  t,
  fileName,
  errorCount,
  onOpenMore,
  view,
}: {
  t: (k: string, ...a: (string | number)[]) => string;
  fileName: string;
  errorCount: number;
  onOpenMore: () => void;
  view: 'code' | 'canvas' | 'console';
}) {
  const subtitle =
    view === 'code'
      ? t('pane.editor.subtitle')
      : view === 'canvas'
      ? t('pane.canvas.subtitle')
      : t('pane.inspector.subtitle');

  return (
    <header
      className="flex-shrink-0 bg-paper/95 backdrop-blur border-b border-line"
      style={{ paddingTop: 'env(safe-area-inset-top)' }}
    >
      <div className="h-12 px-3 flex items-center gap-2">
        {/* Official KTurtle logo — same asset the desktop shell uses. */}
        <div className="w-8 h-8 rounded-lg bg-white border border-line flex items-center justify-center flex-shrink-0 overflow-hidden">
          <img
            src={`${import.meta.env.BASE_URL}kturtle-logo.svg`}
            alt={t('app.title')}
            className="w-6 h-6"
            width={24}
            height={24}
            draggable={false}
          />
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-display text-[15px] leading-none text-ink-900 truncate" style={{ letterSpacing: '-0.01em' }}>
            {t('app.title')}<span className="text-accent">.</span>
            <span className="italic font-normal text-ink-600"> {fileName}</span>
          </div>
          {/* Subtitle is a quiet way-finder. Hidden on the tightest phones
              (iPhone SE width) so the brand + filename never get clipped. */}
          <div className="hidden min-[360px]:block text-[10.5px] italic text-ink-500 mt-0.5 truncate">
            {subtitle}
          </div>
        </div>
        {errorCount > 0 && (
          <span
            className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-mono tab-nums bg-[#fbeee7] text-[#9c3a17] border border-[#f1d6cc]"
            title={`${errorCount} ${errorCount === 1 ? 'error' : 'errors'}`}
          >
            {errorCount}
          </span>
        )}
        <button
          type="button"
          onClick={onOpenMore}
          aria-label={t('toolbar.more') || 'More'}
          className="touch-target w-10 h-10 rounded-lg text-ink-700 hover:text-ink-900 hover:bg-paper-soft active:bg-paper-sunk inline-flex items-center justify-center transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8} aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
      </div>
    </header>
  );
}

/**
 * Mobile run bar — memoised so it doesn't re-render when the parent
 * re-renders for unrelated reasons (keystrokes in the editor,
 * interpreter frame commits, etc). This is the row the user
 * drags while a program is running, so its idle cost matters.
 */
const MobileRunBar = memo(function MobileRunBar({
  t,
  isRunning,
  runCode,
  speedIdx,
  setSpeedIdx,
  speedLabel,
  speedStepsLen,
  error,
  onJumpToError,
  onOpenMore,
}: {
  t: (k: string, ...a: (string | number)[]) => string;
  isRunning: boolean;
  runCode: () => void;
  speedIdx: number;
  setSpeedIdx: (n: number) => void;
  speedLabel: string;
  speedStepsLen: number;
  error?: TurtleError;
  onJumpToError: () => void;
  onOpenMore: () => void;
}) {
  return (
    <div className="flex-shrink-0 border-t border-line bg-white/95 backdrop-blur">
      {/* Problem chip bar — appears only when there's a current error. */}
      {error && (
        <button
          type="button"
          onClick={onJumpToError}
          className="w-full text-left px-4 py-2 flex items-center gap-2 bg-[#fbeee7] border-b border-[#f1d6cc] text-[#9c3a17] active:bg-[#f8e2d5] transition-colors"
        >
          <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.2} aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M5.07 19h13.86c1.54 0 2.5-1.67 1.73-3L13.73 4a2 2 0 00-3.46 0L3.34 16c-.77 1.33.19 3 1.73 3z" />
          </svg>
          <span className="text-[12px] font-medium truncate">
            {error.messageKey ? t(error.messageKey, ...(error.messageArgs || [])) : error.message}
          </span>
          <span className="ml-auto text-[10.5px] font-mono tab-nums flex-shrink-0">L{error.line}</span>
        </button>
      )}

      <div className="px-3 py-2 flex items-center gap-2">
        {/* Primary run/stop — big thumb target, full visual weight. */}
        <button
          type="button"
          onClick={runCode}
          className={`touch-target flex-shrink-0 inline-flex items-center justify-center gap-2 px-4 h-11 rounded-full text-[14px] font-medium transition-colors ${
            isRunning
              ? 'bg-[#fbeee7] text-[#9c3a17] active:bg-[#f8e2d5]'
              : 'bg-ink-900 text-paper active:bg-accent'
          }`}
          style={{ minWidth: 96 }}
        >
          {isRunning ? (
            <>
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 12 12" aria-hidden>
                <rect x="3" y="3" width="6" height="6" rx="1" />
              </svg>
              {t('toolbar.stop')}
            </>
          ) : (
            <>
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 12 12" aria-hidden>
                <path d="M3 2.5v7L9.5 6z" />
              </svg>
              {t('toolbar.run')}
            </>
          )}
        </button>

        <MobileSpeedDial
          t={t}
          speedIdx={speedIdx}
          setSpeedIdx={setSpeedIdx}
          speedLabel={speedLabel}
          speedStepsLen={speedStepsLen}
        />

        <button
          type="button"
          onClick={onOpenMore}
          className="touch-target w-11 h-11 rounded-full border border-line bg-white text-ink-700 active:bg-paper-soft inline-flex items-center justify-center flex-shrink-0"
          aria-label={t('toolbar.more') || 'More'}
        >
          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden>
            <circle cx="5" cy="12" r="2" />
            <circle cx="12" cy="12" r="2" />
            <circle cx="19" cy="12" r="2" />
          </svg>
        </button>
      </div>
    </div>
  );
});

/**
 * Speed slider with **local** thumb state.
 *
 * The parent `speedIdx` changes trigger a full MobileShell re-render
 * (it owns the same state used elsewhere); on phones that re-render
 * cascade used to run 60×/sec while dragging the slider, which
 * janked the thumb tracking.
 *
 * Fix: keep the thumb position in a local useState, mirror the parent
 * prop when it changes externally, and commit *at most once per
 * animation frame* to the parent via requestAnimationFrame. The
 * interpreter still sees every committed value (it polls speed on
 * every step), so programs responding to the slider continue to feel
 * live — just without the jank.
 */
const MobileSpeedDial = memo(function MobileSpeedDial({
  t,
  speedIdx,
  setSpeedIdx,
  speedLabel,
  speedStepsLen,
}: {
  t: (k: string, ...a: (string | number)[]) => string;
  speedIdx: number;
  setSpeedIdx: (n: number) => void;
  speedLabel: string;
  speedStepsLen: number;
}) {
  const [localIdx, setLocalIdx] = useState(speedIdx);
  // Mirror outside changes (e.g. resetting on a new run) into the
  // local thumb. Bail when the values already match to avoid
  // thrashing mid-drag.
  useEffect(() => {
    setLocalIdx(prev => (prev === speedIdx ? prev : speedIdx));
  }, [speedIdx]);

  const rafRef = useRef<number | null>(null);
  const pendingRef = useRef<number>(speedIdx);
  useEffect(() => () => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
  }, []);

  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const n = Number(e.target.value);
    setLocalIdx(n);
    pendingRef.current = n;
    if (rafRef.current === null) {
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        setSpeedIdx(pendingRef.current);
      });
    }
  };

  // Commit immediately on release so the interpreter gets the final
  // value even if the user let go mid-rAF.
  const commitNow = () => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (pendingRef.current !== speedIdx) setSpeedIdx(pendingRef.current);
  };

  return (
    <label className="flex-1 min-w-0 inline-flex items-center gap-2 h-11 px-3 rounded-full border border-line bg-paper-soft">
      <svg className="w-3.5 h-3.5 text-ink-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8} aria-hidden>
        <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
      </svg>
      <input
        type="range"
        min={0}
        max={speedStepsLen - 1}
        step={1}
        value={localIdx}
        onChange={onChange}
        onPointerUp={commitNow}
        onPointerCancel={commitNow}
        onKeyUp={commitNow}
        className="flex-1 min-w-0 accent-accent touch-none"
        style={{ touchAction: 'none' }}
        aria-label={t('toolbar.speed')}
      />
      <span className="text-[11px] font-mono tab-nums text-ink-700 text-right flex-shrink-0 truncate max-w-[70px]">
        {speedLabel}
      </span>
    </label>
  );
});

function TabButton({
  icon,
  label,
  active,
  badge,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  badge?: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="mobile-tab touch-target"
      data-active={active}
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
    >
      <span className="icon" aria-hidden>{icon}</span>
      <span>{label}</span>
      {badge !== undefined && badge > 0 && <span className="badge">{badge}</span>}
    </button>
  );
}

/** Self-contained canvas pane for mobile with zoom chips + a help strip. */
function MobileCanvasPane({
  canvasRef,
  turtle,
  drawings,
  drawingsLen,
  zoomDisplay,
  setZoomDisplay,
  t,
  isRunning,
}: {
  canvasRef: RefObject<TurtleCanvasHandle | null>;
  turtle: TurtleState;
  drawings: DrawCommand[];
  drawingsLen: number;
  zoomDisplay: number;
  setZoomDisplay: (n: number) => void;
  t: (k: string, ...a: (string | number)[]) => string;
  isRunning: boolean;
}) {
  return (
    <div className="flex flex-col h-full min-w-0 bg-white">
      <div className="flex-1 min-h-0 relative">
        <TurtleCanvas
          ref={canvasRef}
          turtle={turtle}
          drawings={drawings}
          drawingsLen={drawingsLen}
          onZoomChange={setZoomDisplay}
          isRunning={isRunning}
        />

        {/* Floating zoom controls — top-right, thumb-reachable on both
            left- and right-handed use because the canvas pane is
            gesture-driven primarily. */}
        <div className="absolute top-2 right-2 flex flex-col gap-1.5 bg-white/90 backdrop-blur rounded-xl border border-line shadow-sm p-1">
          <IconButton
            ariaLabel="Zoom in"
            onClick={() => canvasRef.current?.zoomIn()}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
          </IconButton>
          <IconButton
            ariaLabel="Zoom out"
            onClick={() => canvasRef.current?.zoomOut()}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="M20 12H4" />
            </svg>
          </IconButton>
          <IconButton
            ariaLabel={t('canvas.fitToScreen')}
            onClick={() => canvasRef.current?.resetView()}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 8V4h4M16 4h4v4M4 16v4h4M20 16v4h-4" />
            </svg>
          </IconButton>
        </div>

        <div className="absolute bottom-2 left-1/2 -translate-x-1/2 pointer-events-none text-[10.5px] text-ink-600 bg-white/85 backdrop-blur px-2.5 py-0.5 rounded-full border border-line/70 font-mono tab-nums">
          {Math.round(zoomDisplay * 100)}%
        </div>
      </div>
    </div>
  );
}

function IconButton({ children, onClick, ariaLabel }: { children: React.ReactNode; onClick: () => void; ariaLabel: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className="touch-target w-10 h-10 rounded-lg text-ink-700 active:bg-paper-soft inline-flex items-center justify-center transition-colors"
    >
      {children}
    </button>
  );
}

// ────────────────────────────────────────────────────────────────────
//  Bottom sheet + PNG export modal
// ────────────────────────────────────────────────────────────────────

function BottomSheet({
  children,
  onClose,
  title,
}: {
  children: React.ReactNode;
  onClose: () => void;
  title: string;
}) {
  // Lock body scroll while the sheet is up.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  // Pointer-driven swipe-down-to-close — the muscle memory every mobile
  // user has. We track a single pointer; if the user drags >= 80px, we
  // dismiss. Anything less snaps back.
  const [dragY, setDragY] = useState(0);
  const dragRef = useRef<{ startY: number; active: boolean }>({ startY: 0, active: false });

  const onPtrDown = (e: React.PointerEvent) => {
    dragRef.current = { startY: e.clientY, active: true };
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
  };
  const onPtrMove = (e: React.PointerEvent) => {
    if (!dragRef.current.active) return;
    const dy = Math.max(0, e.clientY - dragRef.current.startY);
    setDragY(dy);
  };
  const onPtrUp = (e: React.PointerEvent) => {
    if (!dragRef.current.active) return;
    dragRef.current.active = false;
    try { (e.currentTarget as Element).releasePointerCapture?.(e.pointerId); } catch { /* ignore */ }
    if (dragY > 80) onClose();
    else setDragY(0);
  };

  const content = (
    <div
      className="fixed inset-0 z-50 anim-fade flex items-end"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className="absolute inset-0 bg-ink-900/40 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        className="relative w-full bg-white border-t border-line rounded-t-2xl shadow-[0_-24px_60px_-24px_rgba(26,24,20,0.35)] anim-sheet"
        style={{
          maxHeight: 'calc(var(--app-vh) - 48px)',
          paddingBottom: 'env(safe-area-inset-bottom)',
          transform: dragY > 0 ? `translateY(${dragY}px)` : undefined,
          transition: dragRef.current.active ? 'none' : 'transform 0.18s cubic-bezier(0.2, 0.85, 0.25, 1)',
        }}
      >
        <div
          className="cursor-grab active:cursor-grabbing touch-none select-none"
          onPointerDown={onPtrDown}
          onPointerMove={onPtrMove}
          onPointerUp={onPtrUp}
          onPointerCancel={onPtrUp}
        >
          <div className="sheet-grabber" aria-hidden />
          <div className="px-5 pt-1 pb-3 flex items-center justify-between">
            <h3 className="font-display text-[17px] text-ink-900" style={{ letterSpacing: '-0.01em' }}>
              {title}
            </h3>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="touch-target w-10 h-10 -mr-2 rounded-full text-ink-500 active:bg-paper-soft inline-flex items-center justify-center"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
        <div className="overflow-y-auto max-h-[70vh]">
          {children}
        </div>
      </div>
    </div>
  );

  return createPortal(content, document.body);
}

function SheetAction({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="touch-target flex flex-col items-center gap-1.5 p-2 rounded-xl active:bg-paper-soft transition-colors"
    >
      <span className="w-11 h-11 rounded-xl bg-paper-soft border border-line inline-flex items-center justify-center text-ink-800" aria-hidden>
        {icon}
      </span>
      <span className="text-[11px] leading-tight text-ink-700 text-center line-clamp-2">{label}</span>
    </button>
  );
}

function MobilePngExport({
  image,
  fileName,
  t,
  onClose,
}: {
  image: string;
  fileName: string;
  t: (k: string, ...a: (string | number)[]) => string;
  onClose: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const base = fileName.replace(/\.(turtle|logo|txt)$/i, '') || 'kturtle-drawing';
      await exportPngFile(image, `${base}.png`);
      onClose();
    } finally {
      setSaving(false);
    }
  };
  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-white anim-fade"
      role="dialog"
      aria-modal="true"
      aria-label={t('toolbar.file.exportPng')}
      style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="flex items-center justify-between px-4 h-14 border-b border-line flex-shrink-0">
        <h3 className="font-display text-[17px] text-ink-900" style={{ letterSpacing: '-0.01em' }}>
          {t('toolbar.file.exportPng')}
        </h3>
        <button
          onClick={onClose}
          aria-label={t('color.cancel')}
          className="touch-target w-10 h-10 rounded-full text-ink-500 active:bg-paper-soft inline-flex items-center justify-center"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      <div className="flex-1 overflow-auto p-4 bg-paper-soft flex items-center justify-center">
        <img src={image} alt="Exported canvas" className="max-w-full max-h-full rounded-lg shadow" />
      </div>
      <div className="px-4 py-3 border-t border-line flex-shrink-0">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="touch-target w-full inline-flex items-center justify-center gap-2 px-4 h-12 bg-ink-900 text-paper rounded-full text-[14px] font-medium active:bg-accent transition-colors disabled:opacity-60"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3" />
          </svg>
          {t('toolbar.file.exportPng')}
        </button>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
//  Icon primitives (inlined — keeps the bundle small and avoids an
//  external icon library for what are essentially 10 glyphs)
// ────────────────────────────────────────────────────────────────────

function IconCode() {
  return (
    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8} className="w-5 h-5">
      <path strokeLinecap="round" strokeLinejoin="round" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
    </svg>
  );
}
function IconCanvas() {
  return (
    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8} className="w-5 h-5">
      <rect x="3" y="4" width="18" height="14" rx="2" />
      <circle cx="12" cy="11" r="2.5" fill="currentColor" stroke="none" />
    </svg>
  );
}
function IconConsole() {
  return (
    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8} className="w-5 h-5">
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 5h16v14H4z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M7 9l3 3-3 3m6 0h4" />
    </svg>
  );
}
function IconNewFile() {
  return (
    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8} className="w-5 h-5">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
    </svg>
  );
}
function IconOpen() {
  return (
    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8} className="w-5 h-5">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 7h5l2 2h11v10H3z" />
    </svg>
  );
}
function IconSave() {
  return (
    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8} className="w-5 h-5">
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 3h11l3 3v15H5zM8 3v6h8V3M8 21v-6h8v6" />
    </svg>
  );
}
function IconExamples() {
  return (
    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8} className="w-5 h-5">
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z" />
    </svg>
  );
}
function IconReset() {
  return (
    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8} className="w-5 h-5">
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
    </svg>
  );
}
function IconColor() {
  return (
    <svg viewBox="0 0 24 24" className="w-5 h-5" aria-hidden>
      <circle cx="12" cy="12" r="9" fill="url(#mobile-color-grad)" />
      <defs>
        <linearGradient id="mobile-color-grad" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stopColor="#e86a2a" />
          <stop offset="0.4" stopColor="#e6c36a" />
          <stop offset="0.7" stopColor="#5b9bd5" />
          <stop offset="1" stopColor="#8c6ba8" />
        </linearGradient>
      </defs>
    </svg>
  );
}
function IconImage() {
  return (
    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8} className="w-5 h-5">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="8.5" cy="9.5" r="1.5" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 15l-4-4-6 7" />
    </svg>
  );
}
function IconSvg() {
  return (
    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8} className="w-5 h-5">
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 7l2 10h10l2-10H5z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 11l3 3 3-3" />
    </svg>
  );
}
function IconGlobe() {
  return (
    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8} className="w-5 h-5">
      <circle cx="12" cy="12" r="9" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 12h18M12 3a13 13 0 010 18M12 3a13 13 0 000 18" />
    </svg>
  );
}
