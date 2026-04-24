// TurtleScript Parser - Creates AST from tokens
import { Token, TokenType } from './tokenizer';
import { TurtleError } from './errors';

/**
 * Commands that never take arguments. The parser stops looking for args
 * immediately when it sees one of these, so `penup\nforward 10` is always
 * two separate statements and `forward` is never accidentally consumed as
 * penup's argument.
 */
const NO_ARG_COMMANDS = new Set<string>([
  'penup', 'pu',
  'pendown', 'pd',
  'clear', 'ccl',
  'reset',
  'center',
  'spriteshow', 'ss',
  'spritehide', 'sh',
  'getx', 'gety',
  'pi',
]);

export type ASTNode =
  | { type: 'Program'; body: ASTNode[] }
  | { type: 'Command'; name: string; args: ASTNode[]; line: number }
  | { type: 'Number'; value: number; line: number }
  | { type: 'String'; value: string; line: number }
  | { type: 'Variable'; name: string; line: number }
  | { type: 'Assignment'; name: string; value: ASTNode; line: number }
  | { type: 'BinaryOp'; operator: string; left: ASTNode; right: ASTNode; line: number }
  | { type: 'UnaryOp'; operator: string; operand: ASTNode; line: number }
  | { type: 'Comparison'; operator: string; left: ASTNode; right: ASTNode; line: number }
  | { type: 'Logical'; operator: string; left?: ASTNode; right: ASTNode; line: number }
  | { type: 'If'; condition: ASTNode; body: ASTNode[]; elseBody?: ASTNode[]; line: number }
  | { type: 'While'; condition: ASTNode; body: ASTNode[]; line: number }
  | { type: 'Repeat'; count: ASTNode; body: ASTNode[]; line: number }
  | { type: 'For'; variable: string; start: ASTNode; end: ASTNode; step?: ASTNode; body: ASTNode[]; line: number }
  | { type: 'Learn'; name: string; params: string[]; body: ASTNode[]; line: number }
  | { type: 'Return'; value: ASTNode; line: number }
  | { type: 'Exit'; line: number }
  | { type: 'FunctionCall'; name: string; args: ASTNode[]; line: number };

export class Parser {
  private tokens: Token[];
  private pos: number = 0;
  /**
   * Collected parse errors. A proper IDE surfaces every mistake at once so
   * the user can fix them in one pass instead of playing whack-a-mole. On
   * each failure the parser records the error and synchronises past the
   * offending construct to keep parsing — same strategy as modern compilers
   * (e.g. Kotlin, Rust, TypeScript).
   */
  private errors: TurtleError[] = [];

  constructor(tokens: Token[]) {
    // Comments are always meaningless to the parser. NEWLINE tokens, on the
    // other hand, DO matter — they terminate a statement's argument list so
    // that `forward 10\nturnright 90` isn't parsed as `forward 10 turnright 90`.
    // KTurtle's tokenizer preserves EndOfLine for the same reason.
    this.tokens = tokens.filter(t => t.type !== 'COMMENT');
  }

  /** Read-only view of every parse error encountered during parse(). */
  getErrors(): TurtleError[] {
    return this.errors;
  }

  /** Skip consecutive NEWLINE tokens at the current position. */
  private skipNewlines(): void {
    while (this.current().type === 'NEWLINE') this.pos++;
  }

  /**
   * After a parse error, discard tokens until we reach a likely statement
   * boundary: a newline, a closing brace, a KEYWORD/COMMAND at the start
   * of a new statement, or EOF. This lets us keep parsing and collect more
   * errors in the same pass.
   */
  private synchronize(): void {
    // At minimum, consume one token so we don't infinite-loop at the same
    // position in case the error was raised without advancing.
    if (this.current().type !== 'EOF') this.pos++;
    while (this.current().type !== 'EOF') {
      const t = this.current();
      if (t.type === 'NEWLINE' || t.type === 'RBRACE') return;
      // A COMMAND / KEYWORD almost always starts a new statement — bail out
      // here so the outer parse loop can pick it up cleanly.
      if (t.type === 'COMMAND' || t.type === 'KEYWORD') return;
      this.pos++;
    }
  }

  private current(): Token {
    return this.tokens[this.pos] || { type: 'EOF', value: '', line: 0, column: 0 };
  }

  private peek(offset: number = 0): Token {
    return this.tokens[this.pos + offset] || { type: 'EOF', value: '', line: 0, column: 0 };
  }

  private advance(): Token {
    return this.tokens[this.pos++];
  }

