// TurtleScript Interpreter
import { ASTNode } from './parser';
import { TurtleError } from './errors';
export { TurtleError } from './errors';

export interface TurtleState {
  x: number;
  y: number;
  angle: number;
  penDown: boolean;
  penColor: string;
  penWidth: number;
  visible: boolean;
  canvasWidth: number;
  canvasHeight: number;
  canvasColor: string;
  fontSize: number;
}

export interface DrawCommand {
  type: 'line' | 'text' | 'clear' | 'canvasColor';
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
  color?: string;
  width?: number;
  text?: string;
  fontSize?: number;
}

export interface InterpreterResult {
  turtle: TurtleState;
  drawings: DrawCommand[];
  output: string[];
  /** Snapshot of user-defined variables after execution (for Inspector). */
  variables: Record<string, number | string>;
  /** Names of user-defined functions (Inspector). */
  functionNames: string[];
  /**
   * Every parse / runtime error encountered. Empty when the program ran
   * cleanly. The first entry (if any) is the one traditionally surfaced on
   * the toolbar error chip; the full list appears in the Inspector's
   * Errors tab so users can see every problem at once.
   */
  errors: TurtleError[];
  /** Legacy single-error field. Always equals `errors[0]` when present. */
  error?: TurtleError;
}

/**
 * Arity table for built-in commands. Maps canonical command name (both the
 * long form and alias, where they differ) to the inclusive {min,max} range
 * of arguments the command accepts. The interpreter validates this before
 * running the command body and raises a translated error if it doesn't
 * match — mirroring how KTurtle's interpreter flags wrong-sized calls like
 * `canvascolor 0, 0` at runtime.
 */
const COMMAND_ARITY: Record<string, { min: number; max: number }> = {
  // Movement — one numeric distance / angle
  forward: { min: 1, max: 1 },   fw: { min: 1, max: 1 },
  backward: { min: 1, max: 1 },  bw: { min: 1, max: 1 },
  turnleft: { min: 1, max: 1 },  tl: { min: 1, max: 1 },
  turnright: { min: 1, max: 1 }, tr: { min: 1, max: 1 },
  direction: { min: 1, max: 1 }, dir: { min: 1, max: 1 },
  go: { min: 2, max: 2 },
  gox: { min: 1, max: 1 },
  goy: { min: 1, max: 1 },
  // No-arg commands (parser also guarantees this, but we double-check)
  center: { min: 0, max: 0 },
  penup: { min: 0, max: 0 },     pu: { min: 0, max: 0 },
  pendown: { min: 0, max: 0 },   pd: { min: 0, max: 0 },
  clear: { min: 0, max: 0 },     ccl: { min: 0, max: 0 },
  reset: { min: 0, max: 0 },
  spriteshow: { min: 0, max: 0 }, ss: { min: 0, max: 0 },
  spritehide: { min: 0, max: 0 }, sh: { min: 0, max: 0 },
  getx: { min: 0, max: 0 },
  gety: { min: 0, max: 0 },
  pi: { min: 0, max: 0 },
  // Pen / canvas
  penwidth: { min: 1, max: 1 },   pw: { min: 1, max: 1 },
  pencolor: { min: 3, max: 3 },   pc: { min: 3, max: 3 },
  canvassize: { min: 2, max: 2 }, cs: { min: 2, max: 2 },
  canvascolor: { min: 3, max: 3 }, cc: { min: 3, max: 3 },
  fontsize: { min: 1, max: 1 },
  // I/O
  print: { min: 1, max: 1 },
  message: { min: 1, max: 1 },
  ask: { min: 1, max: 1 },
  wait: { min: 1, max: 1 },
  // Math — strictly one numeric argument
  sin: { min: 1, max: 1 },
  cos: { min: 1, max: 1 },
  tan: { min: 1, max: 1 },
  arcsin: { min: 1, max: 1 },
  arccos: { min: 1, max: 1 },
  arctan: { min: 1, max: 1 },
  sqrt: { min: 1, max: 1 },
  exp: { min: 1, max: 1 },
  round: { min: 1, max: 1 },
  abs: { min: 1, max: 1 },
  // random takes 2 args (min, max)
  random: { min: 2, max: 2 }, rnd: { min: 2, max: 2 },
};

