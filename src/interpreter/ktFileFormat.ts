/**
 * KTurtle `.turtle` file format (v1.0).
 *
 * Reverse-engineered from the upstream KTurtle source (src/editor.cpp +
 * src/editor.h). The on-disk format is:
 *
 *   kturtle-script-v1.0\n
 *   <source with all translatable tokens wrapped in @(english_name)>
 *
 * That `@(...)` notation is the language-independent exchange form. KTurtle
 * reads files by first checking the magic header, then calling
 * `Translator::localizeScript()` which replaces every `@(keyword)` with the
 * keyword's spelling in the user's current KDE language. This lets the same
 * .turtle file work whether opened by a Russian, Armenian or English user.
 *
 * Since we already use English keywords internally, our job is just to:
 *   - SAVE: wrap every command / keyword / true|false token in @(...)
 *   - LOAD: strip @( ) around any token and validate the magic header
 *
 * The token list below MUST stay aligned with the tokenizer's command /
 * keyword tables. Anything missing here will be saved as literal text and
 * read back fine by OUR interpreter, but may display wrong in KTurtle's
 * non-English UIs.
 */

export const KTURTLE_MAGIC = 'kturtle-script-v1.0';

// All tokens KTurtle considers translatable. Mirrored from
// interpreter/translator.{h,cpp} in upstream KTurtle.
const TRANSLATABLE = new Set<string>([
  // Commands
  'forward', 'fw', 'backward', 'bw', 'turnleft', 'tl', 'turnright', 'tr',
  'direction', 'dir', 'center', 'go', 'gox', 'goy', 'getx', 'gety',
  'penup', 'pu', 'pendown', 'pd', 'penwidth', 'pw', 'pencolor', 'pc',
  'canvassize', 'cs', 'canvascolor', 'cc', 'clear', 'ccl', 'reset',
  'spriteshow', 'ss', 'spritehide', 'sh', 'print', 'fontsize',
  'random', 'rnd', 'message', 'ask', 'wait', 'input', 'inputwindow',
  'sin', 'cos', 'tan', 'arcsin', 'arccos', 'arctan', 'sqrt', 'exp', 'pi',
  'round', 'abs',
  // Control keywords
  'if', 'else', 'while', 'repeat', 'for', 'to', 'step', 'learn', 'return', 'exit',
  'break', 'do',
  // Logical
  'and', 'or', 'not',
  // Boolean literals
  'true', 'false',
]);

/**
 * Detect whether `raw` is a KTurtle .turtle file (has the magic header).
 * Handles CR/LF variants and leading BOM.
 */
export function isKTurtleFile(raw: string): boolean {
  const cleaned = stripBom(raw).replace(/\r\n/g, '\n');
  const firstLine = cleaned.split('\n', 1)[0] ?? '';
  return firstLine.trim() === KTURTLE_MAGIC;
}

/**
 * Parse a KTurtle-format file into plain source (strips magic + @(...)
 * wrappers). If the input is NOT a .turtle file, returns it unchanged so
 * the editor can still open hand-written or legacy plain-text programs.
 */
export function fromKTurtleFile(raw: string): string {
  const cleaned = stripBom(raw).replace(/\r\n/g, '\n');
  if (!isKTurtleFile(cleaned)) {
    return cleaned;
  }
  // Drop the first line (magic) — the rest is the program body.
  const body = cleaned.substring(cleaned.indexOf('\n') + 1);
  // Strip every @(name) → name. Keep whitespace / line breaks exactly as
  // written. The regex is deliberately non-greedy + constrained to word
  // characters so it never eats across unbalanced parens.
  return body.replace(/@\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*\)/g, '$1');
}

/**
 * Serialize plain source into KTurtle .turtle format.
 *
 * Algorithm:
 *   1. Prepend the magic header + newline.
 *   2. Walk the source with a tiny tokenizer that preserves strings,
 *      comments, whitespace, and numbers verbatim. Whenever an identifier
 *      is a known translatable token (case-insensitive), emit `@(name)`
 *      using its lowercase canonical form; otherwise emit it unchanged.
 *
 * We do NOT modify strings, comments, or anything inside `"..."` — KTurtle
 * never translates those, and naive regex replacement would corrupt them.
 */
export function toKTurtleFile(source: string): string {
  const out: string[] = [];
  const src = source;
  let i = 0;
  const n = src.length;

  while (i < n) {
    const c = src[i];

    // Preserve comments (# ... newline) verbatim.
    if (c === '#') {
      const start = i;
      while (i < n && src[i] !== '\n') i++;
      out.push(src.slice(start, i));
      continue;
    }

    // Preserve double-quoted strings verbatim (including the quotes).
    if (c === '"') {
      const start = i;
      i++;
      while (i < n && src[i] !== '"') {
        if (src[i] === '\n') break; // unterminated — let tokenizer complain later
        i++;
      }
      if (i < n && src[i] === '"') i++;
      out.push(src.slice(start, i));
      continue;
    }

    // Identifiers: letters, digits, underscore — starting with a letter/_.
    if (/[A-Za-z_]/.test(c)) {
      const start = i;
      while (i < n && /[A-Za-z0-9_]/.test(src[i])) i++;
      const ident = src.slice(start, i);
      const lower = ident.toLowerCase();
      if (TRANSLATABLE.has(lower)) {
        out.push(`@(${lower})`);
      } else {
        out.push(ident);
      }
      continue;
    }

    // Everything else (whitespace, numbers, punctuation, operators, $vars)
    // is written through unchanged. We do NOT touch $-variables — they are
    // user names, not translatable.
    out.push(c);
    i++;
  }

  return `${KTURTLE_MAGIC}\n${out.join('')}`;
}

function stripBom(s: string): string {
  return s.charCodeAt(0) === 0xfeff ? s.substring(1) : s;
}
