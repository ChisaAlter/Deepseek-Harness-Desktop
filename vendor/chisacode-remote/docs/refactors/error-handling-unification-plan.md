# 错误提示机制统一设计

> 状态：**执行中**（2026-07-15 启动代码收口）。
>
> 目标：让用户可感知的失败都经过同一套“保留诊断日志、规范化消息、按交互边界展示”的入口，同时保留阻塞式确认和 inline 错误的适用场景。

## 当前代码真值

旧草案已经部分被后续改动超越：

- Toast 已完成队列化，最多同时显示 3 条，溢出项进入等待队列。
- 非测试 App 代码中的 `Alert.alert` 已从 35 处降到 9 处；剩余项主要是删除确认、权限申请或配对失败等需要立即处理的场景。
- Desktop IPC 已有局部的日志 + Toast helper，但此前只服务 desktop hooks。
- 普通 App 页面仍大量手写 `console.error(...)` 与 `toast.error(...)`，并存在只记日志、不提示用户的生产路径。

## 展示边界

| 场景                             | 机制                                     | 约束                       |
| -------------------------------- | ---------------------------------------- | -------------------------- |
| 保存、复制、切换等非阻塞操作结果 | Toast                                    | 失败必须保留原始错误日志   |
| 删除、重置、重启等破坏性操作     | `confirmDialog` 或带按钮的 `Alert.alert` | 必须由用户明确确认         |
| 连接失败、配置冲突等持续阻塞状态 | inline `<Alert>`                         | 状态解除前持续可见         |
| 需要用户立即修正或授权           | 带按钮的 `Alert.alert`                   | 只在确实需要动作时使用     |
| 不应发生的内部状态               | `console.error` + ErrorBoundary          | 不重复弹出无行动价值的消息 |

## 统一入口

`packages/app/src/utils/user-visible-error.ts` 提供纯错误报告 authority，`packages/app/src/hooks/use-user-visible-error.ts` 只负责绑定当前 Toast 上下文：

- 始终把原始 `unknown` 错误和稳定标签写入日志。
- 优先展示调用方提供的本地化消息；未提供时使用 `toErrorMessage` 归一化。
- 支持异步操作在组件卸载后只记日志、不再触发 Toast。
- Desktop IPC helper 委托给该入口，避免形成第二套实现。

## 已完成切片

### Slice A：Toast 队列

- 状态：已完成。
- 代码：`toast-host.tsx`、`toast-queue.ts`。
- 结果：可见项和等待项分离，现有 `ToastApi` 保持兼容。

### Slice B1：Host 设置错误收口

- 状态：本批次完成。
- 范围：删除连接、重启 daemon、保存附加系统提示词、删除主机。
- 修复：保存附加系统提示词失败不再只写控制台，用户会收到本地化错误 Toast。
- 复用：Desktop IPC 错误路径已切换到通用入口，既有调用方 API 不变。

### Slice B2：Skills / MCP 设置错误收口

- 状态：本批次完成。
- 范围：Skills 的加载、策略保存、安装、卸载，以及 MCP 的加载、策略保存、删除、表单保存。
- 结果：8 条失败路径统一记录稳定日志标签，并优先展示真实 daemon 错误。
- 兜底：错误为空、`null` 或不透明对象时使用现有中英文 `load/save/install/uninstall/deleteFailed` 文案。
- 保持：卸载技能和删除 MCP 服务器的阻塞式确认逻辑不变。

### Slice B3：模型与 Provider 设置错误边界

- 状态：本批次完成。
- 操作 Toast：自定义模型保存/删除、Provider 开关与安装/更新/重装、自定义 Provider 列表测试/删除、合成模型保存/删除。
- Inline：自定义 Provider 的模型校验、模型测试、表单保存，以及 MoA 测试结果错误。
- 后台刷新：保存成功后的 Provider snapshot 刷新失败继续只记 warning，避免把已成功的保存误报为失败。
- 产品修复：Provider tooling action 的 RPC rejection 与 `success: false` 命令失败均不再静默吞错；自定义 Provider 列表测试失败不再产生未处理 rejection。
- 架构：纯错误 authority 支持注入 presenter，Toast、表单错误区和测试结果区共用日志与消息归一化。

### Slice C1：归档与权限交互恢复

- 状态：本批次完成。
- 用户反馈：解归档失败不再只写控制台；权限响应失败通过统一 authority 记录原始错误并展示中英文本地化 fallback。
- 交互恢复：权限响应失败会清空当前 action 的处理中状态，按钮恢复可重试；解归档失败同样恢复按钮。
- 代码质量：删除 `SessionContext` 中 9 个从未接线的 legacy 操作回调、1 个闲置 timeout ref，以及只服务死路径的 refetch helper，减少 150 余行不可达代码。
- 边界：后台 timeline、hydration、缓存和音频诊断日志保持原有分层，不机械改成 Toast。

## 后续切片

1. **Slice C2：生产路径分层续批**：继续追踪剩余真实用户操作失败或连接中断；内部诊断日志继续保留。
2. **Slice D：查询错误去重**：将 desktop 已有的同一 Error 实例去重能力推广到需要自动查询提示的跨平台页面。

## 不做项

- 不删除 `Alert.alert`、`confirmDialog`、inline `<Alert>` 或 `console.error`。
- 不把所有错误都强制改成 Toast。
- 不引入第三方 Toast 库。
- 不在一次提交中迁移整个 App。
