import { useState, useCallback, useRef, useEffect, useMemo, useDeferredValue } from 'react';
import { TurtleCanvas, TurtleCanvasHandle } from './components/TurtleCanvas';
import { CodeEditor, CodeEditorHandle } from './components/CodeEditor';
import { InspectorPane, InspectorTab } from './components/InspectorPane';
import { SplitPane } from './components/SplitPane';
import { ColorPicker } from './components/ColorPicker';
import { Popover } from './components/Popover';
import { OpenFileDialog } from './components/OpenFileDialog';
import { remember as rememberRecent } from './utils/recentFiles';
import { drawingsToSvg } from './utils/exportSvg';
import { saveTurtleFile, openTurtleFile, exportSvgFile, exportPngFile } from './utils/nativeIO';
import { toKTurtleFile } from './interpreter/ktFileFormat';
import { tokenize } from './interpreter/tokenizer';
import { Parser } from './interpreter/parser';
import { Interpreter, TurtleState, DrawCommand } from './interpreter/interpreter';
import { TurtleError } from './interpreter/errors';
import { examples, defaultExample } from './examples';
import { useT } from './i18n/context';
import { useIsMobile } from './utils/useBreakpoint';
import { MobileShell } from './components/MobileShell';

const defaultCode = examples[defaultExample];

/** Speed slider positions → ms per command. 0 is instant. */
const SPEED_STEPS = [0, 30, 75, 150, 300, 600, 1200] as const;

