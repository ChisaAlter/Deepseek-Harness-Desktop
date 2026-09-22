# Decision: 展示释放后的 Host 权威空白 Session 复用

Status: implemented

中文 | [English](2026-09-18-blank-session-reuse.en.md)

## Problem

插件展示释放后，New Session 可能选中旧的空白 dshbot Session。持久化的用户标题仍保持 pin 状态，仅读摘要会把这一行误判成普通草稿，即使其历史曾带有插件展示元数据。Workspace 与无工作目录导航还需要对冷日志、陈旧摘要和并发创建竞争采用同一决定。

## Decision

Host 提供只读 `session.blankReuse({ sessionId })` RPC，返回 `{ reusable: boolean }`；Client 暴露 `ISessions.canReuseBlank(sessionId, signal?)`。Host 在不激活 Agent 的前提下检查当前挂载的历史或持久化历史。缺失 Session 返回 `reusable: false`；其他读取失败与取消继续作为错误抛出。

`blank` 仍表示尚未开始任何 turn。历史包含任意 `session/title` 时，Session 不符合 New Session 复用条件；用户显式打开时旧 pin 保持不变。若当前或历史展示元数据非 null，或历史包含 `system/message`、`user/message`、`assistant/message`、`tool/result` 或 `turn/start`，Session 便不符合条件；seed、fork、继承和 subagent 身份同样不符合条件。普通模型、权限与 plan 配置仍可复用。

Workspace 与无工作目录导航都会先根据摘要排除明显不合格项，等待 Host 确认，在复用前重新检查当前成员关系和归档状态，并按目标合并完整的检查加创建操作。候选项陈旧或被拒绝时创建新的 Session。不激活 Agent，不修改 cache schema 或版本，也不重写旧日志或标题。

历史中非空的 `agent/inbox/spliced` 输入、`goal/change` 或 `schedule/change` 同样排除复用：它们可以在首个 turn 之前保存待处理工作。后来取消输入或清除目标不会把旧身份变成新草稿；空的 inbox 操作和普通配置不受影响。

## Alternatives considered

- **只在 Client 侧按摘要过滤** — rejected：陈旧摘要无法证明释放后的插件展示从未存在，也会让冷启动或并发导航绕过 Host 权威判断。
- **释放展示时清除或重新生成标题** — rejected：释放展示不能销毁用户明确设置的标题，也不能重写持久化历史。
- **允许已有标题 pin 参与复用** — rejected：标题 pin 表示用户已经明确了该 Session 的身份；New Session 不应重新占用它，但显式打开必须保留原 pin。

## Consequences

现在 Workspace 与无工作目录路径都遵循同一个 Host 决定来复用 New Session。不合格、消失或已改变的候选项会跳过并创建新的 Session；真实读取错误与取消则向上传递且不创建，以便重试。现有用户标题、日志、pin、普通草稿配置、成员数据与布局均得到保留。已通过 25 项 Host 边界测试、272 项 Workspace 测试与两条真实浏览器新建、首次发送及重载流程；冷启动 JSONL/zstd 与浏览器验证均确认旧日志不变。正式 Host/Client/Web 构建通过。
