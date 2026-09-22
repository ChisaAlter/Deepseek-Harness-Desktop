# Agent Note: SessionQuery.readSession 用 Session.fromRestore 恢复持久化日志

Status: implemented

[English](2026-09-18-session-query-seeded-restore.md) | 中文

## Problem

`SessionQueryEngine.readSession` 加载完整持久化日志后，用 `Session.create`（快照/fork 创建构造器）做校验。对 seeded 会话，`Session.create` 要求 `seed.length === inheritedEventCount`——seed 必须恰好等于继承前缀。而存储的 seeded 日志更长：继承前缀 + `session/end-seed` 标记 + 会话自身事件。因此任何持久化的 seeded 会话在精确读取时都会抛 `seeded session constructor seed must equal its inherited prefix`，尽管工件本身完好——已用真实 25 会话语料验证：4 个失败恰好全是 seeded 会话，改用 `Session.fromRestore` 后 25 个全部通过。

## Decision

改用 `Session.fromRestore(id, events, header, inheritedEventCount, 'detached', projections)` 校验加载的日志——这是为恢复完整存储日志设计的构造器。`readSession` 传入完整加载事件列表、持久化的 `inheritedEventCount`、detached 事件所有权（加载方持有解码克隆），以及与原来相同的 `currentSessionMessageProjections` 目录。

## Alternatives considered

**先把事件列表截断到继承前缀再调 `Session.create`。** 这会丢掉会话自身的事件，校验了一个磁盘上并不存在的工件；读取路径必须确认完整日志，而不是它的前缀。

**放宽 `Session.create` 的不变量。** 该不变量对 `create` 的语义是正确的——fork 快照的 seed 就是继承前缀本身。放宽到接受 seed 之后的事件，会混淆 `Session` 类型刻意区分的两种构造模式。

## Consequences

持久化的 seeded 会话可以通过 `readSession` 读回；非 seeded 会话不受影响，因为 `fromRestore` 对它们执行相同的结构重放。`session-query.spec.ts` 中的回归用例存储了一条 seeded 记录（非零继承前缀 + 会话本地事件）并走真实 `readSession` 路径，`TestPersistence` 的记录项新增可选 `inheritedEventCount` 字段来表达该场景。
