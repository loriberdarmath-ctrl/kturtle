import { forwardRef, memo, useEffect, useImperativeHandle, useMemo, useRef } from 'react';
import { TurtleError } from '../interpreter/errors';
import { useIsMobile } from '../utils/useBreakpoint';

interface CodeEditorProps {
  code: string;
  onChange: (code: string) => void;
  /** Full error list — every line with a problem gets gutter + row tinting. */
  errors?: TurtleError[];
  /** Line currently being executed (for step / animation highlight). */
  executingLine?: number;
}

export interface CodeEditorHandle {
  /** Move the caret (and viewport) to `line` (1-indexed). */
  jumpToLine: (line: number) => void;
  /** Focus the editor. */
  focus: () => void;
  /** Insert text at caret, moving it to the end of the insertion. */
  insertAtCaret: (text: string) => void;
  /**
   * Imperative per-frame "executing line" setter — used by the run loop
   * to move the amber highlight stripe and optionally auto-scroll the
   * viewport without going through React state. Going through state
   * forces re-renders of the whole editor JSX at 60Hz, which on a
   * 10k-line program means rebuilding the line-number gutter (10k
   * `<div>`s) every frame. Doing it imperatively keeps the run smooth.
   *
   * Pass `undefined` to clear the stripe (e.g. on run end).
   */
  setExecutingLineImperative: (line: number | undefined) => void;
}

const COMMANDS = new Set([
  'forward', 'fw', 'backward', 'bw', 'turnleft', 'tl', 'turnright', 'tr',
  'direction', 'dir', 'center', 'go', 'gox', 'goy', 'getx', 'gety',
  'penup', 'pu', 'pendown', 'pd', 'penwidth', 'pw', 'pencolor', 'pc',
  'canvassize', 'cs', 'canvascolor', 'cc', 'clear', 'ccl', 'reset',
  'spriteshow', 'ss', 'spritehide', 'sh', 'print', 'fontsize',
  'random', 'rnd', 'message', 'ask', 'wait',
  'sin', 'cos', 'tan', 'arcsin', 'arccos', 'arctan', 'sqrt', 'exp', 'pi',
  'round', 'abs',
]);

const KEYWORDS = new Set(['if', 'else', 'while', 'repeat', 'for', 'to', 'step', 'learn', 'return', 'exit']);
const LOGICAL = new Set(['and', 'or', 'not']);

// ── Hot-path helpers ──────────────────────────────────────────────────
// The tokenizer below is the single most-called function in the editor
// (it fires on every keystroke via the useMemo on `code`). Three rules
// dictate its shape:
//   1. No regex on single-char predicates — codepoint comparisons are ~2×
//      faster in V8 and allocate nothing.
//   2. No string concatenation inside inner loops — track start indices
//      and substring once, otherwise long comments / words give O(n²).
//   3. No per-iteration array literals (e.g. `['+','-'].includes`).
const isDigit = (c: number): boolean => c >= 48 && c <= 57;
const isDotOrDigit = (c: number): boolean => isDigit(c) || c === 46;
const isAlpha = (c: number): boolean =>
  (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95;
const isWordChar = (c: number): boolean => isAlpha(c) || isDigit(c);

// Type as a plain numeric tag. Numeric enums serialize to tight switch
// tables in V8 and avoid the per-token { type, value } object overhead.
const T_COMMENT = 0,
  T_STRING = 1,
  T_NUMBER = 2,
  T_VARIABLE = 3,
  T_BRACKET = 4,
  T_KEYWORD = 5,
  T_LOGICAL = 6,
  T_COMMAND = 7,
  T_OPERATOR = 8,
  T_COMPARISON = 9,
  T_TEXT = 10;

// Class names map 1:1 to CSS rules in .syntax-* below. Using classes (vs
// inline `style=`) shaves ~40% off the HTML string length and lets the
// browser cache rule lookups across the whole block.
const TYPE_CLASS: Record<number, string> = {
  [T_COMMENT]: 'syntax-comment',
  [T_STRING]: 'syntax-string',
  [T_NUMBER]: 'syntax-number',
  [T_VARIABLE]: 'syntax-variable',
  [T_BRACKET]: 'syntax-bracket',
  [T_KEYWORD]: 'syntax-keyword',
  [T_LOGICAL]: 'syntax-logical',
  [T_COMMAND]: 'syntax-command',
  [T_OPERATOR]: 'syntax-operator',
  [T_COMPARISON]: 'syntax-comparison',
  [T_TEXT]: 'syntax-text',
};

// Single-pass HTML escape. chained .replace() calls walk the string three
// times; this walks it once.
const escapeHtml = (s: string): string => {
  let out = '';
  let last = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    let repl: string | null = null;
    if (c === 38) repl = '&amp;';
    else if (c === 60) repl = '&lt;';
    else if (c === 62) repl = '&gt;';
    if (repl !== null) {
      if (i > last) out += s.substring(last, i);
      out += repl;
      last = i + 1;
    }
  }
  return last === 0 ? s : out + s.substring(last);
};

