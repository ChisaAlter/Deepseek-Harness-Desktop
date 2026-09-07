# @deepseek-ai/dsh-client-ui-agents-panel

[English](README.md) | 中文

右边栏 Agents occupant，挂在 `surfaces.agents`（`single`，`session-maybe`，由 ui-surfaces 声明）。从现有会话快照列出当前会话的子代理（先 `subagentsByParent`，再 `byId` 子行）。不生成、不派遣，也不新造内核。约定：[slot 系统标准](../../../.agents/notes/implemented/architecture/2026-07-22-slot-type-chain-implementation.md)。

目录和谱系都为空时显示空态。点击行打开子会话。`jobsBySession` 的后台任务列在名册下方；生命周期状态走文案表，`label` 与 `detail` 仍是生产者字符串。

`/client` 导出表层只包含插件主体（`apply`／`inject`）及约定类型；AgentsPanel 仍由 slot 注册封装在包内。

## 模型体验

无。Agents 面板只为展示读取会话快照；这里没有任何内容进入模型请求。

#### KV Cache 影响

无；该包（package）既不组装也不发送提供方请求。

## 已知限制与暂缓事项

- **没有工作流分组**：面板列出直接子代理，不折叠工作流批次。
- **任务只读**：面板列出 `jobsBySession`，不结束任务。

不发布运行时 invariant companion；本包不拥有独立的持久事件关系，UI 或服务行为由聚焦的包测试覆盖。
