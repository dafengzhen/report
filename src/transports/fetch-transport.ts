import type { ReportRecord, ReportTransport } from '../core/types.js';

export interface FetchBatchOptions {
  /** Delay from the first queued record, in milliseconds. Defaults to 1000. */
  intervalMs?: number;
  /** Maximum number of records per request. Defaults to 10. */
  maxSize?: number;
  /** Defaults to serializing the records as a JSON array. */
  serialize?: (records: readonly ReportRecord[]) => string;
}

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
  /** Enables batching when provided. */
  batch?: FetchBatchOptions;
  credentials?: FetchInitLike['credentials'];
  /** Inject this for custom runtimes, tests, or older Node.js versions. */
  fetch?: FetchLike;
  headers?: (() => Record<string, string>) | Record<string, string>;
  keepalive?: boolean;
  method?: string;
  /** Serializes a single record when batching is disabled. */
  serialize?: (record: ReportRecord) => string;
  signal?: (() => unknown) | unknown;
  url: string;
}

interface QueuedReport {
  record: ReportRecord;
  reject: (reason: unknown) => void;
  resolve: () => void;
}

export function createFetchTransport(options: FetchTransportOptions): ReportTransport {
  if (!options.url) {
    throw new TypeError('Fetch transport requires a url.');
  }

  async function sendPayload<T>(payload: T, serialize: (payload: T) => string): Promise<void> {
    const fetchImpl = options.fetch ?? getGlobalFetch();
    const headers = typeof options.headers === 'function' ? options.headers() : options.headers;
    const signal = typeof options.signal === 'function' ? options.signal() : options.signal;

    const response = await fetchImpl(options.url, {
      body: serialize(payload),
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
  }

  if (options.batch) {
    const { serialize = JSON.stringify } = options.batch;
    return createBatchTransport(options.batch, (records) => sendPayload(records, serialize));
  }

  return {
    send: (record) => sendPayload(record, options.serialize ?? JSON.stringify),
  };
}

function createBatchTransport(
  { intervalMs = 1000, maxSize = 10 }: FetchBatchOptions,
  sendBatch: (records: readonly ReportRecord[]) => Promise<void>,
): ReportTransport {
  if (!Number.isSafeInteger(maxSize) || maxSize < 1) {
    throw new RangeError('batch.maxSize must be a positive safe integer.');
  }
  if (!Number.isInteger(intervalMs) || intervalMs < 1 || intervalMs > 2_147_483_647) {
    throw new RangeError('batch.intervalMs must be an integer from 1 to 2147483647.');
  }

  let destroyed = false;
  const inFlight = new Set<Promise<void>>();
  const queue: QueuedReport[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;

  function dispatch(): void {
    if (queue.length === 0) {
      return;
    }

    clearTimeout(timer);
    timer = undefined;
    const batch = queue.splice(0);
    const request = Promise.resolve()
      .then(() => sendBatch(batch.map(({ record }) => record)))
      .finally(() => inFlight.delete(request));

    inFlight.add(request);
    void request.then(
      () => {
        for (const entry of batch) {
          entry.resolve();
        }
      },
      (error: unknown) => {
        for (const entry of batch) {
          entry.reject(error);
        }
      },
    );
  }

  return {
    destroy() {
      destroyed = true;
      clearTimeout(timer);
      timer = undefined;
      const error = new Error('Batch transport was destroyed before the report was sent.');
      for (const entry of queue.splice(0)) {
        entry.reject(error);
      }
    },
    async flush() {
      dispatch();
      const results = await Promise.allSettled(inFlight);
      for (const result of results) {
        if (result.status === 'rejected') {
          throw result.reason;
        }
      }
    },
    send(record) {
      if (destroyed) {
        return Promise.reject(new Error('Batch transport has been destroyed.'));
      }

      return new Promise<void>((resolve, reject) => {
        queue.push({ record, reject, resolve });
        if (queue.length === maxSize) {
          dispatch();
        } else {
          timer ??= setTimeout(dispatch, intervalMs);
        }
      });
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
