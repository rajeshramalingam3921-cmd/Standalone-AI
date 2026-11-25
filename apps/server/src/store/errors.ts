export class NotFoundError extends Error {
  readonly statusCode = 404;
  constructor(what: string) {
    super(`${what} not found.`);
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends Error {
  readonly statusCode = 409;
  constructor(message: string) {
    super(message);
    this.name = 'ConflictError';
  }
}

export class StoreCorruptError extends Error {
  constructor(file: string, detail: string) {
    super(
      `Data file ${file} is unreadable or invalid (${detail}). Refusing to start so it is not overwritten — restore it from a backup or move it aside.`,
    );
    this.name = 'StoreCorruptError';
  }
}
