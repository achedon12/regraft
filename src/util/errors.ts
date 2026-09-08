/**
 * An error that is the user's to fix, not a bug in regraft.
 *
 * The CLI prints `message` (and `hint`, when present) without a stack trace.
 * Anything else that escapes to the top level is reported as an internal error,
 * stack included, because it is one.
 */
export class UserError extends Error {
  readonly hint: string | undefined;

  constructor(message: string, hint?: string) {
    super(message);
    this.name = 'UserError';
    this.hint = hint;
  }
}

/** Thrown when the repository is in a state regraft refuses to act on. */
export class PreflightError extends UserError {
  constructor(message: string, hint?: string) {
    super(message, hint);
    this.name = 'PreflightError';
  }
}
