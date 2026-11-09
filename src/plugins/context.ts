import type { ReporterPlugin } from '../core/types.js';

/** Adds defaults while preserving context already set on the report. */
export function createContextPlugin(defaults: Readonly<Record<string, unknown>>): ReporterPlugin {
  const context = { ...defaults };

  return {
    beforeSend: (record) => ({ ...record, context: { ...context, ...record.context } }),
    name: 'context',
  };
}
