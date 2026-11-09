import type { ReporterPlugin } from '../core/types.js';

/** Masks matching field names in plain objects and arrays within data and context. */
export function createRedactionPlugin(fields: readonly string[]): ReporterPlugin {
  const keys = new Set(fields.map((field) => field.toLowerCase()));

  return {
    beforeSend(record) {
      if (keys.size === 0) {
        return record;
      }

      const seen = new WeakMap<object, object>();
      return {
        ...record,
        ...(record.context === undefined
          ? {}
          : { context: redact(record.context, keys, seen) as typeof record.context }),
        ...(record.data === undefined ? {} : { data: redact(record.data, keys, seen) }),
      };
    },
    name: 'redaction',
  };
}

function redact(value: unknown, keys: Set<string>, seen: WeakMap<object, object>): unknown {
  if (typeof value !== 'object' || value === null) {
    return value;
  }

  const previous = seen.get(value);
  if (previous) {
    return previous;
  }

  const prototype = Object.getPrototypeOf(value) as null | object;
  const isArray = Array.isArray(value);
  if (!isArray && prototype !== Object.prototype && prototype !== null) {
    return value;
  }

  const copy: object = isArray ? [] : Object.create(prototype);
  if (isArray) {
    (copy as unknown[]).length = value.length;
  }
  seen.set(value, copy);
  const source = value as Record<string, unknown>;
  for (const key of Object.keys(value)) {
    Object.defineProperty(copy, key, {
      configurable: true,
      enumerable: true,
      value: keys.has(key.toLowerCase()) ? '[REDACTED]' : redact(source[key], keys, seen),
      writable: true,
    });
  }
  return copy;
}