/** Per-step notification: includes source line so editor can highlight it. */
export interface StepInfo {
  state: TurtleState;
  drawings: DrawCommand[];
  line: number;
  variables: Record<string, number | string>;
  /**
   * Snapshot of errors collected so far. Passed on every step so the UI can
   * highlight erroring lines / show the toolbar chip *during* the run
   * (previously errors only appeared once execution finished).
   */
  errors: TurtleError[];
}

type FunctionDef = {
  params: string[];
  body: ASTNode[];
};

export class Interpreter {
  private turtle: TurtleState;
  private drawings: DrawCommand[] = [];
  private output: string[] = [];
  private variables: Map<string, number | string> = new Map();
  private functions: Map<string, FunctionDef> = new Map();
  private shouldExit: boolean = false;
  private returnValue: number | string | null = null;
  private speed: number = 0;
  private onStep?: (info: StepInfo) => void;
  private stepCounter: number = 0;
  /** Cancellation flag set from the outside (Stop button). */
  private cancelled: boolean = false;
  // Tracks the source line of the currently-executing statement so that
  // runtime errors (division by zero, unknown function, etc.) can be
  // reported at the correct location — just like KTurtle does.
  private currentLine: number = 0;
  /** Every error collected during this run (parse errors injected first, then
   *  any runtime errors). Capped so a loop that fails every iteration won't
   *  produce megabytes of duplicates. */
  private errors: TurtleError[] = [];
  private readonly MAX_ERRORS = 50;
  // At full speed (0ms), batch updates every N commands to prevent React re-render lag
  private readonly BATCH_SIZE = 50;

  constructor(onStep?: (info: StepInfo) => void, speed: number = 0) {
    this.onStep = onStep;
    this.speed = speed;
    this.turtle = this.getInitialState();
    this.stepCounter = 0;
  }

  /** Stop execution at the next statement boundary. */
  cancel(): void {
    this.cancelled = true;
    this.shouldExit = true;
  }

  /** Dynamically adjust speed mid-run (e.g., user moves the slider). */
  setSpeed(ms: number): void {
    this.speed = ms;
  }

  /**
   * Seed the interpreter with errors that were collected during parsing.
   * Called from App.tsx after `parser.getErrors()` so parse + runtime
   * errors appear together in the final result.
   */
  seedErrors(errors: TurtleError[]): void {
    for (const e of errors) {
      if (this.errors.length < this.MAX_ERRORS) this.errors.push(e);
    }
  }

  /** Record a runtime error without aborting the run. De-duplicates
   *  consecutive identical errors so tight loops don't flood the list.
   *  Emits a step notification right away so the UI can highlight the
   *  offending line *during* the run, rather than only on completion. */
  private pushError(err: TurtleError): void {
    const last = this.errors[this.errors.length - 1];
    if (last && last.line === err.line && last.message === err.message) return;
    if (this.errors.length < this.MAX_ERRORS) {
      this.errors.push(err);
      // Surface immediately — without this, a batched instant-mode run
      // would accumulate errors silently until the final flush in
      // execute(), which is exactly what the user complained about.
      this.emitStep();
    }
  }

  private getInitialState(): TurtleState {
    return {
      x: 200,
      y: 200,
      angle: 0, // 0 = up, 90 = right, 180 = down, 270 = left
      penDown: true,
      penColor: '#000000',
      penWidth: 1,
      visible: true,
      canvasWidth: 400,
      canvasHeight: 400,
      canvasColor: '#ffffff',
      fontSize: 12,
    };
  }

