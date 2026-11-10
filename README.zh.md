# @dafengzhen/report

[![GitHub License](https://img.shields.io/github/license/dafengzhen/report?color=blue)](https://github.com/dafengzhen/report)
[![npm version](https://img.shields.io/npm/v/@dafengzhen/report)](https://www.npmjs.com/package/@dafengzhen/report)

[English](./README.md)

轻量的 TypeScript 上报库，适用于浏览器、Node.js 和微信小程序，支持上报事件、日志和错误。

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

## 微信小程序

使用 `wechatRequestTransport()` 通过 `wx.request` 上报，默认以 `POST` 发送 JSON。请使用 HTTPS 上报地址，并在微信公众平台将其加入小程序的 `request` 合法域名。

```ts
import { createReporter, wechatRequestTransport } from '@dafengzhen/report';

const reporter = createReporter({
  transport: wechatRequestTransport({ url: 'https://example.com/reports' }),
});

await reporter.event('checkout_started', { cartSize: 2 });
```

可通过 `headers` 设置请求头，通过 `timeout` 设置请求超时时间（毫秒），也可传入 `batch` 启用批量上报。网络错误和非 2xx 响应会使上报返回 `failed`。

## 批量上报

在 `createFetchTransport()` 或 `wechatRequestTransport()` 中传入 `batch`，即可在一次请求中发送多条记录。请求体默认是记录组成的 JSON 数组，也可以通过 `batch.serialize` 自定义格式。

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

- 达到 `maxSize`（默认 10 条），或距本批首条记录入队经过 `intervalMs`（默认 1000 毫秒）后，自动发送该批次。
- `flush()` 立即发送已入队的记录，并等待已发起的批次。仍在执行异步 `beforeSend` 钩子的记录会在钩子完成后入队。
- 每条上报按发送结果返回状态。批次请求失败时，该批记录均返回 `failed`，等待该批次的 `flush()` 也会拒绝。
- `destroy()` 清除定时器并丢弃仍在队列中的记录，这些记录返回 `failed`。已经发起的批次按请求结果结束。

## 上报名称

默认情况下，`event()` 和 `report()` 使用传入的名称，`error()` 和 `log()` 分别使用 `error` 和 `log`。

- 在 `createReporter()` 中设置 `nameFormat: 'standard'`，统一使用 `<type>.<name>` 格式，例如 `event.checkout_started`。
- 设置 `` nameFormat: (name, type) => `${type}/${name}` ``，即可自定义名称格式。
- 在单次上报的选项中传入 `{ name: 'payment_declined' }`，直接指定最终名称，优先于 `nameFormat`。

## 内置插件

| 工厂函数                                          | 用途                                                                                                                               |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `createFilterPlugin(predicate)`                   | 仅保留同步或异步条件返回 `true` 的上报。                                                                                           |
| `createSamplingPlugin(rate)`                      | 对每条上报独立采样，`0` 表示全部丢弃，`1` 表示全部保留。                                                                           |
| `createContextPlugin(defaults)`                   | 补充默认上下文。同名字段优先使用单次上报的值，其次使用实例上下文。                                                                 |
| `createRedactionPlugin(fields)`                   | 在 `data` 和 `context` 的普通对象及数组中按字段名脱敏，忽略大小写，替换值为 `[REDACTED]`。若其他插件会添加字段，请先注册这些插件。 |
| `createLogLevelPlugin(minLevel)`                  | 保留达到最低级别的日志，级别从低到高依次为 `debug`、`info`、`warn`、`error`、`fatal`。其他类型的上报和没有级别的日志直接通过。     |
| `createRateLimitPlugin({ maxReports, windowMs })` | 在每个固定时间窗口内最多放行 `maxReports` 条上报。两个参数均为正安全整数。                                                         |
| `createTagsPlugin(tags)`                          | 在单次上报的标签之后追加默认标签，重复标签仅保留首次出现的位置。传入空数组时保留原标签。                                           |

插件在实例的 `beforeSend` 钩子之后按注册顺序执行。调用 `reporter.use()` 的返回函数即可卸载插件。

```ts
reporter.use(createLogLevelPlugin('warn'));
reporter.use(createTagsPlugin(['storefront']));
reporter.use(createRateLimitPlugin({ maxReports: 100, windowMs: 60_000 }));
```

首条上报到达限流插件时开始计时。插件放行的上报会占用配额，即使后续钩子丢弃了该上报，或发送失败。超出配额的上报返回 `skipped`，原因为 `filtered`。如果多个上报实例需要独立配额，请分别创建限流插件。

## 许可证

[MIT](./LICENSE)