  private expect(type: TokenType, value?: string): Token {
    const token = this.current();
    if (token.type !== type || (value !== undefined && token.value !== value)) {
      const expected = value !== undefined ? `'${value}'` : this.friendlyType(type);
      const got =
        token.type === 'EOF'
          ? 'end of program'
          : `'${token.value}' (${this.friendlyType(token.type)})`;
      throw new TurtleError(
        `Expected ${expected} but got ${got}.`,
        token.line,
        'parse',
        token.column,
        'error.expectedGot',
        [expected, got],
      );
    }
    return this.advance();
  }

  private friendlyType(t: TokenType): string {
    switch (t) {
      case 'LBRACE': return '{';
      case 'RBRACE': return '}';
      case 'LPAREN': return '(';
      case 'RPAREN': return ')';
      case 'COMMA': return ',';
      case 'ASSIGN': return '=';
      case 'KEYWORD': return 'keyword';
      case 'COMMAND': return 'command';
      case 'VARIABLE': return 'variable';
      case 'NUMBER': return 'number';
      case 'STRING': return 'string';
      case 'IDENTIFIER': return 'name';
      case 'OPERATOR': return 'operator';
      case 'COMPARISON': return 'comparison';
      case 'LOGICAL': return 'logical';
      case 'NEWLINE': return 'newline';
      case 'EOF': return 'end of program';
      case 'COMMENT': return 'comment';
    }
  }

  parse(): ASTNode {
    const body: ASTNode[] = [];
    this.skipNewlines();
    while (this.current().type !== 'EOF') {
      try {
        const stmt = this.parseStatement();
        if (stmt) body.push(stmt);
      } catch (err) {
        if (err instanceof TurtleError) {
          this.errors.push(err);
          this.synchronize();
        } else {
          throw err;
        }
      }
      this.skipNewlines();
    }
    return { type: 'Program', body };
  }

  private parseStatement(): ASTNode | null {
    this.skipNewlines();
    const token = this.current();

    if (token.type === 'VARIABLE' && this.peek(1).type === 'ASSIGN') {
      return this.parseAssignment();
    }

    if (token.type === 'KEYWORD') {
      switch (token.value) {
        case 'if': return this.parseIf();
        case 'while': return this.parseWhile();
        case 'repeat': return this.parseRepeat();
        case 'for': return this.parseFor();
        case 'learn': return this.parseLearn();
        case 'return': return this.parseReturn();
        case 'exit': {
          this.advance();
          return { type: 'Exit', line: token.line };
        }
      }
    }

    if (token.type === 'COMMAND') {
      return this.parseCommand();
    }

    if (token.type === 'IDENTIFIER') {
      return this.parseFunctionCall();
    }

    // At the statement level, anything that isn't a command / keyword /
    // variable-assignment / function-call is a real error — silently
    // swallowing it would hide legitimate bugs like `) 5` or stray numbers.
    throw new TurtleError(
      `Unexpected ${this.friendlyType(token.type)} '${token.value}' at the start of a statement.`,
      token.line,
      'parse',
      token.column,
      'error.unexpectedToken',
      [this.friendlyType(token.type), token.value],
    );
  }

  private parseAssignment(): ASTNode {
    const varToken = this.expect('VARIABLE');
    this.expect('ASSIGN');
    const value = this.parseExpression();
    return { type: 'Assignment', name: varToken.value, value, line: varToken.line };
  }

