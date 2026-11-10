import type { ReportTransport } from '../core/types.js';

import { createFetchTransport, type FetchTransportOptions } from './fetch-transport.js';

export type WechatRequestLike = (options: WechatRequestOptions) => void;

export interface WechatRequestOptions {
  data?: string;
  fail: (error: { errMsg: string }) => void;
  header?: Record<string, string>;
  method: 'CONNECT' | 'DELETE' | 'GET' | 'HEAD' | 'OPTIONS' | 'POST' | 'PUT' | 'TRACE';
  success: (response: { statusCode: number }) => void;
  timeout?: number;
  url: string;
}

export interface WechatRequestTransportOptions extends Pick<
  FetchTransportOptions,
  'batch' | 'headers' | 'serialize' | 'url'
> {
  method?: WechatRequestOptions['method'];
  /** Overrides wx.request for testing or custom runtimes. */
  request?: WechatRequestLike;
  /** Request timeout in milliseconds. Defaults to the Mini Program's network timeout. */
  timeout?: number;
}

declare const wx: { request?: WechatRequestLike } | undefined;

/** Uses wx.request when a report or batch is sent. */
export function wechatRequestTransport(options: WechatRequestTransportOptions): ReportTransport {
  const { method = 'POST', request, timeout, ...transportOptions } = options;

  return createFetchTransport({
    ...transportOptions,
    fetch(url, init) {
      return new Promise((resolve, reject) => {
        const send = request ?? getWechatRequest();
        send({
          data: init?.body,
          fail({ errMsg }) {
            reject(new Error(errMsg));
          },
          header: Object.fromEntries(
            Object.entries(init?.headers ?? {}).map(([name, value]) => [name.toLowerCase(), value]),
          ),
          method,
          success({ statusCode }) {
            resolve({ ok: statusCode >= 200 && statusCode < 300, status: statusCode });
          },
          ...(timeout === undefined ? {} : { timeout }),
          url,
        });
      });
    },
  });
}

function getWechatRequest(): WechatRequestLike {
  const runtime = typeof wx === 'undefined' ? undefined : wx;
  if (typeof runtime?.request !== 'function') {
    throw new Error('wx.request is unavailable. Inject options.request.');
  }
  return runtime.request.bind(runtime);
}
