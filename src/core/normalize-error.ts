import type { NormalizedError } from './types.js';

export function normalizeError(error: unknown): NormalizedError {
  if (error instanceof Error) {
    return normalizeNativeError(error, new Set());
  }

  if (typeof error === 'object' && error !== null) {
    const value = error as Record<string, unknown>;
    return {
      message: typeof value.message === 'string' ? value.message : safeStringify(error),
      name: typeof value.name === 'string' ? value.name : 'NonErrorObject',
      ...(typeof value.stack === 'string' ? { stack: value.stack } : {}),
    };
  }

  return {
    message: safeToString(error),
    name: 'NonErrorThrown',
  };
}

export function safeToString(value: unknown): string {
  try {
    return String(value);
  } catch {
    return '[Unserializable value]';
  }
}

function normalizeCause(value: unknown, seen: Set<Error>): unknown {
  if (value instanceof Error) {
    return seen.has(value) ? '[Circular error cause]' : normalizeNativeError(value, seen);
  }
  if (value === null || ['boolean', 'number', 'string'].includes(typeof value)) {
    return value;
  }
  return safeStringify(value);
}

function normalizeNativeError(error: Error, seen: Set<Error>): NormalizedError {
  seen.add(error);
  const result: NormalizedError = {
    message: error.message || safeToString(error),
    name: error.name || 'Error',
  };
  if (error.stack) {
    result.stack = error.stack;
  }
  if (error.cause !== undefined) {
    result.cause = normalizeCause(error.cause, seen);
  }
  return result;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? safeToString(value);
  } catch {
    return safeToString(value);
  }
}