/**
 * Tokenize + render highlighted HTML in one pass. We skip the
 * intermediate `Token[]` array entirely — the previous implementation
 * built that array just to `.map().join('')` it, doubling both work and
 * GC pressure. With long files (1 k+ lines) this was measurable.
 */
const highlightCode = (code: string): string => {
  let html = '';
  let i = 0;
  const n = code.length;

  const emit = (type: number, start: number, end: number): void => {
    html +=
      '<span class="' +
      TYPE_CLASS[type] +
      '">' +
      escapeHtml(code.substring(start, end)) +
      '</span>';
  };

  while (i < n) {
    const c = code.charCodeAt(i);

    // '#' → line comment
    if (c === 35) {
      const start = i++;
      while (i < n && code.charCodeAt(i) !== 10 /* \n */) i++;
      emit(T_COMMENT, start, i);
      continue;
    }

    // '"' → string (with \ escapes)
    if (c === 34) {
      const start = i++;
      while (i < n && code.charCodeAt(i) !== 34) {
        if (code.charCodeAt(i) === 92 /* \ */ && i + 1 < n) i++;
        i++;
      }
      if (i < n) i++;
      emit(T_STRING, start, i);
      continue;
    }

    // '$' → variable
    if (c === 36) {
      const start = i++;
      while (i < n && isWordChar(code.charCodeAt(i))) i++;
      emit(T_VARIABLE, start, i);
      continue;
    }

    // digit → number (allowing decimal point)
    if (isDigit(c)) {
      const start = i++;
      while (i < n && isDotOrDigit(code.charCodeAt(i))) i++;
      emit(T_NUMBER, start, i);
      continue;
    }

    // '{' or '}' → bracket
    if (c === 123 || c === 125) {
      emit(T_BRACKET, i, i + 1);
      i++;
      continue;
    }

    // ==, !=, <=, >= → comparison
    if (c === 61 || c === 33 || c === 60 || c === 62) {
      if (i + 1 < n && code.charCodeAt(i + 1) === 61) {
        emit(T_COMPARISON, i, i + 2);
        i += 2;
        continue;
      }
      // bare <, > → still comparison (= and ! alone fall through to text)
      if (c === 60 || c === 62) {
        emit(T_COMPARISON, i, i + 1);
        i++;
        continue;
      }
    }

    // +, -, *, / → operator
    if (c === 43 || c === 45 || c === 42 || c === 47) {
      emit(T_OPERATOR, i, i + 1);
      i++;
      continue;
    }

    // identifier / keyword / command
    if (isAlpha(c)) {
      const start = i++;
      while (i < n && isWordChar(code.charCodeAt(i))) i++;
      const word = code.substring(start, i);
      const lower = word.toLowerCase();
      let type: number;
      if (KEYWORDS.has(lower)) type = T_KEYWORD;
      else if (LOGICAL.has(lower)) type = T_LOGICAL;
      else if (COMMANDS.has(lower)) type = T_COMMAND;
      else type = T_TEXT;
      emit(type, start, i);
      continue;
    }

    // Fallback: single character of plain text (whitespace, commas, etc.)
    // Coalesce consecutive non-token chars into one span to minimise
    // the DOM node count on heavily-indented code.
    const start = i++;
    while (i < n) {
      const cc = code.charCodeAt(i);
      if (
        cc === 35 || cc === 34 || cc === 36 ||
        cc === 123 || cc === 125 ||
        cc === 61 || cc === 33 || cc === 60 || cc === 62 ||
        cc === 43 || cc === 45 || cc === 42 || cc === 47 ||
        isAlpha(cc) || isDigit(cc)
      ) break;
      i++;
    }
    emit(T_TEXT, start, i);
  }

  return html;
};

