import { describe, expect, it, vi } from 'vitest';

import type { ReportRecord } from '../index.js';

import { createReporter, normalizeError } from '../index.js';

describe('report names', () => {
  it('preserves the existing names by default', async () => {
    const send = vi.fn<(record: ReportRecord) => Promise<void>>(async () => {});
    const reporter = createReporter({ transport: { send } });

    await reporter.event('checkout_started');
    await reporter.error(new Error('checkout failed'));
    await reporter.log('warn', 'checkout is slow');
    await reporter.report('checkout_finished');

    expect(send.mock.calls.map(([record]) => record.name)).toEqual([
      'checkout_started',
      'error',
      'log',
      'checkout_finished',
    ]);
  });

  it('uses the final report type for standard names before running hooks', async () => {
    const beforeSend = vi.fn<(record: ReportRecord) => ReportRecord>((record) => record);
    const send = vi.fn<(record: ReportRecord) => Promise<void>>(async () => {});
    const reporter = createReporter({ beforeSend, nameFormat: 'standard', transport: { send } });

    await reporter.event('checkout_started', undefined, { type: 'analytics' });

    const expected = expect.objectContaining({
      name: 'analytics.checkout_started',
      type: 'analytics',
    });
    expect(beforeSend).toHaveBeenCalledWith(expected);
    expect(send).toHaveBeenCalledWith(expected);
  });

  it('supports a custom formatter and an explicit per-report name', async () => {
    const nameFormat = vi.fn<(name: string, type: string) => string>(
      (name, type) => `storefront/${type}/${name}`,
    );
    const send = vi.fn<(record: ReportRecord) => Promise<void>>(async () => {});
    const reporter = createReporter({ nameFormat, transport: { send } });

    await reporter.report('checkout_started');
    await reporter.error(new Error('checkout failed'), undefined, { name: 'payment_declined' });
    await reporter.log('warn', 'checkout is slow', undefined, { name: 'checkout_slow' });

    expect(nameFormat.mock.calls).toEqual([['checkout_started', 'custom']]);
    expect(send.mock.calls.map(([record]) => record.name)).toEqual([
      'storefront/custom/checkout_started',
      'payment_declined',
      'checkout_slow',
    ]);
  });

  it('rejects blank names from both custom formatters and explicit overrides', async () => {
    const send = vi.fn<() => Promise<void>>(async () => {});
    const reporter = createReporter({ nameFormat: () => ' ', transport: { send } });

    await expect(reporter.event('ready')).rejects.toThrow(
      'Report name must be a non-empty string.',
    );
    await expect(reporter.log('info', 'ready', undefined, { name: ' ' })).rejects.toThrow(
      'Report name must be a non-empty string.',
    );
    expect(send).not.toHaveBeenCalled();
  });
});

describe('reporter lifecycle', () => {
  it('keeps hook order stable when a running hook removes itself and adds another plugin', async () => {
    const calls: string[] = [];
    const reporter = createReporter({ transport: { send: async () => {} } });
    const remove = reporter.use({
      beforeSend(record) {
        calls.push('first');
        remove();
        reporter.use({
          beforeSend(next) {
            calls.push('new');
            return next;
          },
          name: 'new',
        });
        return record;
      },
      name: 'first',
    });
    reporter.use({
      afterSend() {
        calls.push('after');
      },
      beforeSend(record) {
        calls.push('second');
        return record;
      },
      name: 'second',
    });

    await reporter.event('one');
    expect(calls).toEqual(['first', 'second', 'after']);
    await reporter.event('two');
    expect(calls).toEqual(['first', 'second', 'after', 'second', 'new', 'after']);
  });

  it('reserves names during setup and releases a name if setup fails', () => {
    const reporter = createReporter({ transport: { send: async () => {} } });
    expect(() =>
      reporter.use({
        name: 'reserved',
        setup(instance) {
          instance.use({ name: 'reserved' });
        },
      }),
    ).toThrow('A plugin named "reserved" is already registered.');

    expect(() => reporter.use({ name: 'reserved' })).not.toThrow();
  });

  it('skips a pending report when the reporter is destroyed before transport starts', async () => {
    const send = vi.fn<() => Promise<void>>(async () => {});
    const cleanup = vi.fn<() => void>();
    const reporter = createReporter({ transport: { send } });
    const remove = reporter.use({
      beforeSend: (record) => record,
      name: 'plugin',
      setup: () => cleanup,
    });

    const pending = reporter.event('ready');
    await reporter.destroy();
    remove();

    await expect(pending).resolves.toMatchObject({ reason: 'destroyed', status: 'skipped' });
    expect(send).not.toHaveBeenCalled();
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it('reports a failed send even when the thrown value cannot be converted to a string', async () => {
    const reporter = createReporter({
      transport: {
        async send() {
          throw Object.create(null);
        },
      },
    });

    await expect(reporter.event('ready')).resolves.toMatchObject({
      error: new Error('[Unserializable value]'),
      status: 'failed',
    });
  });

  it('normalizes circular error causes without replacing the original error', () => {
    const root = new Error('root');
    const child = new Error('child', { cause: root });
    root.cause = child;

    expect(normalizeError(root)).toMatchObject({
      cause: { cause: '[Circular error cause]', message: 'child' },
      message: 'root',
    });
  });
});
