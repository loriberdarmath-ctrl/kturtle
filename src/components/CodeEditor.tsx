import { forwardRef, memo, useEffect, useImperativeHandle, useMemo, useRef } from 'react';
import { TurtleError } from '../interpreter/errors';

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
}

const COMMANDS = new Set([
  'forward', 'fw', 'backward', 'bw', 'turnleft', 'tl', 'turnright', 'tr',
  'direction', 'dir', 'center', 'go', 'gox', 'goy', 'getx', 'gety',
  'penup', 'pu', 'pendown', 'pd', 'penwidth', 'pw', 'pencolor', 'pc',
  'canvassize', 'cs', 'canvascolor', 'cc', 'clear', 'ccl', 'reset',
  'spriteshow', 'ss', 'spritehide', 'sh', 'print', 'fontsize',
  'random', 'rnd', 'message', 'ask', 'wait',
  'sin', 'cos', 'tan', 'arcsin', 'arccos', 'arctan', 'sqrt', 'exp', 'pi',
  'round', 'abs'
]);

const KEYWORDS = new Set(['if', 'else', 'while', 'repeat', 'for', 'to', 'step', 'learn', 'return', 'exit']);
const LOGICAL = new Set(['and', 'or', 'not']);

interface Token {
  type: 'comment' | 'string' | 'number' | 'variable' | 'bracket' | 'keyword' | 'logical' | 'command' | 'operator' | 'comparison' | 'text';
  value: string;
}

const tokenize = (code: string): Token[] => {
  const tokens: Token[] = [];
  let i = 0;

  while (i < code.length) {
    if (code[i] === '#') {
      let comment = '';
      while (i < code.length && code[i] !== '\n') comment += code[i++];
      tokens.push({ type: 'comment', value: comment });
      continue;
    }

    if (code[i] === '"') {
      let str = '"';
      i++;
      while (i < code.length && code[i] !== '"') {
        if (code[i] === '\\' && i + 1 < code.length) str += code[i++];
        str += code[i++];
      }
      if (i < code.length) str += code[i++];
      tokens.push({ type: 'string', value: str });
      continue;
    }

    if (code[i] === '$') {
      let variable = '$';
      i++;
      while (i < code.length && /\w/.test(code[i])) variable += code[i++];
      tokens.push({ type: 'variable', value: variable });
      continue;
    }

    if (/\d/.test(code[i])) {
      let num = '';
      while (i < code.length && /[\d.]/.test(code[i])) num += code[i++];
      tokens.push({ type: 'number', value: num });
      continue;
    }

    if (code[i] === '{' || code[i] === '}') {
      tokens.push({ type: 'bracket', value: code[i++] });
      continue;
    }

    if ((code[i] === '=' || code[i] === '!' || code[i] === '<' || code[i] === '>') && code[i + 1] === '=') {
      tokens.push({ type: 'comparison', value: code[i] + code[i + 1] });
      i += 2;
      continue;
    }

    if (code[i] === '<' || code[i] === '>') {
      tokens.push({ type: 'comparison', value: code[i++] });
      continue;
    }

    if (['+', '-', '*', '/'].includes(code[i])) {
      tokens.push({ type: 'operator', value: code[i++] });
      continue;
    }

    if (/[a-zA-Z_]/.test(code[i])) {
      let word = '';
      while (i < code.length && /\w/.test(code[i])) word += code[i++];
      const lower = word.toLowerCase();
      if (KEYWORDS.has(lower)) tokens.push({ type: 'keyword', value: word });
      else if (LOGICAL.has(lower)) tokens.push({ type: 'logical', value: word });
      else if (COMMANDS.has(lower)) tokens.push({ type: 'command', value: word });
      else tokens.push({ type: 'text', value: word });
      continue;
    }

    tokens.push({ type: 'text', value: code[i++] });
  }

  return tokens;
};

const escapeHtml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Calm, light-theme syntax palette — warm neutrals + muted accents.
const highlightCode = (code: string): string => {
  const tokens = tokenize(code);

  return tokens.map(token => {
    const escaped = escapeHtml(token.value);
    switch (token.type) {
      case 'comment':
        return `<span style="color:#a49c8c;font-style:italic">${escaped}</span>`;
      case 'string':
        return `<span style="color:#6c8c61">${escaped}</span>`;
      case 'number':
        return `<span style="color:#b6652a">${escaped}</span>`;
      case 'variable':
        return `<span style="color:#8a5d3b;font-weight:500">${escaped}</span>`;
      case 'bracket':
        return `<span style="color:#5c564c;font-weight:600">${escaped}</span>`;
      case 'keyword':
        return `<span style="color:#c85a2a;font-weight:600">${escaped}</span>`;
      case 'logical':
        return `<span style="color:#8c6ba8;font-weight:500">${escaped}</span>`;
      case 'command':
        return `<span style="color:#3d6b8a;font-weight:500">${escaped}</span>`;
      case 'comparison':
        return `<span style="color:#b6652a;font-weight:600">${escaped}</span>`;
      case 'operator':
        return `<span style="color:#807869">${escaped}</span>`;
      default:
        return `<span style="color:#2b2722">${escaped}</span>`;
    }
  }).join('');
};

const LINE_HEIGHT = 22;
const TOP_PAD = 16;