// Metrics are viewport-dependent. On phones we bump font size to 16px
// (below that iOS auto-zooms any focused input — which breaks the whole
// layout) and taller line-height for comfortable tap-to-caret precision.
// Desktop uses the tighter 13.5/22 grid that fits more code at once.
const DESKTOP_METRICS = { fontSize: 13.5, lineHeight: 22, topPad: 16, gutterWidth: 48 };
const MOBILE_METRICS = { fontSize: 16, lineHeight: 26, topPad: 14, gutterWidth: 44 };

function CodeEditorInner(
  { code, onChange, errors, executingLine }: CodeEditorProps,
  forwardedRef: React.Ref<CodeEditorHandle>,
) {
  const isMobile = useIsMobile();
  const M = isMobile ? MOBILE_METRICS : DESKTOP_METRICS;
  const LINE_HEIGHT = M.lineHeight;
  const TOP_PAD = M.topPad;
  const FONT_SIZE = M.fontSize;
  const GUTTER_W = M.gutterWidth;

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const highlightRef = useRef<HTMLPreElement>(null);
  const lineNumbersRef = useRef<HTMLDivElement>(null);
  const errorStripesContainerRef = useRef<HTMLDivElement>(null);
  const execStripeRef = useRef<HTMLDivElement>(null);
  const execArrowRef = useRef<HTMLDivElement>(null);
  /** Scroll offset that the stripe's `top` is rendered relative to. We
   *  combine it with the scroll's translateY to avoid a full reflow on
   *  every line change. */
  const execLineRef = useRef<number | undefined>(executingLine);

  /** Last known scroll offset — cached so imperative line-moves can
   *  compute the stripe's absolute transform without reading the DOM
   *  (which would force a layout flush). */
  const scrollYRef = useRef(0);

  const handleScroll = () => {
    if (textareaRef.current && highlightRef.current && lineNumbersRef.current) {
      highlightRef.current.scrollTop = textareaRef.current.scrollTop;
      highlightRef.current.scrollLeft = textareaRef.current.scrollLeft;
      lineNumbersRef.current.scrollTop = textareaRef.current.scrollTop;
      const y = textareaRef.current.scrollTop;
      scrollYRef.current = y;
      if (errorStripesContainerRef.current) {
        errorStripesContainerRef.current.style.transform = `translateY(${-y}px)`;
      }
      // The exec stripe/arrow encode BOTH the line offset and scroll offset
      // in one transform, so scroll just re-writes them with the current
      // cached line.
      const line = execLineRef.current;
      if (line !== undefined && line > 0) {
        const ty = TOP_PAD + (line - 1) * LINE_HEIGHT - y;
        if (execStripeRef.current) execStripeRef.current.style.transform = `translateY(${ty}px)`;
        if (execArrowRef.current) execArrowRef.current.style.transform = `translateY(${ty}px)`;
      }
    }
  };

  const lineCount = useMemo(() => code.split('\n').length, [code]);

  // Set of all lines that have at least one error. Rendered as gutter
  // markers + translucent stripes — every problem stays visible at once,
  // not just the first.
  const errorLines = useMemo(() => {
    const s = new Set<number>();
    if (errors) for (const e of errors) s.add(e.line);
    return s;
  }, [errors]);

  // The "primary" error line is the first in source order — used for the
  // auto-scroll-into-view nudge on a fresh failure.
  const firstErrorLine = useMemo(() => {
    if (!errors || errors.length === 0) return undefined;
    return errors.reduce((min, e) => Math.min(min, e.line), Infinity);
  }, [errors]);

  // Expensive: tokenize + build highlighted HTML. Only recompute when the
  // source code actually changes — NOT on every parent re-render.
  const highlightedHtml = useMemo(() => highlightCode(code) + '\n', [code]);

  // Cached line-number list. The executing-line "▶" indicator is NOT
  // rendered inline here — it would force a full rebuild of this
  // (potentially 10k-item) array on every step of a run. Instead we
  // render a single absolutely-positioned arrow whose `top` is driven
  // imperatively from the run loop (see `execArrowRef`), costing zero
  // React work per step.
  const lineNumberItems = useMemo(
    () =>
      Array.from({ length: lineCount }, (_, i) => {
        const lineNum = i + 1;
        const isErr = errorLines.has(lineNum);
        return (
          <div
            key={lineNum}
            style={{
              height: `${LINE_HEIGHT}px`,
              lineHeight: `${LINE_HEIGHT}px`,
              fontSize: isMobile ? '12px' : '11px',
              fontVariantNumeric: 'tabular-nums',
              color: isErr ? '#c85a2a' : undefined,
              fontWeight: isErr ? 700 : undefined,
              position: 'relative',
            }}
          >
            {isErr && (
              <span
                aria-hidden
                style={{
                  position: 'absolute',
                  left: -2,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: '#c85a2a',
                  boxShadow: '0 0 0 2px #fbeee7',
                }}
              />
            )}
            {lineNum}
          </div>
        );
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lineCount, errorLines, isMobile, LINE_HEIGHT],
  );

  useEffect(() => {
    handleScroll();
  }, [code]);

  // Keep execLineRef in sync with the prop so imperative calls and
  // prop-driven updates can't drift apart. This also updates the
  // stripe transform so a prop change (run completion, step debug)
  // visually "lands" the stripe even if no one calls the imperative
  // setter afterwards.
  useEffect(() => {
    execLineRef.current = executingLine;
    const stripe = execStripeRef.current;
    const arrow = execArrowRef.current;
    const show = executingLine !== undefined && executingLine > 0;
    if (stripe) stripe.style.display = show ? 'block' : 'none';
    if (arrow) arrow.style.display = show ? 'block' : 'none';
    if (show && executingLine) {
      const ty = TOP_PAD + (executingLine - 1) * LINE_HEIGHT - scrollYRef.current;
      if (stripe) stripe.style.transform = `translateY(${ty}px)`;
      if (arrow) arrow.style.transform = `translateY(${ty}px)`;
    }
  }, [executingLine, LINE_HEIGHT, TOP_PAD]);

  // When errors first appear, nudge the viewport to the first one (if it
  // would otherwise be offscreen). We deliberately don't fight the user's
  // scroll after that initial reveal.
  useEffect(() => {
    if (!firstErrorLine || !textareaRef.current) return;
    const ta = textareaRef.current;
    const targetY = TOP_PAD + (firstErrorLine - 1) * LINE_HEIGHT;
    if (targetY < ta.scrollTop || targetY > ta.scrollTop + ta.clientHeight - LINE_HEIGHT * 2) {
      ta.scrollTop = Math.max(0, targetY - ta.clientHeight / 2);
      handleScroll();
    }
  }, [firstErrorLine]);

  useImperativeHandle(forwardedRef, () => ({
    focus: () => textareaRef.current?.focus(),
    jumpToLine: (line: number) => {
      const ta = textareaRef.current;
      if (!ta) return;
      const lines = code.split('\n');
      const clamped = Math.max(1, Math.min(line, lines.length));
      // Calculate the character offset at the start of the target line
      let offset = 0;
      for (let i = 0; i < clamped - 1; i++) offset += lines[i].length + 1;
      const end = offset + (lines[clamped - 1]?.length ?? 0);
      ta.focus();
      ta.setSelectionRange(offset, end);
      const targetY = TOP_PAD + (clamped - 1) * LINE_HEIGHT;
      ta.scrollTop = Math.max(0, targetY - ta.clientHeight / 2);
      handleScroll();
    },
    insertAtCaret: (text: string) => {
      const ta = textareaRef.current;
      if (!ta) {
        onChange(code + text);
        return;
      }
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const next = code.slice(0, start) + text + code.slice(end);
      onChange(next);
      // Move caret to end of inserted text after React commits.
      requestAnimationFrame(() => {
        if (!textareaRef.current) return;
        const pos = start + text.length;
        textareaRef.current.focus();
        textareaRef.current.setSelectionRange(pos, pos);
      });
    },
    setExecutingLineImperative: (line: number | undefined) => {
      // Purely DOM-level update: no React state change, no re-render.
      // Used from the run loop's rAF flush — on a tight loop with 10k
      // steps this eliminates 10k full editor re-renders.
      if (execLineRef.current === line) return;
      execLineRef.current = line;
      const stripe = execStripeRef.current;
      const arrow = execArrowRef.current;
      const show = line !== undefined && line > 0;
      if (stripe) stripe.style.display = show ? 'block' : 'none';
      if (arrow) arrow.style.display = show ? 'block' : 'none';
      if (show && line) {
        const ty = TOP_PAD + (line - 1) * LINE_HEIGHT - scrollYRef.current;
        if (stripe) stripe.style.transform = `translateY(${ty}px)`;
        if (arrow) arrow.style.transform = `translateY(${ty}px)`;

        // Auto-scroll when the executing line is about to leave the
        // viewport. Only nudge if really needed — throwing scrollTop
        // every step at animation speeds would fight the user's own
        // scroll. We match the behaviour of the React-state path so
        // the imperative run loop feels identical.
        const ta = textareaRef.current;
        if (ta) {
          const targetY = TOP_PAD + (line - 1) * LINE_HEIGHT;
          const visibleTop = ta.scrollTop;
          const visibleBot = visibleTop + ta.clientHeight;
          if (targetY < visibleTop + LINE_HEIGHT || targetY > visibleBot - LINE_HEIGHT * 2) {
            ta.scrollTop = Math.max(0, targetY - ta.clientHeight / 2);
            handleScroll();
          }
        }
      }
    },
  }), [code, onChange, LINE_HEIGHT, TOP_PAD]);

  // When the executing line changes during a slow/step run, auto-scroll so
  // the highlighted row stays comfortably visible (but only if it was about
  // to scroll off-screen — don't fight a user who's scrolling freely).
  useEffect(() => {
    if (!executingLine || !textareaRef.current) return;
    const ta = textareaRef.current;
    const targetY = TOP_PAD + (executingLine - 1) * LINE_HEIGHT;
    const visibleTop = ta.scrollTop;
    const visibleBot = visibleTop + ta.clientHeight;
    if (targetY < visibleTop + LINE_HEIGHT || targetY > visibleBot - LINE_HEIGHT * 2) {
      ta.scrollTop = Math.max(0, targetY - ta.clientHeight / 2);
      handleScroll();
    }
  }, [executingLine]);

  const codeFontStyle: React.CSSProperties = {
    fontFamily: '"JetBrains Mono", "SF Mono", Consolas, monospace',
    fontSize: `${FONT_SIZE}px`,
    lineHeight: `${LINE_HEIGHT}px`,
  };

  return (
    <div className="flex flex-col h-full">
      <div
        className="flex-1 relative overflow-hidden bg-white no-overscroll"
        style={codeFontStyle}
      >
        {/* Line numbers gutter.
            Width adapts between desktop (48px) and mobile (44px) so the
            numbers stay visually anchored but don't eat phone real estate. */}
        <div
          ref={lineNumbersRef}
          className="absolute left-0 top-0 bottom-0 overflow-hidden select-none z-10"
          style={{
            width: GUTTER_W,
            background: '#fbf9f3',
            borderRight: '1px solid #ede8da',
          }}
        >
          <div
            className="text-right tab-nums"
            style={{
              padding: `${TOP_PAD}px ${isMobile ? 6 : 8}px`,
              color: '#c2bba9',
            }}
          >
            {lineNumberItems}
          </div>
        </div>

        {/* Executing-line tint (yellow) — shown during a run so the user
            can see which statement the turtle is executing.
            Always mounted so the imperative `setExecutingLineImperative`
            handle can just move it via `transform` (cheapest possible
            update path — no React reconciliation, no layout invalidation
            beyond the stripe itself). Positioned with `top: 0` +
            `translateY(line*LINE_HEIGHT - scrollTop)` so both the
            per-line move and the scroll sync go through the SAME
            GPU-accelerated property. */}
        <div
          ref={execStripeRef}
          aria-hidden
          className="absolute right-0 pointer-events-none"
          style={{
            left: GUTTER_W,
            top: 0,
            height: LINE_HEIGHT,
            background:
              'linear-gradient(to right, rgba(252, 238, 179, 0.85), rgba(252, 238, 179, 0.45) 60%, rgba(252, 238, 179, 0))',
            borderLeft: '2px solid #e6b84a',
            willChange: 'transform',
            zIndex: 1,
            display: executingLine !== undefined && executingLine > 0 ? 'block' : 'none',
            transform: `translateY(${TOP_PAD + ((executingLine ?? 1) - 1) * LINE_HEIGHT}px)`,
          }}
        />
        {/* Gutter "▶" arrow. Also always mounted; show/hide + positioning
            happen imperatively so we don't rebuild the gutter every step. */}
        <div
          ref={execArrowRef}
          aria-hidden
          className="absolute pointer-events-none select-none"
          style={{
            left: 2,
            top: 0,
            width: GUTTER_W - 4,
            height: LINE_HEIGHT,
            lineHeight: `${LINE_HEIGHT}px`,
            color: '#e6b84a',
            fontSize: 10,
            textAlign: 'right',
            paddingRight: isMobile ? 14 : 16,
            willChange: 'transform',
            zIndex: 11,
            display: executingLine !== undefined && executingLine > 0 ? 'block' : 'none',
            transform: `translateY(${TOP_PAD + ((executingLine ?? 1) - 1) * LINE_HEIGHT}px)`,
          }}
        >
          ▶
        </div>

        {/* Error-line tints — one translucent stripe per problem line.
            Every bad line is marked at once so the user sees the full
            damage from a single glance. All stripes share one container
            that scrolls via transform so the sync path is O(1) even when
            a large program has many errors. */}
        {errorLines.size > 0 && (
          <div
            ref={errorStripesContainerRef}
            aria-hidden
            className="absolute right-0 top-0 pointer-events-none"
            style={{ left: GUTTER_W, willChange: 'transform', zIndex: 1, height: 0 }}
          >
            {Array.from(errorLines).map(line => (
              <div
                key={line}
                className="absolute left-0 right-0"
                style={{
                  top: TOP_PAD + (line - 1) * LINE_HEIGHT,
                  height: LINE_HEIGHT,
                  background:
                    'linear-gradient(to right, rgba(251, 238, 231, 0.95), rgba(251, 238, 231, 0.55) 60%, rgba(251, 238, 231, 0))',
                  borderLeft: '2px solid #c85a2a',
                }}
              />
            ))}
          </div>
        )}

        {/* Highlighted code.
            IMPORTANT: uses `whitespace-pre` (no wrapping) so each source line
            occupies exactly ONE visual row. With `whitespace-pre-wrap` long
            lines wrapped into multiple rows, which made the gutter numbers,
            the error stripes (positioned by `(line-1)*LINE_HEIGHT`), and the
            actual code drift apart whenever any earlier line wrapped —
            clicking "L16" in the inspector then landed the caret on logical
            line 16 while the red stripe was painted at visual row 16, which
            after wrapping could be a completely different text line.
            Horizontal overflow scrolls instead. Same rule on mobile — the
            phone user pinches/scrolls horizontally just like desktop. */}
        <pre
          ref={highlightRef}
          className="absolute top-0 right-0 bottom-0 m-0 overflow-auto pointer-events-none whitespace-pre"
          style={{
            ...codeFontStyle,
            left: GUTTER_W,
            padding: `${TOP_PAD}px ${isMobile ? 12 : 16}px`,
            backgroundColor: 'transparent',
            zIndex: 2,
          }}
          dangerouslySetInnerHTML={{ __html: highlightedHtml }}
        />

        {/* Transparent textarea — must also disable wrapping (wrap="off")
            and use `whitespace-pre` so its layout matches the highlight
            layer exactly; otherwise the caret and the coloured text drift
            apart on long lines.
            inputMode="text" + autoCapitalize="none" + autoCorrect="off"
            stop mobile keyboards from auto-capitalising `forward` → `Forward`
            or suggesting natural-language replacements mid-typing. */}
        <textarea
          ref={textareaRef}
          value={code}
          onChange={e => onChange(e.target.value)}
          onScroll={handleScroll}
          wrap="off"
          className="absolute top-0 right-0 bottom-0 m-0 resize-none outline-none whitespace-pre overflow-auto no-overscroll"
          style={{
            ...codeFontStyle,
            left: GUTTER_W,
            padding: `${TOP_PAD}px ${isMobile ? 12 : 16}px`,
            background: 'transparent',
            color: 'transparent',
            caretColor: '#c85a2a',
            zIndex: 3,
          }}
          spellCheck={false}
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          inputMode="text"
          data-gramm="false"
        />
      </div>
    </div>
  );
}

// forwardRef + memo so the (expensive) syntax-highlighting component skips
// re-renders when the parent re-renders but our props are unchanged —
// critical during long runs when App state updates many times per second.
export const CodeEditor = memo(forwardRef<CodeEditorHandle, CodeEditorProps>(CodeEditorInner));
CodeEditor.displayName = 'CodeEditor';