  private parseCommand(): ASTNode {
    const cmdToken = this.advance();
    const args: ASTNode[] = [];

    // Commands that take NO arguments (return values or side-effect only).
    // We stop argument parsing immediately for these so the next token is
    // treated as its own statement — `penup\nforward 10` must parse as two
    // separate statements, not one command with `forward` as a mistaken arg.
    const argless = NO_ARG_COMMANDS.has(cmdToken.value);

    if (argless) {
      return { type: 'Command', name: cmdToken.value, args, line: cmdToken.line };
    }

    // Parse arguments until a statement-terminating token appears.
    while (
      this.current().type !== 'EOF' &&
      this.current().type !== 'NEWLINE' &&
      this.current().type !== 'LBRACE' &&
      this.current().type !== 'RBRACE' &&
      this.current().type !== 'KEYWORD' &&
      !(this.current().type === 'VARIABLE' && this.peek(1).type === 'ASSIGN')
    ) {
      // A raw COMMAND token where we expect a value is an error: the user
      // probably typed two commands on one line, e.g. `canvascolor pencolor 1,2,3`.
      // Emit a precise diagnostic pointing at the stray command token.
      if (this.current().type === 'COMMAND') {
        const stray = this.current();
        throw new TurtleError(
          `Expected a value but got command '${stray.value}'. Commands must go on their own line.`,
          stray.line,
          'parse',
          stray.column,
          'error.expectedValueGotCommand',
          [cmdToken.value, stray.value],
        );
      }

      // An unexpected identifier mid-argument-list also looks like a new
      // statement bleeding into this one — bail cleanly.
      if (this.current().type === 'IDENTIFIER' && this.peek(1).type !== 'OPERATOR' &&
          this.peek(1).type !== 'COMMA' && this.peek(1).type !== 'RPAREN' &&
          this.peek(1).type !== 'COMPARISON') {
        break;
      }

      args.push(this.parseExpression());

      // Skip comma separators
      if (this.current().type === 'COMMA') {
        this.advance();
      } else {
        break;
      }
    }

    // Note: a raw COMMAND after a *complete* argument list is LEGAL — KTurtle
    // programs commonly chain commands on one line, e.g.
    //   go 121, 66 pendown forward 65 penup
    // Here `go` consumes `121, 66`, then `pendown`, `forward`, `penup` each
    // start their own statement. The error check inside the loop above still
    // catches the genuine mistake `canvascolor pencolor 236, 23, 23` where a
    // command appears *before* any valid value has been parsed.

    return { type: 'Command', name: cmdToken.value, args, line: cmdToken.line };
  }

  private isExpressionStart(): boolean {
    const t = this.current().type;
    return t === 'NUMBER' || t === 'STRING' || t === 'VARIABLE' || t === 'LPAREN';
  }

  private parseFunctionCall(): ASTNode {
    const nameToken = this.advance();
    const args: ASTNode[] = [];

    // Same statement-terminator rules as parseCommand: NEWLINE ends the
    // argument list so `greet\nforward 10` doesn't feed `forward` as an arg.
    while (
      this.current().type !== 'EOF' &&
      this.current().type !== 'NEWLINE' &&
      this.current().type !== 'LBRACE' &&
      this.current().type !== 'RBRACE' &&
      this.current().type !== 'KEYWORD' &&
      this.isExpressionStart()
    ) {
      args.push(this.parseExpression());
      if (this.current().type === 'COMMA') {
        this.advance();
      } else {
        break;
      }
    }

    return { type: 'FunctionCall', name: nameToken.value, args, line: nameToken.line };
  }

  private parseIf(): ASTNode {
    const ifToken = this.expect('KEYWORD', 'if');
    const condition = this.parseCondition();
    this.skipNewlines();
    this.expect('LBRACE');
    const body = this.parseBlock();
    this.expect('RBRACE');

    let elseBody: ASTNode[] | undefined;
    this.skipNewlines();
    if (this.current().type === 'KEYWORD' && this.current().value === 'else') {
      this.advance();
      this.skipNewlines();
      this.expect('LBRACE');
      elseBody = this.parseBlock();
      this.expect('RBRACE');
    }

    return { type: 'If', condition, body, elseBody, line: ifToken.line };
  }

  private parseWhile(): ASTNode {
    const whileToken = this.expect('KEYWORD', 'while');
    const condition = this.parseCondition();
    this.skipNewlines();
    this.expect('LBRACE');
    const body = this.parseBlock();
    this.expect('RBRACE');
    return { type: 'While', condition, body, line: whileToken.line };
  }

  private parseRepeat(): ASTNode {
    const repeatToken = this.expect('KEYWORD', 'repeat');
    const count = this.parseExpression();
    this.skipNewlines();
    this.expect('LBRACE');
    const body = this.parseBlock();
    this.expect('RBRACE');
    return { type: 'Repeat', count, body, line: repeatToken.line };
  }

  private parseFor(): ASTNode {
    const forToken = this.expect('KEYWORD', 'for');
    const varToken = this.expect('VARIABLE');
    this.expect('ASSIGN');
    const start = this.parseExpression();
    this.expect('KEYWORD', 'to');
    const end = this.parseExpression();

    let step: ASTNode | undefined;
    if (this.current().type === 'KEYWORD' && this.current().value === 'step') {
      this.advance();
      step = this.parseExpression();
    }

    this.skipNewlines();
    this.expect('LBRACE');
    const body = this.parseBlock();
    this.expect('RBRACE');

    return { type: 'For', variable: varToken.value, start, end, step, body, line: forToken.line };
  }

