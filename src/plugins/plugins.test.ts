import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ReportRecord } from '../index.js';

import {
  createContextPlugin,
  createFilterPlugin,
  createLogLevelPlugin,
  createRateLimitPlugin,
  createRedactionPlugin,
  createReporter,
  createSamplingPlugin,
  createTagsPlugin,
} from '../index.js';

describe('reporter plugins', () => {
  it('uses context defaults without overriding reporter or per-report context', async () => {
    const send = vi.fn<(record: ReportRecord) => Promise<void>>(async () => {});
    const reporter = createReporter({ transport: { send } });
    reporter.use(createContextPlugin({ region: 'local', service: 'api', version: 1 }));
    reporter.setContext({ region: 'east', version: 2 });

    await reporter.event('ready', undefined, { context: { region: 'west' } });

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ context: { region: 'west', service: 'api', version: 2 } }),
    );
  });

  it('skips reports rejected by an async predicate before running later plugins', async () => {
    const send = vi.fn<() => Promise<void>>(async () => {});
    const random = vi.fn<() => number>(() => 0.2);
    const reporter = createReporter({ transport: { send } });
    reporter.use(createFilterPlugin(async (record) => record.name === 'keep'));
    reporter.use(createSamplingPlugin(0.5, random));

    await expect(reporter.event('drop')).resolves.toMatchObject({
      reason: 'filtered',
      status: 'skipped',
    });
    expect(random).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();

    await expect(reporter.event('keep')).resolves.toMatchObject({ status: 'sent' });
    expect(send).toHaveBeenCalledOnce();
  });

  it('handles sampling boundaries without drawing a random value', () => {
    const record: ReportRecord = { id: 'id', name: 'event', timestamp: 0, type: 'event' };
    const random = vi.fn<() => number>(() => 0.5);

    expect(createSamplingPlugin(0, random).beforeSend?.(record)).toBeNull();
    expect(createSamplingPlugin(1, random).beforeSend?.(record)).toBe(record);
    expect(random).not.toHaveBeenCalled();
    expect(createSamplingPlugin(0.5, random).beforeSend?.(record)).toBeNull();
    for (const rate of [-1, 2, NaN, Infinity]) {
      expect(() => createSamplingPlugin(rate)).toThrow(RangeError);
    }
  });

  it('masks nested fields in data and context without mutating shared input', async () => {
    const send = vi.fn<(record: ReportRecord) => Promise<void>>(async () => {});
    const reporter = createReporter({ transport: { send } });
    reporter.use(createRedactionPlugin(['authorization', 'token']));
    const headers = { Authorization: 'secret', contentType: 'application/json' };
    const data = { requests: [{ headers }], token: 'secret' };

    await reporter.event('request', data, { context: { headers } });

    const maskedHeaders = { Authorization: '[REDACTED]', contentType: 'application/json' };
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        context: { headers: maskedHeaders },
        data: { requests: [{ headers: maskedHeaders }], token: '[REDACTED]' },
      }),
    );
    expect(data.token).toBe('secret');
    expect(headers.Authorization).toBe('secret');
  });

  it('handles circular references and preserves own __proto__ fields as data', () => {
    const data: Record<string, unknown> = { ['__proto__']: { token: 'secret' } };
    data.self = data;
    const record: ReportRecord = { data, id: 'id', name: 'event', timestamp: 0, type: 'event' };

    const plugin = createRedactionPlugin(['token']);
    const outgoing = plugin.beforeSend?.(record) as ReportRecord;
    const output = outgoing.data as typeof data;

    expect(output.self).toBe(output);
    expect(Object.getPrototypeOf(output)).toBe(Object.prototype);
    expect(Object.getOwnPropertyDescriptor(output, '__proto__')?.value).toEqual({
      token: '[REDACTED]',
    });
  });

  it('filters logs below the minimum while passing other report types and unlevelled logs', async () => {
    const send = vi.fn<(record: ReportRecord) => Promise<void>>(async () => {});
    const reporter = createReporter({ transport: { send } });
    reporter.use(createLogLevelPlugin('warn'));

    await expect(reporter.log('debug', 'debug')).resolves.toMatchObject({ reason: 'filtered' });
    await expect(reporter.log('info', 'info')).resolves.toMatchObject({ reason: 'filtered' });
    await reporter.log('warn', 'warn');
    await reporter.log('error', 'error');
    await reporter.log('fatal', 'fatal');
    await reporter.event('checkout', undefined, { level: 'debug' });
    await reporter.error(new Error('checkout failed'), undefined, { level: 'debug' });
    await reporter.report('unlevelled', undefined, { type: 'log' });

    expect(send.mock.calls.map(([record]) => [record.type, record.level])).toEqual([
      ['log', 'warn'],
      ['log', 'error'],
      ['log', 'fatal'],
      ['event', 'debug'],
      ['error', 'debug'],
      ['log', undefined],
    ]);
  });

  it('appends default tags in order without duplicates or input mutation', async () => {
    const send = vi.fn<(record: ReportRecord) => Promise<void>>(async () => {});
    const reporter = createReporter({ transport: { send } });
    const defaults = ['checkout', 'production', 'production'];
    const tags = ['mobile', 'checkout', 'mobile'];
    reporter.use(createTagsPlugin(defaults));
    defaults.push('later');

    await reporter.event('checkout', undefined, { tags });
    await reporter.event('ready');

    expect(send.mock.calls.map(([record]) => record.tags)).toEqual([
      ['mobile', 'checkout', 'production'],
      ['checkout', 'production'],
    ]);
    expect(tags).toEqual(['mobile', 'checkout', 'mobile']);
  });
});

describe('rate limit plugin', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('caps concurrent reports, then opens a new window at the time boundary', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const send = vi.fn<(record: ReportRecord) => Promise<void>>(async () => {});
    const reporter = createReporter({ transport: { send } });
    reporter.use(createFilterPlugin((record) => record.name !== 'ignored'));
    reporter.use(createRateLimitPlugin({ maxReports: 2, windowMs: 1000 }));

    await reporter.event('ignored');
    const results = await Promise.all([
      reporter.event('first'),
      reporter.event('second'),
      reporter.event('third'),
    ]);
    expect(results).toMatchObject([
      { status: 'sent' },
      { status: 'sent' },
      { reason: 'filtered', status: 'skipped' },
    ]);

    vi.setSystemTime(999);
    await expect(reporter.event('too soon')).resolves.toMatchObject({ reason: 'filtered' });
    vi.setSystemTime(1000);
    await expect(reporter.event('next window')).resolves.toMatchObject({ status: 'sent' });
    expect(send.mock.calls.map(([record]) => record.name)).toEqual([
      'first',
      'second',
      'next window',
    ]);
  });

  it('opens a new window if the clock moves backwards', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const reporter = createReporter({ transport: { send: async () => {} } });
    reporter.use(createRateLimitPlugin({ maxReports: 1, windowMs: 1000 }));

    await expect(reporter.event('first')).resolves.toMatchObject({ status: 'sent' });
    vi.setSystemTime(0);
    await expect(reporter.event('after clock change')).resolves.toMatchObject({ status: 'sent' });
  });

  it('rejects invalid limits and window durations', () => {
    for (const value of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => createRateLimitPlugin({ maxReports: value, windowMs: 1000 })).toThrow(
        RangeError,
      );
      expect(() => createRateLimitPlugin({ maxReports: 1, windowMs: value })).toThrow(RangeError);
    }
  });
});
