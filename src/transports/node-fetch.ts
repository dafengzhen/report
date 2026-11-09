import type { ReportTransport } from '../core/types.js';

import { createFetchTransport, type FetchTransportOptions } from './fetch-transport.js';

/** Uses Node's global fetch (Node 18+) unless a fetch implementation is injected. */
export function nodeFetchTransport(options: FetchTransportOptions): ReportTransport {
  return createFetchTransport(options);
}