  private parseLearn(): ASTNode {
    const learnToken = this.expect('KEYWORD', 'learn');
    const nameToken = this.expect('IDENTIFIER');
    const params: string[] = [];

    while (this.current().type === 'VARIABLE') {
      params.push(this.advance().value);
      if (this.current().type === 'COMMA') {
        this.advance();
      }
    }

    this.skipNewlines();
    this.expect('LBRACE');
    const body = this.parseBlock();
    this.expect('RBRACE');

    return { type: 'Learn', name: nameToken.value, params, body, line: learnToken.line };
  }

  private parseReturn(): ASTNode {
    const returnToken = this.expect('KEYWORD', 'return');
    const value = this.parseExpression();
    return { type: 'Return', value, line: returnToken.line };
  }

  private parseBlock(): ASTNode[] {
    const statements: ASTNode[] = [];
    this.skipNewlines();
    while (this.current().type !== 'RBRACE' && this.current().type !== 'EOF') {
      try {
        const stmt = this.parseStatement();
        if (stmt) statements.push(stmt);
      } catch (err) {
        if (err instanceof TurtleError) {
          this.errors.push(err);
          this.synchronize();
        } else {
          throw err;
        }
      }
      this.skipNewlines();
    }
    return statements;
  }

  private parseCondition(): ASTNode {
    return this.parseLogical();
  }

  private parseLogical(): ASTNode {
    // Handle 'not' prefix
    if (this.current().type === 'LOGICAL' && this.current().value === 'not') {
      const token = this.advance();
      const operand = this.parseLogical();
      return { type: 'Logical', operator: 'not', right: operand, line: token.line };
    }

    let left = this.parseComparison();

    while (this.current().type === 'LOGICAL' && (this.current().value === 'and' || this.current().value === 'or')) {
      const op = this.advance();
      const right = this.parseComparison();
      left = { type: 'Logical', operator: op.value, left, right, line: op.line };
    }

    return left;
  }

  private parseComparison(): ASTNode {
    let left = this.parseExpression();

    if (this.current().type === 'COMPARISON') {
      const op = this.advance();
      const right = this.parseExpression();
      return { type: 'Comparison', operator: op.value, left, right, line: op.line };
    }

    return left;
  }

  private parseExpression(): ASTNode {
    return this.parseAddSub();
  }

  private parseAddSub(): ASTNode {
    let left = this.parseMulDiv();

    while (this.current().type === 'OPERATOR' && (this.current().value === '+' || this.current().value === '-')) {
      const op = this.advance();
      const right = this.parseMulDiv();
      left = { type: 'BinaryOp', operator: op.value, left, right, line: op.line };
    }

    return left;
  }

  private parseMulDiv(): ASTNode {
    let left = this.parseUnary();

    while (this.current().type === 'OPERATOR' && (this.current().value === '*' || this.current().value === '/')) {
      const op = this.advance();
      const right = this.parseUnary();
      left = { type: 'BinaryOp', operator: op.value, left, right, line: op.line };
    }

    return left;
  }

  private parseUnary(): ASTNode {
    if (this.current().type === 'OPERATOR' && this.current().value === '-') {
      const op = this.advance();
      const operand = this.parsePrimary();
      return { type: 'UnaryOp', operator: '-', operand, line: op.line };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): ASTNode {
    const token = this.current();

    if (token.type === 'NUMBER') {
      this.advance();
      return { type: 'Number', value: parseFloat(token.value), line: token.line };
    }

    if (token.type === 'STRING') {
      this.advance();
      return { type: 'String', value: token.value, line: token.line };
    }

    if (token.type === 'VARIABLE') {
      this.advance();
      return { type: 'Variable', name: token.value, line: token.line };
    }

    if (token.type === 'COMMAND') {
      // Commands that return values: getx, gety, random, ask, sin, cos, etc.
      const cmd = this.parseCommand();
      return cmd;
    }

    if (token.type === 'IDENTIFIER') {
      // User-defined function call
      return this.parseFunctionCall();
    }

    if (token.type === 'LPAREN') {
      this.advance();
      const expr = this.parseCondition();
      this.expect('RPAREN');
      return expr;
    }

    if (token.type === 'EOF') {
      throw new TurtleError(
        'Unexpected end of program — something is missing.',
        token.line,
        'parse',
        token.column,
        'error.unexpectedEof',
      );
    }
    if (token.type === 'NEWLINE') {
      throw new TurtleError(
        'Unexpected end of line — a value was expected here.',
        token.line,
        'parse',
        token.column,
        'error.unexpectedEol',
      );
    }
    throw new TurtleError(
      `Unexpected ${this.friendlyType(token.type)} '${token.value}'.`,
      token.line,
      'parse',
      token.column,
      'error.unexpectedToken',
      [this.friendlyType(token.type), token.value],
    );
  }
}
