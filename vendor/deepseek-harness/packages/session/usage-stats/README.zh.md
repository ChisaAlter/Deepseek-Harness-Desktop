# @deepseek-ai/dsh-usage-stats

[English](README.md) | 中文

注册 `usageDaily` projection 单元与 `usageStats` 服务的函数插件：从 usage chunk、已组装的 assistant 消息和 `user/message` 折叠出按 turn/step 去重的带时间戳用量样本与人工提问时间，再切成设置页用的最近 7 或 30 天 DTO。折叠本身不按本地日历分桶；`usageStats.summarize({ rangeDays, timeZone })` 使用客户端 IANA 时区切窗。

## 折叠语义

- usage 类型的 `assistant/chunk` 为其 turn/step 打开一条样本。随后同一步的 `assistant/message.usage` 替换它，因此不会双计。
- Token 总量为未命中缓存的 input + output + cache-read + cache-write。reasoning token 已包含在 output 中。
- 模型 id 取已组装消息，否则取最近一次 `request/header` / `request/context` 的模型，再否则为 `(unknown)`。
- `userMessageTimes` 只记录 source kind 为 `user` 的 `user/message`。
- `summarize` 的 Token、消息与热力图计入所有会话（含 subagent 子会话）。`sessionCount` 只计窗口内有过人工提问的根会话。
- `currentStreak` 是以今天结尾的连续活跃日；今天空闲则从昨天起算。窗口之前的活跃日不延长 streak。

## 组合

```yaml
- id: usage-stats
  name: '@deepseek-ai/dsh-usage-stats'
```

注入 `sessionProjections`。可选的 `sessions`、`sessionPersistence`、`sessionProjectionCache` 通过 `ctx.get` 读取：在线会话优先，冷会话用缓存，再 fail-soft 地 `readFrom` 恢复。

## 模型体验

无，因为插件只计算面向客户端的、由已写入日志的会话事件派生的读模型，不触碰任何提示词、消息、schema、流或工具结果。

#### KV Cache 影响

无；插件从不组装或发送提供方请求。

## 已知局限与延后工作

- **不做货币换算** — DTO 只报 Token，不估算花费。本包没有模型单价表。
- **不上报 usage 的适配器 Token 为 0** — 会话与人工提问仍计入；只有未计量流量时热力图格子为空。
- **冷会话可能略旧** — 已缓存的 `usageDaily` 行不再重放日志。缺缓存时以有限并发 `readFrom`；读取失败则该会话按空计。
- **仅挂载于 web-app bundle** — 其他装配不提供 `usageDaily` 键，也没有 `usage.summary` RPC。
