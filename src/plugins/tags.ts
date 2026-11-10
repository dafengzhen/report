import type { ReporterPlugin } from '../core/types.js';

/** Appends default tags, keeping the first occurrence of each tag. */
export function createTagsPlugin(tags: readonly string[]): ReporterPlugin {
  const defaults = [...tags];

  return {
    beforeSend(record) {
      if (defaults.length === 0) {
        return record;
      }
      return { ...record, tags: [...new Set([...(record.tags ?? []), ...defaults])] };
    },
    name: 'tags',
  };
}
