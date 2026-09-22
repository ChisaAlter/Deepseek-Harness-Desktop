# Agent Note: 展示释放后的 Host 权威空白 Session 复用

Status: implemented

[English](2026-09-18-blank-session-reuse.md) | 中文

## 问题

插件展示释放后，New Session 可能复用旧的空白 Session。持久化标题 pin 和陈旧列表摘要都无法证明该 Session 仍是普通草稿。Workspace 与无工作目录导航还需要对冷历史、缺失候选、成员关系变化和并发创建采用同一个判断。

## 决策

Host 拥有只读的 `session.blankReuse({ sessionId })` 决定，并在不激活 Agent 的情况下检查已挂载或持久化历史。本决定取代 [Web client scope 笔记](../architecture/2026-07-25-web-client-session-scope-and-provide-channel.zh.md)中只按摘要复用空白会话的规则。`blank` 表示尚未出现 `turn/start`，但历史中的任意 `session/title`、parent/seed/inherited/subagent 身份、`turn/start`、`system/message`、`user/message`、`assistant/message` 或 `tool/result` 都会使 Session 不符合条件。任一时刻出现非 null 的 `session/presentation` 也会使其不符合条件，即使之后以 null presentation 释放了当前展示；孤立的 null presentation 在其它检查通过时仍可复用。普通模型、权限和 plan 配置仍符合条件。缺失 Session 返回 `reusable: false`；真实读取错误与取消向上传递。

Client 通过 `ISessions.canReuseBlank(sessionId, signal?)` 暴露同一决定。Workspace 与无工作目录 New Session 连接器先按摘要排除明显不合格项，等待 Host 确认，重新检查当前成员关系和归档状态，并按目标合并完整的检查、复核和创建操作。不合格、消失或已改变的候选项跳过该候选并创建新的 Session；真实读取错误或取消向上传递且不创建。主区域导航沿用现有顺序：retain 目标，仅对仍有效的请求运行 `beforeOpen`，提交选择，再释放先前的 reference。

该决定不新增 projection cache 字段或版本，不清除标题 pin，不重写旧日志，也不改变普通草稿配置。用户可以显式打开带标题或其它不合格原因的 Session，并继续使用其现有数据。

## 考虑过的替代方案

- **只在 Client 使用列表摘要** — rejected：陈旧摘要无法确认 Session 是否有历史标题、展示、身份或 transcript 事件，并发导航也可能绕过 Host 权威判断。
- **清除或重写标题 pin 和旧日志** — rejected：New Session 复用是导航选择，不能销毁用户数据或持久化证据。
- **把已释放展示的 Session 当作普通会话** — rejected：历史非 null presentation 即使当前展示已经释放，仍是所有权事实。

## 验证

已通过 25 项 Host 边界测试、272 项 Workspace 测试与两条真实浏览器新建、首次发送及重载流程；冷启动 JSONL/zstd 与浏览器验证均确认旧日志不变。正式 Host/Client/Web 构建通过。

## 后果

两条 New Session 路径都使用同一个权威资格判断。普通配置和孤立 null presentation 仍可复用，而标题历史、历史展示、身份、turn 和 transcript 内容会促使创建新的 Session。显式打开会保留旧 Session、标题 pin 和日志。读取错误与取消继续对调用方可见，不会静默创建替代项。
