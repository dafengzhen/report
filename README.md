# @dafengzhen/report

[![GitHub License](https://img.shields.io/github/license/dafengzhen/report?color=blue)](https://github.com/dafengzhen/report)
[![npm version](https://img.shields.io/npm/v/@dafengzhen/report)](https://www.npmjs.com/package/@dafengzhen/report)

[简体中文](./README.zh.md)

A lightweight TypeScript library for reporting events, logs, and errors in browsers, Node.js, and WeChat Mini Programs.

```sh
npm install @dafengzhen/report
```

## Usage

```ts
import {
  createContextPlugin,
  createFetchTransport,
  createFilterPlugin,
  createRedactionPlugin,
  createReporter,
} from '@dafengzhen/report';

const reporter = createReporter({
  transport: createFetchTransport({ url: 'https://example.com/reports' }),
});

reporter.use(createFilterPlugin((record) => record.level !== 'debug'));
reporter.use(createContextPlugin({ service: 'storefront' }));
reporter.use(createRedactionPlugin(['token', 'authorization']));

await reporter.event('checkout_started', { cartSize: 2 });
```

## WeChat Mini Programs

Use `wechatRequestTransport()` to send reports through `wx.request`. It sends JSON with `POST` by default. Use an HTTPS endpoint and add its domain to the Mini Program's `request` allowlist in the WeChat admin console.

```ts
import { createReporter, wechatRequestTransport } from '@dafengzhen/report';

const reporter = createReporter({
  transport: wechatRequestTransport({ url: 'https://example.com/reports' }),
});

await reporter.event('checkout_started', { cartSize: 2 });
```

Set `headers` to supply request headers, `timeout` to set a timeout in milliseconds, or `batch` to enable batching. Reports return `failed` on network errors and non-2xx responses.

## Batch reporting

Pass `batch` to `createFetchTransport()` or `wechatRequestTransport()` to send several records in one request. The default request body is a JSON array of records. Set `batch.serialize` if your endpoint expects a different format.

```ts
const reporter = createReporter({
  transport: createFetchTransport({
    batch: { intervalMs: 1000, maxSize: 10 },
    url: 'https://example.com/reports',
  }),
});

const reports = [reporter.event('checkout_started'), reporter.log('info', 'Cart loaded')];
await reporter.flush();
const results = await Promise.all(reports);
```

- A batch sends when it reaches `maxSize` (default 10) or `intervalMs` (default 1000) elapses after its first record enters the queue.
- `flush()` sends the records already queued and waits for in-flight batches. Reports still running asynchronous `beforeSend` hooks enter the queue once those hooks finish.
- Each report promise settles with its send result. A failed request marks every record in that batch as `failed` and rejects any `flush()` waiting for it.
- `destroy()` clears the timer and discards queued records, which resolve as `failed`. Batches already dispatched settle with their request results.

## Report names

By default, `event()` and `report()` use the supplied name, while `error()` and `log()` use `error` and `log` respectively.

- Set `nameFormat: 'standard'` in `createReporter()` to use `<type>.<name>`, such as `event.checkout_started`.
- Set `` nameFormat: (name, type) => `${type}/${name}` `` to use a custom format.
- Pass `{ name: 'payment_declined' }` in the options for an individual report to set its final name directly. This takes precedence over `nameFormat`.

## Built-in plugins

| Factory                         | Behavior                                                                                                                                                                                           |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createFilterPlugin(predicate)` | Keeps reports when the sync or async predicate returns `true`.                                                                                                                                     |
| `createSamplingPlugin(rate)`    | Samples each report independently. The rate ranges from `0` (drop all) to `1` (keep all).                                                                                                          |
| `createContextPlugin(defaults)` | Adds defaults. Context set on the reporter takes precedence, and per-report context has the highest priority.                                                                                      |
| `createRedactionPlugin(fields)` | Matches field names case-insensitively and replaces values with `[REDACTED]` in plain objects and arrays inside `data` and `context`. Register it after plugins that add fields to those payloads. |

Plugins run in registration order after the reporter's `beforeSend` hook. `reporter.use()` returns a function that unregisters the plugin.

## License

[MIT](./LICENSE)
