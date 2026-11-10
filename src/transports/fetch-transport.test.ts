import { afterEach, describe, expect, it, vi } from 'vitest';

import type { FetchLike } from '../index.js';

import { createFetchTransport, createReporter } from '../index.js';

const success = { ok: true, status: 200 };

afterEach(() => {
  vi.useRealTimers();
});

describe('fetch transport batching', () => {
  it('keeps the single-record payload and serializer by default', async () => {
    const fetch = vi.fn<FetchLike>(async () => success);
    const reporter = createReporter({
      transport: createFetchTransport({
        fetch,
        serialize: (record) => record.name,
        url: '/reports',
      }),
    });

    await reporter.event('first');
    await reporter.event('second');

    expect(fetch.mock.calls.map(([, init]) => init?.body)).toEqual(['first', 'second']);
  });

  it('sends a full batch as one JSON array and times the remainder from its first record', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn<FetchLike>(async () => success);
    const reporter = createReporter({
      transport: createFetchTransport({
        batch: { intervalMs: 100, maxSize: 3 },
        fetch,
        url: '/reports',
      }),
    });

    const first = reporter.event('first');
    await vi.advanceTimersByTimeAsync(50);
    expect(fetch).not.toHaveBeenCalled();

    const results = await Promise.all([
      first,
      reporter.log('info', 'second'),
      reporter.report('third'),
    ]);
    expect(results.map(({ status }) => status)).toEqual(['sent', 'sent', 'sent']);
    expect(fetch).toHaveBeenCalledOnce();
    expect(JSON.parse(fetch.mock.calls[0]![1]!.body!)).toMatchObject([
      { name: 'first', type: 'event' },
      { name: 'log', type: 'log' },
      { name: 'third', type: 'custom' },
    ]);

    const remainder = reporter.event('remainder');
    await vi.advanceTimersByTimeAsync(80);
    const last = reporter.event('last');
    expect(fetch).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(20);

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetch.mock.calls[1]![1]!.body!)).toMatchObject([
      { name: 'remainder' },
      { name: 'last' },
    ]);
    await expect(Promise.all([remainder, last])).resolves.toMatchObject([
      { status: 'sent' },
      { status: 'sent' },
    ]);
  });

  it('flushes the remainder once and waits for batches already in flight', async () => {
    const failed = { ok: false, status: 503 };
    let completeFirst!: (response: typeof failed) => void;
    const firstResponse = new Promise<typeof failed>((resolve) => {
      completeFirst = resolve;
    });
    const fetch = vi.fn<FetchLike>(async () => success).mockReturnValueOnce(firstResponse);
    const onError = vi.fn<() => void>();
    const reporter = createReporter({
      onError,
      transport: createFetchTransport({
        batch: { maxSize: 2, serialize: (records) => records.map(({ name }) => name).join(',') },
        fetch,
        url: '/reports',
      }),
    });

    const first = reporter.event('first');
    const second = reporter.event('second');
    const third = reporter.event('third');
    const flushes = Promise.allSettled([reporter.flush(), reporter.flush()]);

    await expect(third).resolves.toMatchObject({ status: 'sent' });
    expect(fetch.mock.calls.map(([, init]) => init?.body)).toEqual(['first,second', 'third']);
    completeFirst(failed);
    const error = new Error('Report request failed with HTTP 503.');
    await expect(flushes).resolves.toEqual([
      { reason: error, status: 'rejected' },
      { reason: error, status: 'rejected' },
    ]);
    await expect(Promise.all([first, second])).resolves.toMatchObject([
      { status: 'failed' },
      { status: 'failed' },
    ]);
    expect(onError).toHaveBeenCalledTimes(2);

    const next = reporter.event('next');
    await reporter.flush();
    await expect(next).resolves.toMatchObject({ status: 'sent' });
    await reporter.flush();
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('discards queued reports and clears the timer on destroy', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn<FetchLike>(async () => success);
    const reporter = createReporter({
      transport: createFetchTransport({ batch: {}, fetch, url: '/reports' }),
    });
    const pending = reporter.event('first');
    expect(vi.getTimerCount()).toBe(1);

    await reporter.destroy();

    await expect(pending).resolves.toMatchObject({ status: 'failed' });
    expect(vi.getTimerCount()).toBe(0);
    expect(fetch).not.toHaveBeenCalled();
  });
});