export function App() {
  const { t, locale, setLocale, locales } = useT();
  const isMobile = useIsMobile();

  const [code, setCode] = useState(defaultCode);
  // Passed to subtrees that don't need up-to-the-millisecond code (the
  // Inspector shows it in error snippets only). React schedules these at
  // a lower priority so fast typing doesn't stutter while React repaints
  // every syntax-highlighted char in the editor.
  const deferredCode = useDeferredValue(code);
  const [fileName, setFileName] = useState<string>('turtle.turtle');
  const [exportedImage, setExportedImage] = useState<string | null>(null);
  const [showExportModal, setShowExportModal] = useState(false);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [showOpenDialog, setShowOpenDialog] = useState(false);
  const [showReference, setShowReference] = useState(false);
  const canvasRef = useRef<TurtleCanvasHandle>(null);
  const editorRef = useRef<CodeEditorHandle>(null);
  const interpreterRef = useRef<Interpreter | null>(null);
  const fileMenuTriggerRef = useRef<HTMLButtonElement>(null);
  const langMenuTriggerRef = useRef<HTMLButtonElement>(null);

  const [turtle, setTurtle] = useState<TurtleState>({
    x: 200,
    y: 200,
    angle: 0,
    penDown: true,
    penColor: '#000000',
    penWidth: 1,
    visible: true,
    canvasWidth: 400,
    canvasHeight: 400,
    canvasColor: '#ffffff',
    fontSize: 12,
  });
  // `drawings` is the *committed* view of interpreter output that React
  // reads. On long programs we used to slice() the live interpreter array on
  // every rAF, which became the dominant cost (O(n) alloc × 60Hz). Now we
  // commit the live array reference itself and expose a separate
  // `drawingsLen` counter — the canvas reads only up to that length, and
  // consumers that need the *final* state (SVG export, post-run inspection)
  // get a stable reference that we snapshot exactly once when a run ends.
  const [drawings, setDrawings] = useState<DrawCommand[]>([]);
  const [drawingsLen, setDrawingsLen] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const [errors, setErrors] = useState<TurtleError[]>([]);
  /** Convenience — the first error (the one surfaced on the toolbar chip). */
  const error = errors[0];
  // Speed: index 0..6 → instant..very slow. A finer slider replaces the old
  // 5-option dropdown and lets the user feel the speed change continuously.
  const [speedIdx, setSpeedIdx] = useState<number>(0);
  const [executingLine, setExecutingLine] = useState<number | undefined>(undefined);
  const [output, setOutput] = useState<string[]>([]);
  const [variables, setVariables] = useState<Record<string, number | string>>({});
  const [functionNames, setFunctionNames] = useState<string[]>([]);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('turtle');
  const [canvasZoomDisplay, setCanvasZoomDisplay] = useState(1);
  const [inspectorVisible, setInspectorVisible] = useState(true);
  const [showFileMenu, setShowFileMenu] = useState(false);
  const [showLangMenu, setShowLangMenu] = useState(false);

  // ── Mobile-only UI state ────────────────────────────────────────────
  // Which of the three stacked workspaces is visible on phones. Defaults
  // to "code" so the user starts where they can start typing. Auto-switches
  // to "canvas" when a run starts (so they see the drawing happen) and to
  // "console" when errors appear (so they can't miss a problem).
  type MobileView = 'code' | 'canvas' | 'console';
  const [mobileView, setMobileView] = useState<MobileView>('code');
  const [showMobileMore, setShowMobileMore] = useState(false);

  // When a run begins, swing the view to the canvas automatically on
  // phones. On desktop we stay put — the canvas is already visible.
  const prevIsRunning = useRef(false);
  useEffect(() => {
    if (!isMobile) return;
    if (isRunning && !prevIsRunning.current) {
      setMobileView('canvas');
    }
    prevIsRunning.current = isRunning;
  }, [isRunning, isMobile]);

  // When the first error appears after a run, pop the console tab so the
  // user sees it. We key this off the `errors` array length growing from
  // zero — otherwise every keystroke during live error highlighting
  // would keep hijacking the view.
  const prevErrorCount = useRef(0);
  useEffect(() => {
    if (!isMobile) return;
    if (errors.length > 0 && prevErrorCount.current === 0) {
      setMobileView('console');
      setInspectorTab('errors');
    }
    prevErrorCount.current = errors.length;
  }, [errors.length, isMobile]);

  // Keep speed in sync with a live interpreter so the user can slow down /
  // speed up a running animation without restarting.
  const currentSpeedMs = SPEED_STEPS[speedIdx] ?? 0;
  useEffect(() => {
    interpreterRef.current?.setSpeed(currentSpeedMs);
  }, [currentSpeedMs]);

  // rAF-throttled mid-run UI updates. Interpreter fires onStep frequently
  // (every command at animation speeds, every 50 commands at instant speed).
  // We stash the latest state in refs and commit a single React update per
  // animation frame.
  //
  // The pending refs are all *views* on the interpreter's live state, not
  // independent snapshots. We only copy at flush time, and only when a
  // version counter says the underlying data actually changed — which
  // dramatically cuts allocation churn on instant-mode runs (previously
  // every onStep cloned the full drawings array).
  const pendingStateRef = useRef<TurtleState | null>(null);
  const pendingDrawingsRef = useRef<DrawCommand[] | null>(null);
  const pendingDrawingsLenRef = useRef<number>(-1);
  const pendingLineRef = useRef<number | null>(null);
  const pendingVarsMapRef = useRef<Map<string, number | string> | null>(null);
  const pendingVarsVersionRef = useRef<number>(-1);
  const pendingErrorsListRef = useRef<TurtleError[] | null>(null);
  const pendingErrorsVersionRef = useRef<number>(-1);
  // Last-committed versions so we can skip redundant React state updates.
  const committedDrawingsLenRef = useRef<number>(0);
  const committedVarsVersionRef = useRef<number>(-1);
  const committedErrorsVersionRef = useRef<number>(-1);
  const rafHandleRef = useRef<number | null>(null);
  /** True while we want variables to appear in the Inspector during a
   *  run (animation speeds). At instant speed we skip this to avoid
   *  re-rendering the Inspector 60× a second on programs that reassign
   *  a counter every step. Set by `runCode`. */
  const liveVarsDuringRunRef = useRef<boolean>(false);

  /**
   * rAF flush — during a run, does NOT call setState on the hot path.
   *
   * Instead, it calls imperative handles on TurtleCanvas and CodeEditor
   * that update the canvas bitmap and the gutter stripe directly via
   * DOM. This keeps App.tsx (and its huge header / split-pane tree)
   * completely out of the 60Hz re-render loop. The only React state
   * we DO commit during a run is errors — those are rare and the user
   * needs to see them promptly.
   *
   * When the run ends, `runCode` does a final setState with the
   * authoritative result, so all React-driven consumers (SVG export,
   * Inspector's "final variables" view, etc.) converge to the correct
   * end state.
   */
  const flushPending = useCallback(() => {
    rafHandleRef.current = null;

    const s = pendingStateRef.current;
    const dArr = pendingDrawingsRef.current;
    const dLen = pendingDrawingsLenRef.current;
    const l = pendingLineRef.current;
    pendingStateRef.current = null;
    pendingDrawingsRef.current = null;
    pendingDrawingsLenRef.current = -1;
    pendingLineRef.current = null;

    // Fast path: paint directly to the canvas + move the editor stripe
    // via DOM. No React state, no re-render, no memo checks.
    if (s && dArr && dLen >= 0) {
      canvasRef.current?.renderFrame(s, dArr, dLen);
    }
    if (l !== null) {
      editorRef.current?.setExecutingLineImperative(l);
    }

    // Errors: slice only when the version moved. These genuinely need
    // to be in React state because the Inspector shows them as a list.
    const eArr = pendingErrorsListRef.current;
    const eVer = pendingErrorsVersionRef.current;
    pendingErrorsListRef.current = null;
    pendingErrorsVersionRef.current = -1;
    if (eArr && eVer !== committedErrorsVersionRef.current) {
      committedErrorsVersionRef.current = eVer;
      setErrors(eArr.slice());
    }

    // Variables: live-view in the Inspector only matters at animation
    // speeds (users watching each step). At instant speed the run
    // finishes in a blink and a final post-run commit is enough —
    // there we skip the per-frame snapshot to avoid re-rendering the
    // Inspector while a 10k-command program is spinning.
    const vMap = pendingVarsMapRef.current;
    const vVer = pendingVarsVersionRef.current;
    pendingVarsMapRef.current = null;
    pendingVarsVersionRef.current = -1;
    if (
      vMap &&
      vVer !== committedVarsVersionRef.current &&
      liveVarsDuringRunRef.current
    ) {
      committedVarsVersionRef.current = vVer;
      const obj: Record<string, number | string> = {};
      vMap.forEach((value, key) => { obj[key] = value; });
      setVariables(obj);
    }
  }, []);

  const runCode = useCallback(async () => {
    // If a run is in progress, Stop is the action — cancel it.
    if (isRunning && interpreterRef.current) {
      interpreterRef.current.cancel();
      return;
    }

    setIsRunning(true);
    setErrors([]);
    setOutput([]);
    setDrawings([]);
    setDrawingsLen(0);
    setVariables({});
    setFunctionNames([]);
    setExecutingLine(undefined);

    // Only commit variables to React state mid-run when the user is
    // watching at animation speeds (>0ms per step). At instant speed
    // the Inspector would re-render 60× a second for no observable
    // benefit — the run is over before the eye resolves any snapshot.
    liveVarsDuringRunRef.current = currentSpeedMs > 0;

    // Collect tokenizer errors (only unterminated strings currently throw
    // synchronously — tokenize can't easily recover from unknown chars so
    // we wrap that path). Parser + runtime errors both feed into the
    // interpreter's errors[] list so they appear together.
    const tokenizeErrors: TurtleError[] = [];
    let tokens: ReturnType<typeof tokenize>;
    try {
      tokens = tokenize(code);
    } catch (err) {
      if (err instanceof TurtleError) {
        tokenizeErrors.push(err);
        tokens = [];
      } else {
        setErrors([
          new TurtleError(
            err instanceof Error ? err.message : String(err),
            1,
            'tokenize',
          ),
        ]);
        setInspectorTab('errors');
        setIsRunning(false);
        return;
      }
    }

    const parser = new Parser(tokens);
    const ast = parser.parse();
    const parseErrors = parser.getErrors();

    // Reset committed versions so the first real step always gets flushed.
    committedDrawingsLenRef.current = 0;
    committedVarsVersionRef.current = -1;
    committedErrorsVersionRef.current = -1;

    const interpreter = new Interpreter(info => {
      // All fields here are live references into the interpreter. We
      // just stash them — the actual copy happens in flushPending, and
      // only when a version/length change confirms something really
      // changed. This keeps onStep O(1) even on huge drawings.
      pendingStateRef.current = info.state;
      pendingDrawingsRef.current = info.drawings;
      pendingDrawingsLenRef.current = info.drawings.length;
      pendingLineRef.current = info.line;
      pendingVarsMapRef.current = info.variables;
      pendingVarsVersionRef.current = info.variablesVersion;
      pendingErrorsListRef.current = info.errors;
      pendingErrorsVersionRef.current = info.errorsVersion;
      if (rafHandleRef.current === null) {
        rafHandleRef.current = requestAnimationFrame(flushPending);
      }
    }, currentSpeedMs);
    interpreter.seedErrors([...tokenizeErrors, ...parseErrors]);
    interpreterRef.current = interpreter;

    try {
      // Execute the AST even when there were parse errors. The parser
      // synchronises past each bad statement so the remainder is valid, and
      // the interpreter catches per-statement failures — so running the
      // partial tree surfaces *additional* problems (e.g. unknown function
      // names on lines that parsed "fine" but reference typos) together with
      // the parse errors. Tokenize errors still abort execution because the
      // token stream is unreliable past an unterminated string.
      const result =
        tokenizeErrors.length === 0
          ? await interpreter.execute(ast)
          : await interpreter.execute({ type: 'Program', body: [] });

      if (rafHandleRef.current !== null) {
        cancelAnimationFrame(rafHandleRef.current);
        rafHandleRef.current = null;
      }
      pendingStateRef.current = null;
      pendingDrawingsRef.current = null;
      pendingDrawingsLenRef.current = -1;
      pendingLineRef.current = null;
      pendingVarsMapRef.current = null;
      pendingVarsVersionRef.current = -1;
      pendingErrorsListRef.current = null;
      pendingErrorsVersionRef.current = -1;

      setTurtle(result.turtle);
      setDrawings(result.drawings);
      setDrawingsLen(result.drawings.length);
      setOutput(result.output);
      setVariables(result.variables);
      setFunctionNames(result.functionNames);
      setExecutingLine(undefined);
      setErrors(result.errors);
      // Tell the canvas it can drop its "live inputs" cache — the React
      // props we just committed now match what's already painted, and
      // further repaints (zoom, resize) should trust the props.
      canvasRef.current?.endRun();

      if (result.errors.length > 0) {
        setInspectorTab('errors');
      } else if (result.output.length > 0) {
        setInspectorTab('output');
      }
    } catch (err) {
      // Only reached for non-TurtleError surprises (shouldn't happen —
      // the interpreter catches everything inside). Wrap defensively.
      const asTurtleErr =
        err instanceof TurtleError
          ? err
          : new TurtleError(
              err instanceof Error ? err.message : String(err),
              1,
              'runtime',
            );
      setErrors([...tokenizeErrors, ...parseErrors, asTurtleErr]);
      setInspectorTab('errors');
    } finally {
      setIsRunning(false);
      interpreterRef.current = null;
    }
  }, [code, currentSpeedMs, flushPending, isRunning]);

  const resetCanvas = () => {
    setTurtle({
      x: 200,
      y: 200,
      angle: 0,
      penDown: true,
      penColor: '#000000',
      penWidth: 1,
      visible: true,
      canvasWidth: 400,
      canvasHeight: 400,
      canvasColor: '#ffffff',
      fontSize: 12,
    });
    setDrawings([]);
    setDrawingsLen(0);
    setErrors([]);
    setOutput([]);
    setVariables({});
    setFunctionNames([]);
    setExecutingLine(undefined);
    canvasRef.current?.resetView();
  };

  // F5 to run / stop, Ctrl+S to save, Ctrl+O to open
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F5') {
        e.preventDefault();
        runCode();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        saveFile();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        openFile();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runCode, code, fileName]);

  // ── File operations ─────────────────────────────────────────────────
  // Save in the real KTurtle on-disk format: a magic header line followed
  // by the source with all command / keyword tokens wrapped in @(english),
  // so the file opens correctly in upstream KTurtle regardless of its UI
  // language. We also remember the plain text in our recent-files list so
  // re-opening inside the web app doesn't have to round-trip the wrapping.
  const saveFile = useCallback(async () => {
    const finalName = fileName.endsWith('.turtle') ? fileName : `${fileName}.turtle`;
    const serialized = toKTurtleFile(code);
    const result = await saveTurtleFile(serialized, finalName);
    if (result.ok && !result.cancelled) {
      // Remember the *original* plain code (not the @(english)-wrapped
      // on-disk serialization) so the recent-files flow opens fast
      // without re-parsing the wrapper.
      const savedName = result.path?.replace(/^.*[\\/]/, '') || finalName;
      rememberRecent(savedName, code);
    }
  }, [code, fileName]);

  const openFile = useCallback(() => {
    setShowOpenDialog(true);
  }, []);

  /** Called by OpenFileDialog when the user picks an entry. */
  const handleFilePicked = useCallback((name: string, pickedCode: string) => {
    setCode(pickedCode);
    setFileName(name);
    rememberRecent(name, pickedCode);
    resetCanvas();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const exportSvg = useCallback(async () => {
    const svg = drawingsToSvg(turtle, drawings);
    const base = fileName.replace(/\.(turtle|logo|txt)$/i, '') || 'kturtle-drawing';
    await exportSvgFile(svg, `${base}.svg`);
  }, [turtle, drawings, fileName]);

  const newFile = useCallback(() => {
    if (code.trim() && !window.confirm(t('file.unsavedPrompt'))) return;
    setCode('');
    setFileName('untitled.turtle');
    resetCanvas();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, t]);

  // Cached line count — `code.split('\n').length` was running on every
  // App re-render (incl. every ~16ms during a run before we switched to
  // the imperative paint path). Memoizing keeps it O(code changes)
  // instead of O(frames).
  const codeLineCount = useMemo(() => code.split('\n').length, [code]);

  const speedLabel = useMemo(() => {
    if (speedIdx === 0) return t('toolbar.speed.instant');
    if (speedIdx <= 2) return t('toolbar.speed.fast');
    if (speedIdx === 3) return t('toolbar.speed.normal');
    if (speedIdx <= 5) return t('toolbar.speed.slow');
    return t('toolbar.speed.step');
  }, [speedIdx, t]);

  // ── Mobile branch — simpler single-column shell with a bottom tab bar.
  // All the run/edit/save logic is shared with desktop; the mobile shell
  // just re-arranges the UI. We pass everything as one bundle to keep
  // the prop wiring legible.
  if (isMobile) {
    return (
      <MobileShell
        app={{
          code, setCode,
          deferredCode,
          fileName,
          turtle,
          drawings,
          drawingsLen,
          errors, error,
          output,
          variables,
          functionNames,
          executingLine,
          isRunning,
          runCode,
          resetCanvas,
          saveFile,
          openFile,
          newFile,
          exportSvg,
          exportPngFromCanvas: () => canvasRef.current?.exportImage() ?? null,
          canvasRef,
          editorRef,
          speedIdx, setSpeedIdx,
          speedLabel,
          speedStepsLen: SPEED_STEPS.length,
          inspectorTab, setInspectorTab,
          mobileView, setMobileView,
          showMobileMore, setShowMobileMore,
          canvasZoomDisplay, setCanvasZoomDisplay,
          setShowColorPicker,
          setShowOpenDialog,
          setShowExportModal,
          setExportedImage,
          handleFilePicked,
          // Modal visibility + data so MobileShell can render them fullscreen.
          exportedImage, showExportModal,
          showColorPicker, showOpenDialog,
        }}
      />
    );
  }

  return (
    <div className="app-shell flex flex-col text-ink-900 overflow-hidden">
      {/* ─────────── HEADER / TOOLBAR ─────────── */}
      {/* Layout strategy: three horizontal zones.
          [left cluster: brand + file + run controls]
          [middle: flex-1, scrolls horizontally if overflowing — houses
            the less-critical controls so the right-side chips stay visible]
          [right cluster: status + language + error chip]
          Nothing ever wraps → toolbar height is constant, avoiding the
          layout shift / "menu under something" bugs. */}
      <header className="flex-shrink-0 border-b border-line bg-paper/90 backdrop-blur">
        <div className="px-3 sm:px-4 h-12 flex items-center gap-2 min-w-0">
          {/* Logo + wordmark. Using the official KTurtle logo (Wikimedia
              Commons, File:KTurtle_logo.svg) so our brand mark matches
              the upstream desktop app. The file lives in /public so Vite
              serves it as a plain asset. */}
          <div className="flex items-center gap-2.5 flex-shrink-0">
            <div className="w-8 h-8 rounded-lg bg-white border border-line flex items-center justify-center overflow-hidden">
              <img
                src={`${import.meta.env.BASE_URL}kturtle-logo.svg`}
                alt={t('app.title')}
                className="w-6 h-6"
                width={24}
                height={24}
                draggable={false}
              />
            </div>
            <div
              className="font-display text-[16px] font-medium tracking-tight leading-none"
              style={{ letterSpacing: '-0.01em' }}
            >
              {t('app.title')}<span className="text-accent">.</span>
              <span className="italic font-normal text-ink-600">{t('app.subtitle')}</span>
            </div>
          </div>

          {/* File menu (trigger; Popover attached below the toolbar row) */}
          <button
            ref={fileMenuTriggerRef}
            type="button"
            onClick={() => {
              setShowFileMenu(v => !v);
              setShowLangMenu(false);
            }}
            aria-haspopup="menu"
            aria-expanded={showFileMenu}
            className={`flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 text-[12.5px] rounded-md transition-colors ${
              showFileMenu ? 'bg-paper-soft text-ink-900' : 'text-ink-700 hover:text-ink-900 hover:bg-paper-soft'
            }`}
          >
            {t('toolbar.file')}
            <svg
              className={`w-3 h-3 opacity-60 transition-transform ${showFileMenu ? 'rotate-180' : ''}`}
              viewBox="0 0 12 12"
              fill="currentColor"
            >
              <path d="M3 4.5L6 7.5 9 4.5z" />
            </svg>
          </button>
          <Popover
            triggerRef={fileMenuTriggerRef}
            open={showFileMenu}
            onClose={() => setShowFileMenu(false)}
            align="start"
            side="bottom"
            className="w-56 py-1.5 bg-white border border-line rounded-lg shadow-[0_12px_32px_-8px_rgba(26,24,20,0.18)]"
          >
            <MenuItem onClick={() => { newFile(); setShowFileMenu(false); }}>
              {t('toolbar.file.new')}
            </MenuItem>
            <MenuItem onClick={() => { openFile(); setShowFileMenu(false); }} shortcut="Ctrl+O">
              {t('toolbar.file.open')}
            </MenuItem>
            <MenuItem onClick={() => { saveFile(); setShowFileMenu(false); }} shortcut="Ctrl+S">
              {t('toolbar.file.save')}
            </MenuItem>
            <div className="my-1 border-t border-line" />
            <MenuItem
              onClick={() => {
                const img = canvasRef.current?.exportImage();
                if (img) { setExportedImage(img); setShowExportModal(true); }
                setShowFileMenu(false);
              }}
            >
              {t('toolbar.file.exportPng')}
            </MenuItem>
            <MenuItem
              onClick={() => {
                exportSvg();
                setShowFileMenu(false);
              }}
            >
              {t('toolbar.file.exportSvg')}
            </MenuItem>
          </Popover>

          <div className="h-5 w-px bg-line mx-0.5 flex-shrink-0" />

          {/* Run / Stop */}
          <button
            onClick={runCode}
            className={`flex-shrink-0 inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-md text-[12.5px] font-medium transition-colors ${
              isRunning
                ? 'bg-[#fbeee7] text-[#9c3a17] hover:bg-[#f8e2d5]'
                : 'bg-ink-900 text-paper hover:bg-accent'
            }`}
            title={isRunning ? t('toolbar.stop') : t('toolbar.run') + ' (F5)'}
          >
            {isRunning ? (
              <>
                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 12 12">
                  <rect x="3" y="3" width="6" height="6" rx="1" />
                </svg>
                {t('toolbar.stop')}
              </>
            ) : (
              <>
                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 12 12">
                  <path d="M3 2.5v7L9.5 6z" />
                </svg>
                {t('toolbar.run')}
              </>
            )}
          </button>

          <button
            onClick={resetCanvas}
            className="flex-shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[12.5px] text-ink-700 hover:text-ink-900 hover:bg-paper-soft rounded-md transition-colors"
            title={t('toolbar.clear')}
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            <span className="hidden sm:inline">{t('toolbar.clear')}</span>
          </button>

          {/* ── MIDDLE ZONE: scrolls horizontally if it can't fit. No wrap. */}
          <div
            className="toolbar-scroll flex items-center gap-2 min-w-0 flex-1 overflow-x-auto overflow-y-hidden"
            style={{ scrollbarWidth: 'none' }}
          >
          {/* Speed slider — continuous, replaces the old dropdown */}
          <div className="flex-shrink-0 inline-flex items-center gap-2 pl-2.5 pr-2.5 py-1 rounded-md border border-line bg-white">
            <svg className="w-3.5 h-3.5 text-ink-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            <span className="text-[10.5px] text-ink-500 uppercase tracking-[0.08em]">{t('toolbar.speed')}</span>
            <input
              type="range"
              min={0}
              max={SPEED_STEPS.length - 1}
              step={1}
              value={speedIdx}
              onChange={e => setSpeedIdx(Number(e.target.value))}
              className="w-20 accent-accent"
              aria-label={t('toolbar.speed')}
            />
            <span className="text-[11px] text-ink-700 font-mono tab-nums w-14 text-right">{speedLabel}</span>
          </div>

          {/* Examples */}
          <label className="flex-shrink-0 inline-flex items-center gap-1.5 pl-3 pr-1 py-1 rounded-md border border-line bg-white">
            <span className="text-[10.5px] text-ink-500 uppercase tracking-[0.08em]">{t('toolbar.examples')}</span>
            <select
              onChange={e => {
                if (e.target.value) {
                  setCode(examples[e.target.value]);
                  resetCanvas();
                }
              }}
              className="bg-transparent text-[12.5px] text-ink-900 outline-none appearance-none pr-5 cursor-pointer"
              style={{
                backgroundImage:
                  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20' fill='%235c564c'><path d='M5.25 7.5l4.75 5 4.75-5'/></svg>\")",
                backgroundRepeat: 'no-repeat',
                backgroundPosition: 'right 2px center',
                backgroundSize: '12px',
              }}
            >
              <option value="">{t('toolbar.examples.choose')}</option>
              {Object.keys(examples).map(name => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
          </label>

          {/* Color picker */}
          <button
            onClick={() => setShowColorPicker(true)}
            className="flex-shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[12.5px] text-ink-700 hover:text-ink-900 hover:bg-paper-soft rounded-md transition-colors"
            title={t('toolbar.colorPicker')}
          >
            <span
              className="w-4 h-4 rounded-sm border border-line"
              style={{
                background:
                  'conic-gradient(from 0deg, #e86a2a, #e6c36a, #9ab897, #5b9bd5, #8c6ba8, #c06c84, #e86a2a)',
              }}
              aria-hidden
            />
            <span className="hidden md:inline">{t('toolbar.colorPicker')}</span>
          </button>

          </div>
          {/* ── END MIDDLE ZONE ── */}

          {/* Right cluster — always visible, never shrinks. */}
          <div className="flex-shrink-0 flex items-center gap-2">
            {/* Problem chip — collapses to just an icon on narrow screens.
                Shows total error count when there is more than one. */}
            {error && (
              <button
                type="button"
                onClick={() => {
                  setInspectorTab('errors');
                  setInspectorVisible(true);
                  editorRef.current?.jumpToLine(error.line);
                }}
                className="inline-flex items-center gap-1.5 px-2 sm:pl-2 sm:pr-2.5 py-1 rounded-md bg-[#fbeee7] text-[#9c3a17] border border-[#f1d6cc] text-[11.5px] font-medium hover:bg-[#f8e2d5] transition-colors"
                title={error.messageKey ? t(error.messageKey, ...(error.messageArgs || [])) : error.message}
              >
                <svg className="w-3.5 h-3.5 sm:w-3 sm:h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M5.07 19h13.86c1.54 0 2.5-1.67 1.73-3L13.73 4a2 2 0 00-3.46 0L3.34 16c-.77 1.33.19 3 1.73 3z" />
                </svg>
                <span className="hidden sm:inline">
                  {errors.length > 1
                    ? t('toolbar.problemsCount', errors.length)
                    : t('toolbar.problemOnLine', error.line)}
                </span>
                {errors.length > 1 && (
                  <span className="sm:ml-1 inline-flex items-center justify-center min-w-[16px] h-[16px] px-1 rounded-full text-[10px] font-mono tab-nums bg-[#c85a2a] text-white">
                    {errors.length}
                  </span>
                )}
              </button>
            )}

            {/* Running indicator */}
            <span
              className={`hidden lg:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border ${
                isRunning ? 'border-accent/40 text-accent bg-accent-wash' : 'border-line text-ink-500'
              } text-[11px]`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${isRunning ? 'bg-accent animate-pulse' : 'bg-ink-300'}`} />
              {isRunning ? t('toolbar.drawing') : t('toolbar.ready')}
            </span>

            {/* Language switcher */}
            <button
              ref={langMenuTriggerRef}
              type="button"
              onClick={() => {
                setShowLangMenu(v => !v);
                setShowFileMenu(false);
              }}
              aria-haspopup="menu"
              aria-expanded={showLangMenu}
              aria-label={t('toolbar.language')}
              title={t('toolbar.language')}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-[12px] transition-colors ${
                showLangMenu
                  ? 'border-accent text-accent bg-accent-wash/50'
                  : 'border-line bg-white text-ink-800 hover:border-accent hover:text-accent'
              }`}
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.75 17.25h6.5" />
              </svg>
              <span className="font-mono text-[11px] uppercase">{locale}</span>
              <svg
                className={`w-3 h-3 opacity-60 transition-transform ${showLangMenu ? 'rotate-180' : ''}`}
                viewBox="0 0 12 12"
                fill="currentColor"
              >
                <path d="M3 4.5L6 7.5 9 4.5z" />
              </svg>
            </button>
            <Popover
              triggerRef={langMenuTriggerRef}
              open={showLangMenu}
              onClose={() => setShowLangMenu(false)}
              align="end"
              side="bottom"
              className="w-48 py-1 bg-white border border-line rounded-lg shadow-[0_12px_32px_-8px_rgba(26,24,20,0.18)]"
            >
              <div className="px-3 pt-1 pb-1.5 text-[10.5px] uppercase tracking-[0.12em] text-ink-500 font-medium">
                {t('toolbar.language')}
              </div>
              {locales.map(l => (
                <button
                  key={l.code}
                  role="menuitemradio"
                  aria-checked={locale === l.code}
                  onClick={() => { setLocale(l.code); setShowLangMenu(false); }}
                  className={`w-full text-left px-3 py-1.5 text-[13px] flex items-center justify-between hover:bg-paper-soft transition-colors ${
                    locale === l.code ? 'text-accent font-medium bg-accent-wash/40' : 'text-ink-800'
                  }`}
                >
                  <span className="inline-flex items-center gap-2">
                    {locale === l.code && (
                      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 12 12" aria-hidden>
                        <path d="M10 3L4.5 8.5 2 6" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                    {locale !== l.code && <span className="w-3 inline-block" aria-hidden />}
                    <span>{l.native}</span>
                  </span>
                  <span className="text-[10.5px] text-ink-400 uppercase font-mono">{l.code}</span>
                </button>
              ))}
            </Popover>
          </div>
        </div>
      </header>

      {/* ─────────── MAIN 3-PANE LAYOUT ─────────── */}
      <main className="flex-1 min-h-0 overflow-hidden">
        <SplitPane
          defaultFraction={inspectorVisible ? 0.3 : 0.35}
          min1={260}
          min2={300}
          storageKey="kturtle.split.outer"
          handleLabel="Resize editor"
        >
          {/* LEFT: Editor */}
          <section className="flex flex-col h-full min-w-0 bg-white border-r border-line">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-line bg-paper-soft/60 flex-shrink-0">
              <div className="flex items-baseline gap-2 min-w-0">
                <h2 className="text-[12.5px] font-medium text-ink-900 uppercase tracking-[0.1em] truncate">
                  {t('pane.editor')}
                </h2>
                <span className="text-[11px] text-ink-500 italic truncate">
                  {t('pane.editor.subtitle')}
                </span>
              </div>
              <div className="flex items-center gap-2 text-[11px] text-ink-500 font-mono flex-shrink-0">
                <span className="truncate max-w-[140px]">{fileName}</span>
                <span className="text-ink-300">·</span>
                <span>{t('editor.lines', codeLineCount)}</span>
              </div>
            </div>
            <div className="flex-1 min-h-0">
              <CodeEditor
                ref={editorRef}
                code={code}
                onChange={setCode}
                errors={errors}
                executingLine={executingLine}
              />
            </div>
          </section>

          {/* RIGHT: canvas + (optional) inspector, nested split */}
          <div className="flex flex-col h-full min-w-0">
            {inspectorVisible ? (
              <SplitPane
                defaultFraction={0.62}
                min1={320}
                min2={260}
                storageKey="kturtle.split.inner"
                handleLabel="Resize canvas"
              >
                <CanvasPane
                  canvasRef={canvasRef}
                  turtle={turtle}
                  drawings={drawings}
                  drawingsLen={drawingsLen}
                  canvasZoomDisplay={canvasZoomDisplay}
                  setCanvasZoomDisplay={setCanvasZoomDisplay}
                  onHideInspector={() => setInspectorVisible(false)}
                  inspectorHidden={false}
                />
                <InspectorPane
                  errors={errors}
                  output={output}
                  turtle={turtle}
                  variables={variables}
                  functionNames={functionNames}
                  code={deferredCode}
                  activeTab={inspectorTab}
                  onTabChange={setInspectorTab}
                  onJumpToLine={line => editorRef.current?.jumpToLine(line)}
                  onClose={() => setInspectorVisible(false)}
                />
              </SplitPane>
            ) : (
              <CanvasPane
                canvasRef={canvasRef}
                turtle={turtle}
                drawings={drawings}
                drawingsLen={drawingsLen}
                canvasZoomDisplay={canvasZoomDisplay}
                setCanvasZoomDisplay={setCanvasZoomDisplay}
                onHideInspector={() => setInspectorVisible(true)}
                inspectorHidden={true}
              />
            )}
          </div>
        </SplitPane>
      </main>

      {/* ─────────── REFERENCE (collapsed footer strip) ─────────── */}
      <footer className="flex-shrink-0 border-t border-line bg-paper-soft/60">
        <div className="px-4 py-1.5 flex items-center justify-between gap-3 text-[11px] text-ink-500">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => setShowReference(v => !v)}
              className="inline-flex items-center gap-1 hover:text-ink-900 transition-colors"
            >
              <svg
                className={`w-3 h-3 transition-transform ${showReference ? 'rotate-180' : ''}`}
                fill="currentColor"
                viewBox="0 0 12 12"
              >
                <path d="M3 4.5L6 7.5 9 4.5z" />
              </svg>
              {t('reference.title')}
            </button>
            <span className="text-ink-300 hidden md:inline">·</span>
            <span className="hidden md:inline truncate">
              <a
                href="https://docs.kde.org/stable5/en/kturtle/kturtle/index.html"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-ink-900 transition-colors"
              >
                {t('toolbar.handbook')}
              </a>
            </span>
          </div>
          <div className="italic hidden lg:block" style={{ fontFamily: 'var(--font-serif)' }}>
            {t('footer.quote')}
          </div>
        </div>
        {showReference && (
          <div className="border-t border-line bg-white px-4 py-3 grid grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-2 text-[11.5px]">
            <RefBlock
              title={t('reference.movement')}
              items={[
                ['forward X', 'fw X'],
                ['backward X', 'bw X'],
                ['turnleft X', 'tl X'],
                ['turnright X', 'tr X'],
                ['go X, Y', ''],
                ['center', ''],
              ]}
            />
            <RefBlock
              title={t('reference.pen')}
              items={[
                ['penup', 'pu'],
                ['pendown', 'pd'],
                ['pencolor R,G,B', ''],
                ['penwidth X', ''],
              ]}
            />
            <RefBlock
              title={t('reference.canvas')}
              items={[
                ['canvassize X,Y', ''],
                ['canvascolor R,G,B', ''],
                ['clear', ''],
                ['reset', ''],
              ]}
            />
            <RefBlock
              title={t('reference.control')}
              items={[
                ['repeat N { }', ''],
                ['if cond { }', ''],
                ['while cond { }', ''],
                ['for $x=1 to 10', ''],
                ['learn name { }', ''],
              ]}
            />
          </div>
        )}
      </footer>

      {/* ─────────── MODALS ─────────── */}
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
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-ink-900/30 backdrop-blur-sm anim-fade"
          onClick={() => setShowExportModal(false)}
        >
          {/*
            Export PNG preview.

            The modal is capped at `calc(100vh - 2rem)` with a flex column
            so the preview image gets the vertical slack and scrolls when
            it can't fit — previously a large canvas export would push
            the Save button off the bottom of the screen.
          */}
          <div
            className="surface w-full max-w-2xl anim-rise flex flex-col"
            onClick={e => e.stopPropagation()}
            style={{ maxHeight: 'calc(100vh - 1.5rem)' }}
          >
            <div className="flex-shrink-0 flex items-center justify-between px-5 py-3 border-b border-line">
              <h3 className="font-display text-[18px] text-ink-900" style={{ letterSpacing: '-0.01em' }}>
                {t('toolbar.file.exportPng')}
              </h3>
              <button
                onClick={() => setShowExportModal(false)}
                className="w-8 h-8 rounded-full hover:bg-paper-soft text-ink-500 hover:text-ink-900 inline-flex items-center justify-center transition-colors"
                aria-label={t('color.cancel')}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            {/* Scrollable preview pane — the only part that can grow. */}
            <div className="flex-1 min-h-0 overflow-auto p-5">
              <div className="bg-paper-soft border border-line rounded-xl p-4 flex items-center justify-center">
                <img
                  src={exportedImage}
                  alt="Exported canvas"
                  className="max-w-full h-auto block rounded"
                  style={{ maxHeight: '55vh', objectFit: 'contain' }}
                />
              </div>
            </div>
            <div className="flex-shrink-0 px-5 py-3 border-t border-line flex flex-wrap items-center gap-2 bg-paper-soft/40">
              <button
                onClick={async () => {
                  const base =
                    fileName.replace(/\.(turtle|logo|txt)$/i, '') || 'kturtle-drawing';
                  await exportPngFile(exportedImage, `${base}.png`);
                  setShowExportModal(false);
                }}
                className="inline-flex items-center gap-2 px-4 py-2 bg-ink-900 text-paper rounded-md text-[13px] font-medium hover:bg-accent transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} aria-hidden>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3" />
                </svg>
                {t('toolbar.file.exportPng')}
              </button>
              <button
                onClick={() => setShowExportModal(false)}
                className="ml-auto inline-flex items-center px-4 py-2 text-ink-500 hover:text-ink-900 text-[13px]"
              >
                {t('color.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

// ────────────────────── Canvas sub-pane ──────────────────────

function CanvasPane({
  canvasRef,
  turtle,
  drawings,
  drawingsLen,
  canvasZoomDisplay,
  setCanvasZoomDisplay,
  onHideInspector,
  inspectorHidden,
}: {
  canvasRef: React.RefObject<TurtleCanvasHandle | null>;
  turtle: TurtleState;
  drawings: DrawCommand[];
  drawingsLen: number;
  canvasZoomDisplay: number;
  setCanvasZoomDisplay: (n: number) => void;
  onHideInspector: () => void;
  inspectorHidden: boolean;
}) {
  const { t } = useT();
  return (
    <div className="flex flex-col h-full min-w-0 bg-white">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-line bg-paper-soft/60 flex-shrink-0">
        <div className="flex items-baseline gap-2 min-w-0">
          <h2 className="text-[12.5px] font-medium text-ink-900 uppercase tracking-[0.1em] truncate">
            {t('pane.canvas')}
          </h2>
          <span className="text-[11px] text-ink-500 italic truncate hidden sm:inline">
            {t('pane.canvas.subtitle')}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => canvasRef.current?.zoomOut()}
            className="w-7 h-7 rounded-md text-ink-500 hover:text-ink-900 hover:bg-paper-soft inline-flex items-center justify-center transition-colors"
            title="Zoom out"
            aria-label="Zoom out"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M20 12H4" />
            </svg>
          </button>
          <span className="text-[11px] font-mono text-ink-700 tab-nums w-12 text-center">
            {Math.round(canvasZoomDisplay * 100)}%
          </span>
          <button
            onClick={() => canvasRef.current?.zoomIn()}
            className="w-7 h-7 rounded-md text-ink-500 hover:text-ink-900 hover:bg-paper-soft inline-flex items-center justify-center transition-colors"
            title="Zoom in"
            aria-label="Zoom in"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
          </button>
          <button
            onClick={() => canvasRef.current?.resetView()}
            className="ml-1 px-2 h-7 rounded-md text-[11px] text-ink-500 hover:text-ink-900 hover:bg-paper-soft transition-colors"
            title={t('canvas.resetView')}
          >
            {t('canvas.fitToScreen')}
          </button>
          <div className="w-px h-4 bg-line mx-1" />
          <button
            onClick={onHideInspector}
            className="w-7 h-7 rounded-md text-ink-500 hover:text-ink-900 hover:bg-paper-soft inline-flex items-center justify-center transition-colors"
            title={inspectorHidden ? t('pane.show') : t('pane.hide')}
            aria-label={inspectorHidden ? t('pane.show') : t('pane.hide')}
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              {inspectorHidden ? (
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 5l-7 7 7 7" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              )}
            </svg>
          </button>
        </div>
      </div>
      <div className="flex-1 min-h-0 relative">
        <TurtleCanvas
          ref={canvasRef}
          turtle={turtle}
          drawings={drawings}
          drawingsLen={drawingsLen}
          onZoomChange={setCanvasZoomDisplay}
        />
        <div className="absolute bottom-2 left-1/2 -translate-x-1/2 pointer-events-none text-[10.5px] text-ink-500 bg-white/70 backdrop-blur px-2 py-0.5 rounded-full border border-line/70">
          {t('canvas.zoomHint')}
        </div>
      </div>
    </div>
  );
}

// ────────────────────── small helpers ──────────────────────

function MenuItem({
  onClick,
  children,
  shortcut,
}: {
  onClick: () => void;
  children: React.ReactNode;
  shortcut?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left px-3 py-1.5 text-[13px] text-ink-800 hover:bg-paper-soft flex items-center justify-between gap-6"
    >
      <span>{children}</span>
      {shortcut && <span className="text-[10.5px] text-ink-400 font-mono">{shortcut}</span>}
    </button>
  );
}

function RefBlock({ title, items }: { title: string; items: [string, string][] }) {
  return (
    <div>
      <h3 className="text-[10.5px] uppercase tracking-[0.12em] text-ink-500 mb-1 font-medium">
        {title}
      </h3>
      <ul className="space-y-0.5 font-mono">
        {items.map(([primary, alias], i) => (
          <li key={i} className="flex items-baseline justify-between gap-2">
            <span className="text-ink-800">{primary}</span>
            {alias && <span className="text-ink-400 text-[10.5px]">{alias}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
