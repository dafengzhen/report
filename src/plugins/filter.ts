import type { ReporterPlugin, ReportRecord } from '../core/types.js';

/** Keeps reports for which the predicate returns true. */
export function createFilterPlugin(
  shouldSend: (record: ReportRecord) => boolean | Promise<boolean>,
): ReporterPlugin {
  return {
    beforeSend: async (record) => ((await shouldSend(record)) ? record : null),
    name: 'filter',
  };
}
