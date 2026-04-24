/**
 * Structured parse / runtime error carrying a source location AND a
 * translation key. KTurtle's console shows the exact line and a short
 * message — we preserve both, plus the message key + args so the message
 * can be re-rendered when the user switches languages.
 */
export type ErrorPhase = 'tokenize' | 'parse' | 'runtime';

export class TurtleError extends Error {
  line: number;
  column?: number;
  phase: ErrorPhase;
  /** i18n key for `translate()` — UI prefers this over `message` when set. */
  messageKey?: string;
  messageArgs?: (string | number)[];

  constructor(
    message: string,
    line: number,
    phase: ErrorPhase = 'runtime',
    column?: number,
    messageKey?: string,
    messageArgs?: (string | number)[],
  ) {
    super(message);
    this.name = 'TurtleError';
    this.line = line;
    this.column = column;
    this.phase = phase;
    this.messageKey = messageKey;
    this.messageArgs = messageArgs;
  }
}
