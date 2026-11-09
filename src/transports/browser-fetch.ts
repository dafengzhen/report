import type { ReportTransport } from '../core/types.js';

import { createFetchTransport, type FetchTransportOptions } from './fetch-transport.js';

/** Uses fetch only when send(record) is explicitly invoked. */
export function browserFetchTransport(options: FetchTransportOptions): ReportTransport {
  return createFetchTransport(options);
}