  async execute(ast: ASTNode): Promise<InterpreterResult> {
    this.drawings = [];
    this.output = [];
    this.shouldExit = false;
    this.returnValue = null;
    this.stepCounter = 0;

    if (ast.type === 'Program') {
      // Execute each top-level statement with its own try/catch so one
      // failure doesn't stop the whole program — this surfaces multiple
      // runtime problems in one run, which is what the user expects from
      // a proper IDE. Nested errors inside a block (inside a repeat, if,
      // learn…) still bubble up and are caught at the top level; that's a
      // reasonable trade-off between error coverage and avoiding an
      // infinite loop that throws every iteration.
      for (const stmt of ast.body) {
        if (this.shouldExit || this.cancelled) break;
        try {
          await this.executeNode(stmt);
        } catch (error) {
          const err =
            error instanceof TurtleError
              ? error
              : new TurtleError(
                  error instanceof Error ? error.message : String(error),
                  this.currentLine,
                  'runtime',
                );
          this.pushError(err);
          // Reset per-statement state so the next top-level statement can
          // still execute. `returnValue` is only meaningful inside a
          // function frame, so clearing it is safe here.
          this.returnValue = null;
        }
      }
    }

    return {
      turtle: this.turtle,
      drawings: this.drawings,
      output: this.output,
      variables: Object.fromEntries(this.variables),
      functionNames: Array.from(this.functions.keys()),
      errors: this.errors.slice(),
      error: this.errors[0],
    };
  }

  private async delay(ms: number): Promise<void> {
    if (ms > 0) {
      return new Promise(resolve => setTimeout(resolve, ms));
    }
  }

