import { describe, expect, it, vi } from 'vitest';

import type { ReportRecord } from '../index.js';

import {
  createContextPlugin,
  createFilterPlugin,
  createRedactionPlugin,
  createReporter,
  createSamplingPlugin,
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
});
