// The one error type this client throws.
//
// Split out of a 604-line index.mjs, and on its own because every other part
// of the client throws it and none of them should have to import the client
// to do so.

export class WelesClientError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = 'WelesClientError';
    this.code = code;
    this.details = details;
  }
}

