/** Error whose message is safe and intended to be shown to the end user. Never reported as a bug. */
export class UserError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UserError';
  }
}

/** Short random reference shown to users so an operator can find the matching log line. */
export function errorRef() {
  return Math.random().toString(36).slice(2, 8);
}