function CodeEditorInner(
  { code, onChange, errors, executingLine }: CodeEditorProps,
  forwardedRef: React.Ref<CodeEditorHandle>,
) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const highlightRef = useRef<HTMLPreElement>(null);
  const lineNumbersRef = useRef<HTMLDivElement>(null);
  const errorStripesContainerRef = useRef<HTMLDivElement>(null);
  const execStripeRef = useRef<HTMLDivElement>(null);

  const handleScroll = () => {
    if (textareaRef.current && highlightRef.current && lineNumbersRef.current) {
      highlightRef.current.scrollTop = textareaRef.current.scrollTop;
      highlightRef.current.scrollLeft = textareaRef.current.scrollLeft;
      lineNumbersRef.current.scrollTop = textareaRef.current.scrollTop;
      const y = textareaRef.current.scrollTop;
      if (errorStripesContainerRef.current) {
        errorStripesContainerRef.current.style.transform = `translateY(${-y}px)`;
      }
      if (execStripeRef.current) {
        execStripeRef.current.style.transform = `translateY(${-y}px)`;
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

  // Cached line-number list. Every error line gets a red dot, executing
  // line gets an amber arrow, mirroring KTurtle's step indicator.
  const lineNumberItems = useMemo(
    () =>
      Array.from({ length: lineCount }, (_, i) => {
        const lineNum = i + 1;
        const isErr = errorLines.has(lineNum);
        const isExec = executingLine === lineNum;
        return (
          <div
            key={lineNum}
            style={{
              height: `${LINE_HEIGHT}px`,
              lineHeight: `${LINE_HEIGHT}px`,
              fontSize: '11px',
              fontVariantNumeric: 'tabular-nums',
              color: isErr ? '#c85a2a' : isExec ? '#8f6a1a' : undefined,
              fontWeight: isErr || isExec ? 700 : undefined,
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
            {!isErr && isExec && (
              <span
                aria-hidden
                style={{
                  position: 'absolute',
                  left: -4,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  color: '#e6b84a',
                  fontSize: 10,
                  lineHeight: 1,
                }}
              >
                ▶
              </span>
            )}
            {lineNum}
          </div>
        );
      }),
    [lineCount, errorLines, executingLine],
  );

  useEffect(() => {
    handleScroll();
  }, [code]);

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
  }), [code, onChange]);

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

  return (
    <div className="flex flex-col h-full">
      <div
        className="flex-1 relative overflow-hidden bg-white"
        style={{
          fontFamily: '"JetBrains Mono", "SF Mono", Consolas, monospace',
          fontSize: '13.5px',
          lineHeight: `${LINE_HEIGHT}px`,
        }}
      >
        {/* Line numbers gutter */}
        <div
          ref={lineNumbersRef}
          className="absolute left-0 top-0 bottom-0 w-12 overflow-hidden select-none z-10"
          style={{
            background: '#fbf9f3',
            borderRight: '1px solid #ede8da',
          }}
        >
          <div className="py-4 px-2 text-right tab-nums" style={{ color: '#c2bba9' }}>
            {lineNumberItems}
          </div>
        </div>

        {/* Executing-line tint (yellow) — shown during a run so the user can
            see which statement the turtle is executing. Scrolls with the
            textarea via transform updates in handleScroll(). */}
        {executingLine !== undefined && executingLine > 0 && (
          <div
            ref={execStripeRef}
            aria-hidden
            className="absolute left-12 right-0 pointer-events-none"
            style={{
              top: TOP_PAD + (executingLine - 1) * LINE_HEIGHT,
              height: LINE_HEIGHT,
              background:
                'linear-gradient(to right, rgba(252, 238, 179, 0.85), rgba(252, 238, 179, 0.45) 60%, rgba(252, 238, 179, 0))',
              borderLeft: '2px solid #e6b84a',
              willChange: 'transform',
              zIndex: 1,
              transition: 'top 120ms ease-out',
            }}
          />
        )}

        {/* Error-line tints — one translucent stripe per problem line.
            Every bad line is marked at once so the user sees the full
            damage from a single glance. All stripes share one container
            that scrolls via transform so the sync path is O(1) even when
            a large program has many errors. */}
        {errorLines.size > 0 && (
          <div
            ref={errorStripesContainerRef}
            aria-hidden
            className="absolute left-12 right-0 top-0 pointer-events-none"
            style={{ willChange: 'transform', zIndex: 1, height: 0 }}
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
            Horizontal overflow scrolls instead. */}
        <pre
          ref={highlightRef}
          className="absolute left-12 top-0 right-0 bottom-0 m-0 py-4 px-4 overflow-auto pointer-events-none whitespace-pre"
          style={{
            fontFamily: '"JetBrains Mono", "SF Mono", Consolas, monospace',
            fontSize: '13.5px',
            lineHeight: `${LINE_HEIGHT}px`,
            backgroundColor: 'transparent',
            zIndex: 2,
          }}
          dangerouslySetInnerHTML={{ __html: highlightedHtml }}
        />

        {/* Transparent textarea — must also disable wrapping (wrap="off")
            and use `whitespace-pre` so its layout matches the highlight
            layer exactly; otherwise the caret and the coloured text drift
            apart on long lines. */}
        <textarea
          ref={textareaRef}
          value={code}
          onChange={e => onChange(e.target.value)}
          onScroll={handleScroll}
          wrap="off"
          className="absolute left-12 top-0 right-0 bottom-0 m-0 py-4 px-4 resize-none outline-none whitespace-pre overflow-auto"
          style={{
            fontFamily: '"JetBrains Mono", "SF Mono", Consolas, monospace',
            fontSize: '13.5px',
            lineHeight: `${LINE_HEIGHT}px`,
            background: 'transparent',
            color: 'transparent',
            caretColor: '#c85a2a',
            zIndex: 3,
          }}
          spellCheck={false}
          autoComplete="off"
          autoCapitalize="off"
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
