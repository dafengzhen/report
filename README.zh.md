# @dafengzhen/report

[![GitHub License](https://img.shields.io/github/license/dafengzhen/report?color=blue)](https://github.com/dafengzhen/report)
[![npm version](https://img.shields.io/npm/v/@dafengzhen/report)](https://www.npmjs.com/package/@dafengzhen/report)

[English](./README.md)

轻量的 TypeScript 上报库，适用于浏览器和 Node.js，支持上报事件、日志和错误。

```sh
npm install @dafengzhen/report
```

## 使用示例

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

## 上报名称

默认情况下，`event()` 和 `report()` 使用传入的名称，`error()` 和 `log()` 分别使用 `error` 和 `log`。

- 在 `createReporter()` 中设置 `nameFormat: 'standard'`，统一使用 `<type>.<name>` 格式，例如 `event.checkout_started`。
- 设置 `` nameFormat: (name, type) => `${type}/${name}` ``，即可自定义名称格式。
- 在单次上报的选项中传入 `{ name: 'payment_declined' }`，直接指定最终名称，优先于 `nameFormat`。

## 内置插件

| 工厂函数                        | 用途                                                                                                                               |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `createFilterPlugin(predicate)` | 仅保留同步或异步条件返回 `true` 的上报。                                                                                           |
| `createSamplingPlugin(rate)`    | 对每条上报独立采样，`0` 表示全部丢弃，`1` 表示全部保留。                                                                           |
| `createContextPlugin(defaults)` | 补充默认上下文。同名字段优先使用单次上报的值，其次使用实例上下文。                                                                 |
| `createRedactionPlugin(fields)` | 在 `data` 和 `context` 的普通对象及数组中按字段名脱敏，忽略大小写，替换值为 `[REDACTED]`。若其他插件会添加字段，请先注册这些插件。 |

插件在实例的 `beforeSend` 钩子之后按注册顺序执行。调用 `reporter.use()` 的返回函数即可卸载插件。

## 许可证

[MIT](./LICENSE)
