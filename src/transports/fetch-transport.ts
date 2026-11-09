import type { ReportRecord, ReportTransport } from '../core/types.js';

export interface FetchInitLike {
  body?: string;
  credentials?: 'include' | 'omit' | 'same-origin';
  headers?: Record<string, string>;
  keepalive?: boolean;
  method?: string;
  signal?: unknown;
}

export type FetchLike = (url: string, init?: FetchInitLike) => Promise<FetchResponseLike>;

export interface FetchResponseLike {
  ok: boolean;
  status: number;
  text?: () => Promise<string>;
}

export interface FetchTransportOptions {
  credentials?: FetchInitLike['credentials'];
  /** Inject this for custom runtimes, tests, or older Node.js versions. */
  fetch?: FetchLike;
  headers?: (() => Record<string, string>) | Record<string, string>;
  keepalive?: boolean;
  method?: string;
  serialize?: (record: ReportRecord) => string;
  signal?: (() => unknown) | unknown;
  url: string;
}

export function createFetchTransport(options: FetchTransportOptions): ReportTransport {
  if (!options.url) {
    throw new TypeError('Fetch transport requires a url.');
  }

  return {
    async send(record): Promise<void> {
      const fetchImpl = options.fetch ?? getGlobalFetch();
      const headers = typeof options.headers === 'function' ? options.headers() : options.headers;
      const signal = typeof options.signal === 'function' ? options.signal() : options.signal;

      const response = await fetchImpl(options.url, {
        body: (options.serialize ?? JSON.stringify)(record),
        headers: {
          'content-type': 'application/json',
          ...headers,
        },
        method: options.method ?? 'POST',
        ...(options.credentials ? { credentials: options.credentials } : {}),
        ...(options.keepalive !== undefined ? { keepalive: options.keepalive } : {}),
        ...(signal !== undefined ? { signal } : {}),
      });

      if (!response.ok) {
        throw new Error(`Report request failed with HTTP ${response.status}.`);
      }
    },
  };
}

function getGlobalFetch(): FetchLike {
  const candidate = (globalThis as { fetch?: FetchLike } & typeof globalThis).fetch;
  if (typeof candidate !== 'function') {
    throw new Error('No fetch implementation found. Inject options.fetch.');
  }
  return candidate.bind(globalThis);
}
