import { afterEach, describe, expect, it, vi } from 'vitest';

import type { WechatRequestLike } from '../index.js';

import { createReporter, wechatRequestTransport } from '../index.js';

const url = 'https://example.com/reports';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('WeChat request transport', () => {
  it('uses the native request with its receiver and waits for its response', async () => {
    vi.stubGlobal('wx', undefined);
    const reporter = createReporter({ transport: wechatRequestTransport({ url }) });
    const request = vi.fn<WechatRequestLike>();
    const runtime = { request };
    vi.stubGlobal('wx', runtime);

    const report = reporter.event('opened', { count: 1 });

    expect(request).toHaveBeenCalledOnce();
    expect(request.mock.contexts[0]).toBe(runtime);
    const [options] = request.mock.calls[0]!;
    expect(options).toMatchObject({
      header: { 'content-type': 'application/json' },
      method: 'POST',
      url,
    });
    expect(JSON.parse(options.data!)).toMatchObject({ data: { count: 1 }, name: 'opened' });

    options.success({ statusCode: 204 });
    await expect(report).resolves.toMatchObject({ status: 'sent' });
  });

  it('treats HTTP errors delivered to success and network errors as failures', async () => {
    const request = vi
      .fn<WechatRequestLike>()
      .mockImplementationOnce(({ success }) => success({ statusCode: 503 }))
      .mockImplementationOnce(({ fail }) => fail({ errMsg: 'request:fail timeout' }));
    const reporter = createReporter({ transport: wechatRequestTransport({ request, url }) });

    await expect(reporter.event('http_error')).resolves.toMatchObject({
      error: new Error('Report request failed with HTTP 503.'),
      status: 'failed',
    });
    await expect(reporter.event('network_error')).resolves.toMatchObject({
      error: new Error('request:fail timeout'),
      status: 'failed',
    });
  });

  it('passes options through to wx.request when flushing a batch', async () => {
    const request = vi.fn<WechatRequestLike>(({ success }) => success({ statusCode: 201 }));
    const reporter = createReporter({
      transport: wechatRequestTransport({
        batch: { maxSize: 3 },
        headers: () => ({
          Authorization: 'Bearer token',
          'Content-Type': 'application/vnd.report+json',
        }),
        method: 'PUT',
        request,
        timeout: 2000,
        url,
      }),
    });

    const reports = [reporter.event('first'), reporter.event('second')];
    expect(request).not.toHaveBeenCalled();
    await reporter.flush();

    expect(request).toHaveBeenCalledOnce();
    const [options] = request.mock.calls[0]!;
    expect(options).toMatchObject({
      header: { authorization: 'Bearer token', 'content-type': 'application/vnd.report+json' },
      method: 'PUT',
      timeout: 2000,
      url,
    });
    expect(JSON.parse(options.data!)).toMatchObject([{ name: 'first' }, { name: 'second' }]);
    await expect(Promise.all(reports)).resolves.toMatchObject([
      { status: 'sent' },
      { status: 'sent' },
    ]);
  });

  it('reports an unavailable runtime only when sending', async () => {
    vi.stubGlobal('wx', undefined);
    const reporter = createReporter({ transport: wechatRequestTransport({ url }) });

    await expect(reporter.event('opened')).resolves.toMatchObject({
      error: new Error('wx.request is unavailable. Inject options.request.'),
      status: 'failed',
    });
  });
});
