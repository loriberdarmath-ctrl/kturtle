import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { TurtleCanvas, TurtleCanvasHandle } from './components/TurtleCanvas';
import { CodeEditor, CodeEditorHandle } from './components/CodeEditor';
import { InspectorPane, InspectorTab } from './components/InspectorPane';
import { SplitPane } from './components/SplitPane';
import { ColorPicker } from './components/ColorPicker';
import { Popover } from './components/Popover';
import { OpenFileDialog } from './components/OpenFileDialog';
import { remember as rememberRecent } from './utils/recentFiles';
import { drawingsToSvg, downloadSvg } from './utils/exportSvg';
import { toKTurtleFile } from './interpreter/ktFileFormat';
import { tokenize } from './interpreter/tokenizer';
import { Parser } from './interpreter/parser';
import { Interpreter, TurtleState, DrawCommand } from './interpreter/interpreter';
import { TurtleError } from './interpreter/errors';
import { examples, defaultExample } from './examples';
import { SVGConverter } from './components/SVGConverter';
import { useT } from './i18n/context';

const defaultCode = examples[defaultExample];

/** Speed slider positions → ms per command. 0 is instant. */
const SPEED_STEPS = [0, 30, 75, 150, 300, 600, 1200] as const;

export function App() {
  const { t, locale, setLocale, locales } = useT();

  const [code, setCode] = useState(defaultCode);
  const [fileName, setFileName] = useState<string>('turtle.turtle');
  const [exportedImage, setExportedImage] = useState<string | null>(null);
  const [showExportModal, setShowExportModal] = useState(false);
  const [showConverterModal, setShowConverterModal] = useState(false);
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
  const [drawings, setDrawings] = useState<DrawCommand[]>([]);
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
  const pendingStateRef = useRef<TurtleState | null>(null);
  const pendingDrawingsRef = useRef<DrawCommand[] | null>(null);
  const pendingLineRef = useRef<number | null>(null);
  const pendingVarsRef = useRef<Record<string, number | string> | null>(null);
  // Errors are staged the same way so they appear *during* the run (e.g.
  // animated mode hitting a bad command on line 12 shouldn't wait until the
  // program finishes to light up line 12 in red). We stash the latest
  // snapshot and flush on the next animation frame along with the rest.
  const pendingErrorsRef = useRef<TurtleError[] | null>(null);
  const rafHandleRef = useRef<number | null>(null);

  const flushPending = useCallback(() => {
    rafHandleRef.current = null;
    const s = pendingStateRef.current;
    const d = pendingDrawingsRef.current;
    const l = pendingLineRef.current;
    const v = pendingVarsRef.current;
    const e = pendingErrorsRef.current;
    pendingStateRef.current = null;
    pendingDrawingsRef.current = null;
    pendingLineRef.current = null;
    pendingVarsRef.current = null;
    pendingErrorsRef.current = null;
    if (s) setTurtle(s);
    if (d) setDrawings(d);
    if (l !== null) setExecutingLine(l);
    if (v) setVariables(v);
    if (e) setErrors(e);
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
    setVariables({});
    setFunctionNames([]);
    setExecutingLine(undefined);

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

    const interpreter = new Interpreter(info => {
      pendingStateRef.current = info.state;
      pendingDrawingsRef.current = info.drawings;
      pendingLineRef.current = info.line;
      pendingVarsRef.current = info.variables;
      // Only stage errors when the snapshot differs from what's on screen
      // (avoids a state update every single step when nothing has gone
      // wrong). The identity check works because the interpreter produces
      // a fresh slice only when it actually appended an error.
      if (info.errors.length > 0) {
        pendingErrorsRef.current = info.errors;
      }
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
      pendingLineRef.current = null;
      pendingVarsRef.current = null;
      pendingErrorsRef.current = null;

      setTurtle(result.turtle);
      setDrawings(result.drawings);
      setOutput(result.output);
      setVariables(result.variables);
      setFunctionNames(result.functionNames);
      setExecutingLine(undefined);
      setErrors(result.errors);

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
  const saveFile = useCallback(() => {
    const finalName = fileName.endsWith('.turtle') ? fileName : `${fileName}.turtle`;
    const serialized = toKTurtleFile(code);
    const blob = new Blob([serialized], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = finalName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 0);
    rememberRecent(finalName, code);
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

  const exportSvg = useCallback(() => {
    const svg = drawingsToSvg(turtle, drawings);
    const base = fileName.replace(/\.(turtle|logo|txt)$/i, '') || 'kturtle-drawing';
    downloadSvg(svg, base);
  }, [turtle, drawings, fileName]);

  const newFile = useCallback(() => {
    if (code.trim() && !window.confirm(t('file.unsavedPrompt'))) return;
    setCode('');
    setFileName('untitled.turtle');
    resetCanvas();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, t]);

  const speedLabel = useMemo(() => {
    if (speedIdx === 0) return t('toolbar.speed.instant');
    if (speedIdx <= 2) return t('toolbar.speed.fast');
    if (speedIdx === 3) return t('toolbar.speed.normal');
    if (speedIdx <= 5) return t('toolbar.speed.slow');
    return t('toolbar.speed.step');
  }, [speedIdx, t]);

  return (
    <div className="h-screen flex flex-col text-ink-900 overflow-hidden">
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
          {/* Logo + wordmark */}
          <div className="flex items-center gap-2.5 flex-shrink-0">
            <div className="w-8 h-8 rounded-lg bg-white border border-line flex items-center justify-center">
              <svg viewBox="0 0 100 100" className="w-5 h-5">
                <ellipse cx="50" cy="55" rx="24" ry="28" fill="#8fb488" stroke="#5f7a5a" strokeWidth="2.5" />
                <circle cx="50" cy="25" r="11" fill="#a9c9a1" stroke="#5f7a5a" strokeWidth="2" />
                <circle cx="46" cy="23" r="1.6" fill="#1a1814" />
                <circle cx="54" cy="23" r="1.6" fill="#1a1814" />
              </svg>
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

          {/* SVG converter */}
          <button
            onClick={() => setShowConverterModal(true)}
            className="flex-shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[12.5px] text-ink-700 hover:text-ink-900 hover:bg-paper-soft rounded-md transition-colors"
            title={t('toolbar.svgToCode')}
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <span className="hidden lg:inline">{t('toolbar.svgToCode')}</span>
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
                <span>{t('editor.lines', code.split('\n').length)}</span>
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
                  code={code}
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
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ink-900/30 backdrop-blur-sm anim-fade"
          onClick={() => setShowExportModal(false)}
        >
          <div className="surface w-full max-w-2xl anim-rise" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-line">
              <h3 className="font-display text-[18px] text-ink-900" style={{ letterSpacing: '-0.01em' }}>
                {t('toolbar.file.exportPng')}
              </h3>
              <button
                onClick={() => setShowExportModal(false)}
                className="w-8 h-8 rounded-full hover:bg-paper-soft text-ink-500 hover:text-ink-900 inline-flex items-center justify-center transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-5">
              <div className="bg-paper-soft border border-line rounded-xl p-4 mb-4 flex items-center justify-center">
                <img src={exportedImage} alt="Exported canvas" className="max-w-full mx-auto block rounded" />
              </div>
              <div className="flex flex-wrap gap-2">
                <a
                  href={exportedImage}
                  download="kturtle-drawing.png"
                  className="inline-flex items-center gap-2 px-4 py-2 bg-ink-900 text-paper rounded-md text-[13px] font-medium hover:bg-accent transition-colors"
                >
                  {t('toolbar.file.exportPng')}
                </a>
                <button
                  onClick={() => setShowExportModal(false)}
                  className="ml-auto inline-flex items-center px-4 py-2 text-ink-500 hover:text-ink-900 text-[13px]"
                >
                  {t('color.cancel')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showConverterModal && (
        <SVGConverter
          onClose={() => setShowConverterModal(false)}
          onGenerateCode={generatedCode => {
            setCode(generatedCode);
          }}
        />
      )}
    </div>
  );
}

// ────────────────────── Canvas sub-pane ──────────────────────

function CanvasPane({
  canvasRef,
  turtle,
  drawings,
  canvasZoomDisplay,
  setCanvasZoomDisplay,
  onHideInspector,
  inspectorHidden,
}: {
  canvasRef: React.RefObject<TurtleCanvasHandle | null>;
  turtle: TurtleState;
  drawings: DrawCommand[];
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
