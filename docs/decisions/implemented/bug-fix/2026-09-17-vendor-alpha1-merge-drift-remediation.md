# Decision: dsh-v0.1.6-alpha.1 合并漂移按「上游契约优先、桌面特性保真」裁定

Status: implemented

中文 | [English](2026-09-17-vendor-alpha1-merge-drift-remediation.en.md)

## Problem

alpha.1 合入后 vendor GUI 套件 16 处失败——这批 spec 自合入起未在 CI 跑过，失败混着三种性质：上游已改契约而本地实现滞后、桌面有意特性把 spec 的旧断言顶破、以及真正的代码缺陷。逐处拍脑袋会把真回归和上游演进混为一谈，需要一条统一裁定规则。

## Decision

按「上游契约优先、桌面特性保真」裁定每一处失败：上游已改的契约跟上游，桌面有意引入的特性保留实现并改 spec 到等价断言，真缺陷修真缺陷。

- 持久键 `dsh.workspace.view` 回到上游 `v5`（丢弃桌面遗留 `v6`，接受一次性视图偏好重置）；`WorkspaceBrowser` 手动排序换回上游 summary 感知的 `reconcileManualOrder(…, list.byId)`，恢复到达序与迟来空会话语义。
- 界面设置连接区文案回到上游（`连接异常，刷新重试` / `重新连接中`）——package README.zh 本就记录该文案，本地串是 rc.1 合并残留，不是有意定制。
- 桌面自有特性保留实现：FlipText 翻牌标签（spec 改为断言剥离 `aria-hidden` 后的可访问文本，等价于原断言）、composer pick 持有到投影落地（spec 改为模拟投影帧到达后再断言 enabled）、managed presentation 会话、`dshbot-room` 隐藏、`custom-instructions` 设置行；上游 `+` 启动器合并了旧「指令」「添加附件」两颗 chip，相关断言改到现行文案 `添加文件或调用指令`。
- 真缺陷修复：`ConversationContent` 的 `heroWorkspaceRow` 提前构造会无条件触发 `conversation.hero.workspace` slot（JSX 子表达式在构造时即求值），presentation-owned 会话不应实例化工作区选择器——改为 `hero` 门控构造；`TerminalCleanup .stack` 补 `-webkit-app-region: no-drag`（fixed 交互层规则缺口）；pdf-license spec 在 Windows 用相对文件名解 tar（bsdtar 把 `C:` 前缀当远端主机）。

核心契约套件随后暴露同一批合并漂移的第二波，沿用同一裁定规则：

- `unarchiveSession` 的未知 id 拒绝是桌面有意契约（`WorkspaceUnknownSessionError` 的 `operation` 形参与 spec 同批引入，上游 rc.1/rc.2 尚无该 API）；alpha.1 上游以幂等无操作语义另写同名 API，合并整段取回上游实现并把拒绝语义吞掉，留下自相矛盾的 spec（`never-archived` 既要求 resolve 又要求 `ghost` reject）。裁定保桌面契约：恢复「不在归档集且不可知 → 拒绝且不写」，上游带来的幂等用例改以已知未归档 id 断言。归档删除与幽灵修剪路径只 unarchive 已在归档集内的 id，不受恢复影响。
- `agent.ts` 的 durable-question 恢复交接被合并破坏：alpha.1 把 `setupAndPublish` 包进 `runMaintenance`，桌面 `resumePendingInteraction` 仍按旧前提在维护窗内索取 running 相位，而 `runMaintenance` 的 finally 无条件复位 idle 会吞掉新装相位。修复让 `resumePendingInteraction` 接受 maintenance 相位并交接相位所有权——维护窗只在仍持有相位时复位 idle 与重放 latch 的 wake；恢复驱动自身的 drain 循环接管 inbox，唤醒不丢。
- `delete-archived.host.spec` 夹具过期：alpha.1 的 `agents.register()` 变成 async-generator effect，`enter` 落到微任务之后；桌面夹具同步调用后立即读 `agents.get` 必空。改为 await 注册（与同包其余 spec 一致）。
- `malformed-tool-call-retry` 期望预言过期：alpha.1 把 `tool-ralph` 改为 dsh-base 默认禁用（opt-in），该桌面场景在默认组合下录制的 `tool-schemas.expected.json` 与 `system-prompt.expected.md` 仍含 ralph；`ralph-loop` 场景自有组合并已按新契约显式 `disabled: false`。用 `DSH_SNAPSHOT=refresh` 重录期望（authored session JSONL 本身不含 ralph，不动）。
- `cordis-client-runner` 的 `slot-catalog.ts` 为生成物，合并后未重生成——执行 `gen-client-catalog` 对齐（行号、`SteeringMessageNodeView` 占位名与新 slot 项）。

## Alternatives considered

- **全部退回上游实现** — rejected：FlipText、pick-hold、managed presentation 等是桌面有意特性，退回等于撤销已验收的产品行为。
- **放宽断言到 `toContain` 或删除** — rejected：削弱断言会掩盖同类的下一次真回归；可访问文本断言与原契约等价，不损失强度。
- **保留 `v6` 持久键** — rejected：与上游键名永久分叉，且上游对该键的 schema 语义已重构（去掉时间戳账本）；继续用 `v6` 只会把分歧带进下一次合并。

## Consequences

一次性代价：存量用户的工作区视图偏好（排序方式与手动排序）重置为默认，不丢数据。spec 更新绑定桌面特性的现行契约——FlipText 动画期内旧文案以 `aria-hidden` 挂载、pick 持有到投影帧、`conversation.hero.workspace` 不再为 presentation-owned 会话实例化。第二波修复恢复未知 unarchive id 拒绝（`cannot unarchive session '<id>'`，语义同 archive 对称）并把 durable-question 恢复从「相位冲突」修回「维护窗内原子交接」；默认组合的请求头不再包含 ralph（上游 opt-in 语义）。vendor GUI 套件 7252 项与核心契约套件 4729 项回到全绿，snapshot/catalog/notices 门禁通过，`test.yml` 门禁解锁，release 候选构建可以继续。