  private async step(): Promise<void> {
    this.stepCounter++;

    // At full speed (0ms), batch updates to prevent React re-render lag
    // Only update UI every BATCH_SIZE commands
    if (this.speed === 0) {
      if (this.stepCounter % this.BATCH_SIZE === 0) {
        this.emitStep();
        // Yield to event loop briefly to keep UI responsive
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    } else {
      // With animation speed, update on every step
      this.emitStep();
      await this.delay(this.speed);
    }
  }

  private emitStep(): void {
    if (this.onStep) {
      this.onStep({
        state: { ...this.turtle },
        drawings: [...this.drawings],
        line: this.currentLine,
        variables: Object.fromEntries(this.variables),
        errors: this.errors.slice(),
      });
    }
  }

  private async executeNode(node: ASTNode): Promise<number | string | null> {
    if (this.shouldExit) return null;

    // Record the source line of every top-level statement so that any
    // exception raised beneath it carries the correct location.
    if ('line' in node && typeof node.line === 'number' && node.line > 0) {
      this.currentLine = node.line;
    }

    switch (node.type) {
      case 'Command':
        return await this.executeCommand(node.name, node.args, node.line);

      case 'Assignment': {
        const value = await this.evaluate(node.value);
        this.variables.set(node.name, value);
        return null;
      }

      case 'If': {
        const condition = await this.evaluate(node.condition);
        if (condition) {
          for (const stmt of node.body) {
            if (this.shouldExit || this.returnValue !== null) break;
            await this.executeNode(stmt);
          }
        } else if (node.elseBody) {
          for (const stmt of node.elseBody) {
            if (this.shouldExit || this.returnValue !== null) break;
            await this.executeNode(stmt);
          }
        }
        return null;
      }

      case 'While': {
        while (!this.shouldExit && this.returnValue === null) {
          const condition = await this.evaluate(node.condition);
          if (!condition) break;
          for (const stmt of node.body) {
            if (this.shouldExit || this.returnValue !== null) break;
            await this.executeNode(stmt);
          }
        }
        return null;
      }

      case 'Repeat': {
        const count = await this.evaluate(node.count);
        for (let i = 0; i < Number(count) && !this.shouldExit && this.returnValue === null; i++) {
          for (const stmt of node.body) {
            if (this.shouldExit || this.returnValue !== null) break;
            await this.executeNode(stmt);
          }
        }
        return null;
      }

      case 'For': {
        const start = Number(await this.evaluate(node.start));
        const end = Number(await this.evaluate(node.end));
        const step = node.step ? Number(await this.evaluate(node.step)) : 1;

        for (let i = start; step > 0 ? i <= end : i >= end; i += step) {
          if (this.shouldExit || this.returnValue !== null) break;
          this.variables.set(node.variable, i);
          for (const stmt of node.body) {
            if (this.shouldExit || this.returnValue !== null) break;
            await this.executeNode(stmt);
          }
        }
        return null;
      }

      case 'Learn': {
        this.functions.set(node.name, { params: node.params, body: node.body });
        return null;
      }

      case 'Return': {
        this.returnValue = await this.evaluate(node.value);
        return this.returnValue;
      }

      case 'Exit': {
        this.shouldExit = true;
        return null;
      }

      case 'FunctionCall': {
        const func = this.functions.get(node.name);
        if (!func) {
          throw new TurtleError(
            `I don't know what "${node.name}" means. Did you forget to learn it?`,
            node.line,
            'runtime',
            undefined,
            'error.unknownFunction',
            [node.name],
          );
        }

        // Save current variables
        const savedVars = new Map(this.variables);

        // Set parameters
        for (let i = 0; i < func.params.length; i++) {
          const argValue = node.args[i] ? await this.evaluate(node.args[i]) : 0;
          this.variables.set(func.params[i], argValue);
        }

        // Execute function body
        for (const stmt of func.body) {
          if (this.shouldExit) break;
          await this.executeNode(stmt);
          if (this.returnValue !== null) break;
        }

        const result = this.returnValue;
        this.returnValue = null;

        // Restore variables
        this.variables = savedVars;

        return result;
      }

      default:
        return await this.evaluate(node);
    }
  }

  private async evaluate(node: ASTNode): Promise<number | string> {
    switch (node.type) {
      case 'Number':
        return node.value;

      case 'String':
        return node.value;

      case 'Variable': {
        const value = this.variables.get(node.name);
        if (value === undefined) {
          return 0; // Undefined variables return 0
        }
        return value;
      }

      case 'BinaryOp': {
        const left = await this.evaluate(node.left);
        const right = await this.evaluate(node.right);

        if (node.operator === '+') {
          if (typeof left === 'string' || typeof right === 'string') {
            return String(left) + String(right);
          }
          return Number(left) + Number(right);
        }

        const l = Number(left);
        const r = Number(right);

        switch (node.operator) {
          case '-': return l - r;
          case '*': return l * r;
          case '/':
            if (r === 0) {
              throw new TurtleError(
                `I cannot divide by zero.`,
                node.line,
                'runtime',
                undefined,
                'error.divByZero',
              );
            }
            return l / r;
          default: return 0;
        }
      }

      case 'UnaryOp': {
        const operand = await this.evaluate(node.operand);
        if (node.operator === '-') {
          return -Number(operand);
        }
        return operand;
      }

      case 'Comparison': {
        const left = await this.evaluate(node.left);
        const right = await this.evaluate(node.right);
        const l = typeof left === 'string' ? left : Number(left);
        const r = typeof right === 'string' ? right : Number(right);

        switch (node.operator) {
          case '==': return l === r ? 1 : 0;
          case '!=': return l !== r ? 1 : 0;
          case '>': return l > r ? 1 : 0;
          case '<': return l < r ? 1 : 0;
          case '>=': return l >= r ? 1 : 0;
          case '<=': return l <= r ? 1 : 0;
          default: return 0;
        }
      }

      case 'Logical': {
        if (node.operator === 'not') {
          const right = await this.evaluate(node.right);
          return right ? 0 : 1;
        }

        const left = node.left ? await this.evaluate(node.left) : 0;
        const right = await this.evaluate(node.right);

        switch (node.operator) {
          case 'and': return (left && right) ? 1 : 0;
          case 'or': return (left || right) ? 1 : 0;
          default: return 0;
        }
      }

      case 'Command':
        return await this.executeCommand(node.name, node.args, node.line) ?? 0;

      case 'FunctionCall': {
        const result = await this.executeNode(node);
        return result ?? 0;
      }

      default:
        return 0;
    }
  }

  private toRadians(degrees: number): number {
    return (degrees * Math.PI) / 180;
  }

  private toDegrees(radians: number): number {
    return (radians * 180) / Math.PI;
  }

  private rgbToHex(r: number, g: number, b: number): string {
    const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
    return `#${[r, g, b].map(c => clamp(c).toString(16).padStart(2, '0')).join('')}`;
  }

  private async executeCommand(
    name: string,
    args: ASTNode[],
    line: number = 0,
  ): Promise<number | string | null> {
    if (line > 0) this.currentLine = line;

    // Enforce the arity contract for each built-in command. This catches
    // programs like `canvascolor 0, 0` (2 args — missing blue) or
    // `forward 10, 20` (1 expected, 2 given) which would otherwise run
    // with silent defaults and behave mysteriously.
    const expected = COMMAND_ARITY[name];
    if (expected !== undefined) {
      const { min, max } = expected;
      if (args.length < min || args.length > max) {
        const expectStr = min === max ? String(min) : `${min}–${max}`;
        throw new TurtleError(
          `The command '${name}' expects ${expectStr} argument(s) but got ${args.length}.`,
          this.currentLine,
          'runtime',
          undefined,
          'error.wrongArgCount',
          [name, expectStr, args.length],
        );
      }
    }

    const getNum = async (index: number, defaultVal: number = 0): Promise<number> => {
      if (index >= args.length) return defaultVal;
      return Number(await this.evaluate(args[index]));
    };

    const getStr = async (index: number): Promise<string> => {
      if (index >= args.length) return '';
      return String(await this.evaluate(args[index]));
    };

    switch (name) {
      case 'forward':
      case 'fw': {
        const distance = await getNum(0);
        const radians = this.toRadians(this.turtle.angle - 90);
        const newX = this.turtle.x + distance * Math.cos(radians);
        const newY = this.turtle.y + distance * Math.sin(radians);

        if (this.turtle.penDown) {
          this.drawings.push({
            type: 'line',
            x1: this.turtle.x,
            y1: this.turtle.y,
            x2: newX,
            y2: newY,
            color: this.turtle.penColor,
            width: this.turtle.penWidth,
          });
        }

        this.turtle.x = newX;
        this.turtle.y = newY;
        await this.step();
        return null;
      }

      case 'backward':
      case 'bw': {
        const distance = await getNum(0);
        const radians = this.toRadians(this.turtle.angle - 90);
        const newX = this.turtle.x - distance * Math.cos(radians);
        const newY = this.turtle.y - distance * Math.sin(radians);

        if (this.turtle.penDown) {
          this.drawings.push({
            type: 'line',
            x1: this.turtle.x,
            y1: this.turtle.y,
            x2: newX,
            y2: newY,
            color: this.turtle.penColor,
            width: this.turtle.penWidth,
          });
        }

        this.turtle.x = newX;
        this.turtle.y = newY;
        await this.step();
        return null;
      }

      case 'turnleft':
      case 'tl': {
        const degrees = await getNum(0);
        this.turtle.angle -= degrees;
        await this.step();
        return null;
      }

      case 'turnright':
      case 'tr': {
        const degrees = await getNum(0);
        this.turtle.angle += degrees;
        await this.step();
        return null;
      }

      case 'direction':
      case 'dir': {
        const degrees = await getNum(0);
        this.turtle.angle = degrees;
        await this.step();
        return null;
      }

      case 'center': {
        this.turtle.x = this.turtle.canvasWidth / 2;
        this.turtle.y = this.turtle.canvasHeight / 2;
        await this.step();
        return null;
      }

      case 'go': {
        this.turtle.x = await getNum(0);
        this.turtle.y = await getNum(1);
        await this.step();
        return null;
      }

      case 'gox': {
        this.turtle.x = await getNum(0);
        await this.step();
        return null;
      }

      case 'goy': {
        this.turtle.y = await getNum(0);
        await this.step();
        return null;
      }

      case 'getx':
        return this.turtle.x;

      case 'gety':
        return this.turtle.y;

      case 'penup':
      case 'pu':
        this.turtle.penDown = false;
        return null;

      case 'pendown':
      case 'pd':
        this.turtle.penDown = true;
        return null;

      case 'penwidth':
      case 'pw': {
        this.turtle.penWidth = await getNum(0, 1);
        return null;
      }

      case 'pencolor':
      case 'pc': {
        const r = await getNum(0);
        const g = await getNum(1);
        const b = await getNum(2);
        this.turtle.penColor = this.rgbToHex(r, g, b);
        return null;
      }

      case 'canvassize':
      case 'cs': {
        this.turtle.canvasWidth = await getNum(0, 400);
        this.turtle.canvasHeight = await getNum(1, 400);
        await this.step();
        return null;
      }

      case 'canvascolor':
      case 'cc': {
        const r = await getNum(0);
        const g = await getNum(1);
        const b = await getNum(2);
        this.turtle.canvasColor = this.rgbToHex(r, g, b);
        this.drawings.push({ type: 'canvasColor', color: this.turtle.canvasColor });
        await this.step();
        return null;
      }

      case 'clear':
      case 'ccl':
        this.drawings.push({ type: 'clear' });
        await this.step();
        return null;

      case 'reset':
        this.turtle = this.getInitialState();
        this.drawings = [];
        this.drawings.push({ type: 'clear' });
        await this.step();
        return null;

      case 'spriteshow':
      case 'ss':
        this.turtle.visible = true;
        return null;

      case 'spritehide':
      case 'sh':
        this.turtle.visible = false;
        return null;

      case 'print': {
        const text = await getStr(0);
        this.drawings.push({
          type: 'text',
          x1: this.turtle.x,
          y1: this.turtle.y,
          text: text,
          color: this.turtle.penColor,
          fontSize: this.turtle.fontSize,
        });
        this.output.push(text);
        await this.step();
        return null;
      }

      case 'fontsize': {
        this.turtle.fontSize = await getNum(0, 12);
        return null;
      }

      case 'random':
      case 'rnd': {
        const min = await getNum(0, 0);
        const max = await getNum(1, 100);
        return Math.floor(Math.random() * (max - min + 1)) + min;
      }

      case 'wait': {
        const seconds = await getNum(0, 1);
        await this.delay(seconds * 1000);
        return null;
      }

      case 'message': {
        const text = await getStr(0);
        this.output.push(`[Message] ${text}`);
        alert(text);
        return null;
      }

      case 'ask': {
        const text = await getStr(0);
        const result = prompt(text);
        if (result === null) return '';
        const num = parseFloat(result);
        return isNaN(num) ? result : num;
      }

      case 'sin': {
        const degrees = await getNum(0);
        return Math.sin(this.toRadians(degrees));
      }

      case 'cos': {
        const degrees = await getNum(0);
        return Math.cos(this.toRadians(degrees));
      }

      case 'tan': {
        const degrees = await getNum(0);
        return Math.tan(this.toRadians(degrees));
      }

      case 'arcsin': {
        const value = await getNum(0);
        return this.toDegrees(Math.asin(value));
      }

      case 'arccos': {
        const value = await getNum(0);
        return this.toDegrees(Math.acos(value));
      }

      case 'arctan': {
        const value = await getNum(0);
        return this.toDegrees(Math.atan(value));
      }

      case 'sqrt': {
        const value = await getNum(0);
        return Math.sqrt(value);
      }

      case 'exp': {
        const value = await getNum(0);
        return Math.exp(value);
      }

      case 'pi':
        return Math.PI;

      case 'round': {
        const value = await getNum(0);
        return Math.round(value);
      }

      case 'abs': {
        const value = await getNum(0);
        return Math.abs(value);
      }

      default:
        throw new TurtleError(
          `Unknown command "${name}". Check your spelling.`,
          this.currentLine,
          'runtime',
          undefined,
          'error.unknownCommand',
          [name],
        );
    }
  }
}
