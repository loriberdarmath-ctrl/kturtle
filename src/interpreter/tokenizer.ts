// TurtleScript Tokenizer based on KTurtle Handbook
import { TurtleError } from './errors';

export type TokenType =
  | 'NUMBER'
  | 'STRING'
  | 'IDENTIFIER'
  | 'VARIABLE'
  | 'COMMAND'
  | 'KEYWORD'
  | 'OPERATOR'
  | 'COMPARISON'
  | 'LOGICAL'
  | 'LPAREN'
  | 'RPAREN'
  | 'LBRACE'
  | 'RBRACE'
  | 'COMMA'
  | 'ASSIGN'
  | 'NEWLINE'
  | 'EOF'
  | 'COMMENT';

export interface Token {
  type: TokenType;
  value: string;
  line: number;
  column: number;
}

const COMMANDS = [
  'forward', 'fw', 'backward', 'bw', 'turnleft', 'tl', 'turnright', 'tr',
  'direction', 'dir', 'center', 'go', 'gox', 'goy', 'getx', 'gety',
  'penup', 'pu', 'pendown', 'pd', 'penwidth', 'pw', 'pencolor', 'pc',
  'canvassize', 'cs', 'canvascolor', 'cc', 'clear', 'ccl', 'reset',
  'spriteshow', 'ss', 'spritehide', 'sh', 'print', 'fontsize',
  'random', 'rnd', 'message', 'ask', 'wait',
  'sin', 'cos', 'tan', 'arcsin', 'arccos', 'arctan', 'sqrt', 'exp', 'pi',
  'round', 'abs'
];

const KEYWORDS = ['if', 'else', 'while', 'repeat', 'for', 'to', 'step', 'learn', 'return', 'exit'];
const LOGICAL = ['and', 'or', 'not'];

export function tokenize(code: string): Token[] {
  const tokens: Token[] = [];
  let pos = 0;
  let line = 1;
  let column = 1;

  while (pos < code.length) {
    const char = code[pos];

    // Skip whitespace (except newlines)
    if (char === ' ' || char === '\t') {
      pos++;
      column++;
      continue;
    }

    // Newline
    if (char === '\n') {
      tokens.push({ type: 'NEWLINE', value: '\n', line, column });
      pos++;
      line++;
      column = 1;
      continue;
    }

    // Carriage return
    if (char === '\r') {
      pos++;
      continue;
    }

    // Comments
    if (char === '#') {
      const start = pos;
      while (pos < code.length && code[pos] !== '\n') {
        pos++;
      }
      tokens.push({ type: 'COMMENT', value: code.slice(start, pos), line, column });
      continue;
    }

    // Strings
    if (char === '"') {
      const startLine = line;
      const startCol = column;
      pos++;
      column++;
      let str = '';
      while (pos < code.length && code[pos] !== '"') {
        if (code[pos] === '\n') {
          // Unterminated string on a single line — report at the opening quote.
          throw new TurtleError(
            'String was never closed — missing a " (double quote).',
            startLine,
            'tokenize',
            startCol,
            'error.unclosedString',
          );
        }
        column++;
        str += code[pos];
        pos++;
      }
      if (pos >= code.length) {
        throw new TurtleError(
          'String was never closed — missing a " (double quote).',
          startLine,
          'tokenize',
          startCol,
          'error.unclosedString',
        );
      }
      pos++; // Skip closing quote
      column++;
      tokens.push({ type: 'STRING', value: str, line: startLine, column: startCol });
      continue;
    }

    // Numbers
    if (/[0-9]/.test(char) || (char === '-' && pos + 1 < code.length && /[0-9]/.test(code[pos + 1]))) {
      const startCol = column;
      let num = '';
      if (char === '-') {
        num = '-';
        pos++;
        column++;
      }
      while (pos < code.length && /[0-9.]/.test(code[pos])) {
        num += code[pos];
        pos++;
        column++;
      }
      tokens.push({ type: 'NUMBER', value: num, line, column: startCol });
      continue;
    }

    // Variables (start with $)
    if (char === '$') {
      const startCol = column;
      pos++;
      column++;
      let name = '';
      while (pos < code.length && /[a-zA-Z0-9_]/.test(code[pos])) {
        name += code[pos];
        pos++;
        column++;
      }
      tokens.push({ type: 'VARIABLE', value: name, line, column: startCol });
      continue;
    }

    // Identifiers, commands, keywords
    if (/[a-zA-Z_]/.test(char)) {
      const startCol = column;
      let id = '';
      while (pos < code.length && /[a-zA-Z0-9_]/.test(code[pos])) {
        id += code[pos];
        pos++;
        column++;
      }
      const lower = id.toLowerCase();
      if (COMMANDS.includes(lower)) {
        tokens.push({ type: 'COMMAND', value: lower, line, column: startCol });
      } else if (KEYWORDS.includes(lower)) {
        tokens.push({ type: 'KEYWORD', value: lower, line, column: startCol });
      } else if (LOGICAL.includes(lower)) {
        tokens.push({ type: 'LOGICAL', value: lower, line, column: startCol });
      } else {
        tokens.push({ type: 'IDENTIFIER', value: id, line, column: startCol });
      }
      continue;
    }

    // Operators and punctuation
    if (char === '+' || char === '-' || char === '*' || char === '/') {
      tokens.push({ type: 'OPERATOR', value: char, line, column });
      pos++;
      column++;
      continue;
    }

    if (char === '=' && code[pos + 1] === '=') {
      tokens.push({ type: 'COMPARISON', value: '==', line, column });
      pos += 2;
      column += 2;
      continue;
    }

    if (char === '!' && code[pos + 1] === '=') {
      tokens.push({ type: 'COMPARISON', value: '!=', line, column });
      pos += 2;
      column += 2;
      continue;
    }

    if (char === '>' && code[pos + 1] === '=') {
      tokens.push({ type: 'COMPARISON', value: '>=', line, column });
      pos += 2;
      column += 2;
      continue;
    }

    if (char === '<' && code[pos + 1] === '=') {
      tokens.push({ type: 'COMPARISON', value: '<=', line, column });
      pos += 2;
      column += 2;
      continue;
    }

    if (char === '>' || char === '<') {
      tokens.push({ type: 'COMPARISON', value: char, line, column });
      pos++;
      column++;
      continue;
    }

    if (char === '=') {
      tokens.push({ type: 'ASSIGN', value: '=', line, column });
      pos++;
      column++;
      continue;
    }

    if (char === '(') {
      tokens.push({ type: 'LPAREN', value: '(', line, column });
      pos++;
      column++;
      continue;
    }

    if (char === ')') {
      tokens.push({ type: 'RPAREN', value: ')', line, column });
      pos++;
      column++;
      continue;
    }

    if (char === '{') {
      tokens.push({ type: 'LBRACE', value: '{', line, column });
      pos++;
      column++;
      continue;
    }

    if (char === '}') {
      tokens.push({ type: 'RBRACE', value: '}', line, column });
      pos++;
      column++;
      continue;
    }

    if (char === ',') {
      tokens.push({ type: 'COMMA', value: ',', line, column });
      pos++;
      column++;
      continue;
    }

    // Unknown character, skip
    pos++;
    column++;
  }

  tokens.push({ type: 'EOF', value: '', line, column });
  return tokens;
}
