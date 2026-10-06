import type { ErrorCode, ValidationIssue } from './types.js';

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly details?: unknown;
  readonly status: number;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.details = details;
    this.status = code === 'NOT_FOUND' ? 404 : code === 'INVALID_WITNESS' ? 400 : 422;
  }
}

export function issue(code: ErrorCode, message: string, field?: string, details?: unknown): ValidationIssue {
  return { code, message, ...(field === undefined ? {} : { field }), ...(details === undefined ? {} : { details }) };
}

export function fail(code: ErrorCode, message: string, details?: unknown): never {
  throw new AppError(code, message, details);
}
