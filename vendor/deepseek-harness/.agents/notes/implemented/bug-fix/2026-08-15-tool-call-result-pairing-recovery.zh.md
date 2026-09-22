# Agent Note：工具调用结果配对恢复

Status: 已实现

[English](2026-08-15-tool-call-result-pairing-recovery.md) | 中文

## 问题

工具调度失败可能留下这样的会话日志：`assistant/message` 声明了工具调用，却始终没有对应的 `tool/result` 事件；这段不完整历史随后被逐字重放进每一次后续请求。OpenAI 兼容的提供商拒绝这类历史（`assistant message with tool_calls must be followed by tool messages responding to each tool_call_id`），会话因此被永久卡死：之后每次发送都返回同样的错误，而修复逻辑因为 turn 已经关闭而从不处理它。

两个独立的成因共同导致了故障：

1. **调度器身份可能断裂。** 工具运行时的内部调度视图通过模块作用域的 `unique symbol` 寻址。同一进程如果意外加载了两份 `@deepseek-ai/dsh-tools`（重复安装、陈旧的 profile 回退链接，或混合打包的运行时），会得到两个不同的 symbol，于是消费方的 `ctx.tools[TOOL_RUNTIME_SCHEDULER]` 读到 `undefined`，`prepare` 以裸的 `TypeError: Cannot read properties of undefined (reading 'prepare')` 崩溃。

2. **失败路径没有收尾 transcript。** `executeToolCalls` 刻意排空已启动的调度并重新抛出首个错误，但不记录任何结果，导致失败步骤的 assistant 工具调用悬空。`interruptedTurnClosers` 只修复仍然*打开*的尾部 turn；已关闭的错误 turn 被跳过，`deriveMessages` 原样投影这段不平衡的历史。

## 决策

### 运行时配对不变量（agent-loop）

`executeToolCalls` 现在把“每个 assistant 工具调用都有恰好一个有序结果”视为即使在调度失败时也成立的不变量：

- 终态调度失败先排空已启动的调度，再按模型顺序补全每个已启动调用——已就绪的真实结果照常提交（`finalize`/`finish` 抛错则视为结果未知，且其阶段绝不再执行）；没有结果的已启动调用补一条合成的 `TOOL_OUTCOME_UNKNOWN` 结果。
- 从未开始的调用补上合成的 `TOOL_NOT_STARTED` 调用/结果对。
- 原始的首个失败仍然让 turn 以 `turn/end { reason: { kind: 'error' } }` 结束；补全是尽力而为，二次失败只记日志。
- 调度器在每个 group 通过 `requireToolRuntimeScheduler` 解析一次，缺失时给出可操作的诊断（陈旧的 `$DSH_HOME/profiles/<name>/node_modules` 副本、混合打包的运行时），而不是裸的 `TypeError`。

### 稳定的调度器身份（tools）

`TOOL_RUNTIME_SCHEDULER` 改为 `Symbol.for('@deepseek-ai/dsh-tools.scheduler')`，同一 realm 内的两份模块副本因此共享同一个键。`unique symbol` 类型与生成的 Cordis API 面不变。

### transcript 规范化（session）

`Session.deriveMessages()` 在输出前用 `normalizeToolTranscript` 规范化投影历史：缺失的结果补成确定性的错误工具消息（存在持久化的 `tool/call` 起点则记为结果未知，否则记为未开始）；位置错乱的结果按块顺序重排；重复或孤立的工具结果被抑制。append-only 日志从不重写。`agent.ts` 随后对请求载荷执行 `assertToolTranscriptValid` 作为 provider 有效性门禁。

这在不触碰持久化数据的前提下恢复了截图所示形状的旧日志：即使损坏的 turn 之后已有更多用户消息，下一次请求也能得到合法的 transcript。

### 客户端展示

会话投影在 closed 的 turn/step 边界处本就会把运行中的工具卡渲染为“已中断”的错误卡；现在补了一个回归测试，钉住“turn 以 error 关闭”这一场景。

## 备选方案

**向已关闭 turn 的持久化日志中插入合成结果。** append-only 日志无法在中段编辑；尾部追加会把结果交错到后续消息之后，破坏 provider 顺序与 surface 折叠。

**整体重写并重编日志。** 涉及 seq 连续性、revision、`sourceEventSeqs`、fork 以及两种持久化后端——而问题纯粹在派生投影层。

**在序列化层静默丢弃悬空的 assistant 工具调用。** 丢失了模型应当推理的历史（工具可能已经执行过），也掩盖了损坏本身。

**重试抛错的调度阶段。** 工具可能已经产生副作用，重跑 `finalize`/`finish` 可能造成重复执行。

## 影响

- 新失败不再产生孤立的工具调用；turn 仍以 error 结束并暴露原始失败。
- 旧的损坏会话在下次请求时自动恢复为确定性的合成结果；provider 永远不会收到已知非法的载荷。
- dsh-tools 的重复模块副本不再破坏调度器查找；调度器缺失会得到诊断而不是 `TypeError` 崩溃。
- append-only 日志、会话格式版本、事件词汇与两种持久化后端均未改变。

## 验证

- 单元/集成：`tool-calls.spec.ts`（30 例）覆盖调度器缺失、prepare/finalize/dispatch 失败、真实+合成结果混合、后续组失败/中止、以及下一请求通过 `assertToolTranscriptValid` 的后续轮；`tool-transcript.spec.ts`（14 例）覆盖截图所示的精确损坏形状（assistant 工具调用无结果、turn 以 error 关闭、之后又有用户消息）经 `deriveMessages` 的恢复；中断工具卡在 `conversation-node-definitions.client.spec.ts` 中被钉住。
- 类型门：host 与 client `tsc -b` 通过；改动文件的逐文件覆盖率门槛通过。
- 壳层：补装 Electron 包及其二进制后，根项目 `npm test` 69/69 全绿。
- 打包：`npm run pack` 成功；交付的运行时归档内含修复（调度器守卫、outcome-unknown 合成、canonicalizer、`Symbol.for` 键）。脚本直接导入归档内的 `dsh-session`/`dsh-llm` bundle，验证损坏形状可派生为 provider 合法 transcript。
- 应用内端到端：以损坏 fixture 会话启动打包桌面应用，在活动工作区中通过应用输入框发送消息（渠道：opencode-go / DeepSeek V4 Flash）正常完成。模型感知到合成结果（"returned 'No result provided' — odd. Let me retry"），继续 agent 循环并真实执行工具，最终输出完整回复——无 `INVALID_REQUEST`、无失败。
