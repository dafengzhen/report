import type { ReporterPlugin } from '../core/types.js';

/** Keeps reports independently with a probability from 0 to 1. */
export function createSamplingPlugin(rate: number, random = Math.random): ReporterPlugin {
  if (!Number.isFinite(rate) || rate < 0 || rate > 1) {
    throw new RangeError('Sampling rate must be a finite number from 0 to 1.');
  }

  return {
    beforeSend: (record) => (rate === 1 || (rate > 0 && random() < rate) ? record : null),
    name: 'sampling',
  };
}
