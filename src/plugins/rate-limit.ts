import type { ReporterPlugin } from '../core/types.js';

export interface RateLimitPluginOptions {
  maxReports: number;
  windowMs: number;
}

/** Caps reports admitted by this plugin instance in each fixed time window. */
export function createRateLimitPlugin({
  maxReports,
  windowMs,
}: RateLimitPluginOptions): ReporterPlugin {
  if (!Number.isSafeInteger(maxReports) || maxReports < 1) {
    throw new RangeError('Maximum reports must be a positive safe integer.');
  }
  if (!Number.isSafeInteger(windowMs) || windowMs < 1) {
    throw new RangeError('Rate limit window must be a positive safe integer in milliseconds.');
  }

  let windowStart: number | undefined;
  let admitted = 0;

  return {
    beforeSend(record) {
      const now = Date.now();
      if (windowStart === undefined || now < windowStart || now - windowStart >= windowMs) {
        windowStart = now;
        admitted = 0;
      }

      if (admitted >= maxReports) {
        return null;
      }
      admitted += 1;
      return record;
    },
    name: 'rate-limit',
  };
}
