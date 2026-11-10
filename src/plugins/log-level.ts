import type { LogLevel, ReporterPlugin } from '../core/types.js';

const priorities: Record<LogLevel, number> = {
  debug: 0,
  error: 3,
  fatal: 4,
  info: 1,
  warn: 2,
};

/** Keeps logs at or above the minimum level. Records without a log level pass through. */
export function createLogLevelPlugin(minLevel: LogLevel): ReporterPlugin {
  const minimum = priorities[minLevel];
  if (typeof minimum !== 'number') {
    throw new RangeError('Minimum log level must be debug, info, warn, error, or fatal.');
  }

  return {
    beforeSend(record) {
      if (
        record.type === 'log' &&
        record.level !== undefined &&
        priorities[record.level] < minimum
      ) {
        return null;
      }
      return record;
    },
    name: 'log-level',
  };
}
