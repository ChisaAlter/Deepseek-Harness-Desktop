# Agent Note: 消息编辑生产打磨——失败保留草稿、编辑中守卫、焦点交还

Status: implemented

[English](2026-08-25-message-edit-production-polish.md) | 中文

> 部分被取代：本记录打磨的气泡 textarea 已被 composer 编辑会话取代——见 [2026-08-25-message-edit-composer-edit-session](2026-08-25-message-edit-composer-edit-session.zh.md)。失败保留草稿、确认时刻的「最新且空闲」守卫、IME 安全的 Escape 与焦点交还 store 全部延续；textarea 专属的底盘（高度重排、`editor.field`、气泡内发送）已移除。

## 问题

[就地用户消息编辑器](2026-08-15-inline-user-message-edit.zh.md)的事务本身正确，但边缘粗糙。fork 失败会取消编辑器，把操作者敲好的修订直接丢掉。「空闲且最新」的前置条件只在铅笔处检查：编辑期间会话开始运行（排队消息被接纳、另一客户端提交）或有更新的用户消息到达时，「发送」仍然可用，确认会以静默丢弃较新轮次的切点创建分支。输入法的 Escape——本来只是收起候选列表——却丢弃整次编辑。取消后键盘焦点落在 `<body>` 上。textarea 的自适应高度在窗口或面板调整后失效，不可用的铅笔仍然渲染 hover 回显（与共享 IconActions 底盘不一致），编辑态气泡与静态气泡无法区分。

## 决策

五项行为，全部落在 `ui-message-edit` 内（`ui-conversation` 座位不变）：

**失败的重新发送让编辑器继续待命。** 拒绝仍在源 composer 上提示，但编辑器保持挂载、草稿完整、重新启用并把焦点还给输入框。重试就是再按一次发送；放弃仍只需一个 Escape。

**入口前置条件贯穿整个事务。** 编辑器通过会话钩子自选 `running` 与最新用户 seq；会话运行中或存在更新的用户消息时，「发送」被阻止，按钮旁的 `role="status"` 行（同时挂在输入框的 `aria-describedby` 上）说明原因（`editor.hint.running`／`editor.hint.stale`）。草稿永不被自动丢弃。

**Escape 对 IME 安全。** Enter 路径已有的组合守卫（`isComposing`／keyCode 229／组合窗口 ref）现在同样约束 Escape，收起输入法候选列表不再取消编辑。

**取消把焦点交还给铅笔。** 编辑器与铅笔不会同时存在于 DOM，因此握手经由共享的会话作用域 store（`createMessageEditStore`，一个 handle 传给两处注册）：取消时记录 `returnFocusSeq`，重新挂载的铅笔一次性消费并聚焦自身。铅笔不再渲染时（消息已不是最新）仍会清除请求，避免泄漏到后续无关的挂载。

**呈现一致性。** ResizeObserver 在宽度变化时重排 textarea 高度。不可用的铅笔获得与共享 IconActions 底盘相同的 hover 重置。编辑态气泡用 composer 输入边框 token（`--dsw-alias-border-l2-darkmode-thin`）画一圈内嵌描边（box-shadow，几何与静态气泡逐字节一致）。等待中的行带 `aria-busy`；按钮带 `aria-keyshortcuts`；textarea 标签使用专用的 `editor.field` 键。

## 曾考虑的替代方案

**失败时恢复气泡（原先的行为）。** 否决：修订是操作者的劳动成果，瞬时的 fork 失败不应销毁它；composer 自己的发送失败路径同样保留草稿。

**有更新的用户消息到达时自动取消编辑器。** 否决，理由相同——未经操作者同意就销毁草稿。带原因的阻止让他们可以复制文本或主动取消。

**允许从过期编辑器发送（`beforeSeq` 切点仍然合法）。** 否决：产品规则是仅限最新消息，且在较旧 seq 之前的切点会让子会话静默丢掉较新轮次——伪装成成功的数据丢失。

**通过 `user-actions` 座位的 `returnFocus` owner prop 交还焦点。** 否决：为单个贡献者的私有握手扩宽 ui-conversation 契约；slot 系统的 store 正是跨条目、跨重挂载交互状态的钦定通道。

**用窗口 `resize` 监听代替 ResizeObserver。** 否决：气泡宽度还会随面板拖拽变化，窗口事件看不到；ResizeObserver 也是仓库通行做法。

## 后果

fork 失败现在可以就地恢复；操作者可以重试、继续修改或取消。「仅限最新」不变量在确认时刻成立，而不只在入口。键盘与 IME 行为与 composer 一致。代价是插件多一个（两个条目共享的）store，每种语言多两个文案键。包测试钉住每条新路径：组合态 Escape、running/stale 守卫及其播报、失败后待命与重试、含过期请求清除的焦点交还、以及宽度重排观察器。
