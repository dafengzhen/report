# @dafengzhen/report

[![GitHub License](https://img.shields.io/github/license/dafengzhen/report?color=blue)](https://github.com/dafengzhen/report)
[![npm version](https://img.shields.io/npm/v/@dafengzhen/report)](https://www.npmjs.com/package/@dafengzhen/report)

[简体中文](./README.zh.md)

A lightweight TypeScript library for reporting events, logs, and errors in browsers and Node.js.

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
