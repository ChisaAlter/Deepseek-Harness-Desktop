# Agent Note: 就地编辑已发送的用户消息

Status: implemented

[English](2026-08-15-inline-user-message-edit.md) | 中文

> 部分被取代：下文描述的气泡内 textarea 编辑面已被 composer 编辑会话取代——见 [2026-08-25-message-edit-composer-edit-session](2026-08-25-message-edit-composer-edit-session.zh.md)。座位布局、不 fork 的铅笔与 `beforeSeq` fork 事务仍然成立。

## 问题

最新一条用户消息上的编辑铅笔一点击就 fork 子会话，并把原文塞进底部输入框。操作者并没有在自己指向的那条气泡上改字；侧栏在任何修订出现之前就已经多出一个子会话。

已定稿的 `user/message` 已经在会话日志和模型上下文里。Host 没有对该事件的原地改写，产品不能在同一会话里重写这条气泡。

## 决策

`ui-conversation` 在已定稿 user 节点上，于 `conversation.chat.user-actions` 旁边声明 `conversation.chat.user-editor`（single，session）。`UserMessageNodeView` 保存本地 `editing` 标志：动作条 owner 上的 `startEdit` 用编辑器占位替换静态气泡和 IconActions；`cancelEdit` 将其恢复。核心会话包仍不带编辑文案，也不实现 textarea。

`ui-message-edit` 占据这两个座位。铅笔只调用 `startEdit`，不 fork。编辑器是用户气泡几何里的 textarea，外加「取消／发送」（`Button` `sm` ghost / primary）。Escape 取消；Enter 发送；Shift+Enter 换行；三者均对 IME 安全。确认时执行 `sessions.fork({ beforeSeq, increaseTitle: true })`，解析子会话作用域，再 `sessions.open(childId)`，然后在子会话输入面上 `setDraft(text)` 和 `submit()`。fork 失败或子会话作用域缺失则留在源会话、在该 composer 上提示，并让编辑器带着草稿继续待命；编辑中途的状态守卫与焦点交还 store 由[生产打磨记录](2026-08-25-message-edit-production-polish.zh.md)定案。

日志不变：子会话切在被编辑轮次之前，模型不会两次看到旧提示词。[去掉无效编辑存根](../../archived/simplification/2026-07-31-drop-user-message-edit-stub.md) 对 `MessageIconActions` 仍然有效；控件只存在于该插件中。

## 曾考虑的替代方案

**保持一点击就 fork 并回填 composer。** 否决：操作者要求编辑已发送的气泡，而不是跳到新会话和底部输入框。

**在源日志里改写已定稿的 `user/message`。** 否决：没有 Host 操作能改写已消费的用户事件或已经用过它的轮次；发明这种操作是会话格式变更，不是 UI 插件。

**由插件替换整个 user 节点 renderer。** 否决：用户气泡拥有图片、引用芯片和 IconActions；插件若占据 `conversation.chat.node` 的 `user` 键就必须重写这一切。编辑器座位才是可叠加的替换。

**编辑期间用 `conversation.blocks` 禁用底部 composer。** 否决：该注册表每个会话只有一个阻断；编辑阻断会覆盖已有原因（模型路由、缺少工作区）。

## 后果

点击铅笔只是该 user 节点上的本地 React 状态。第一次 Host 写入发生在确认时的 `beforeSeq` fork。测试钉住：铅笔不 fork；编辑器回填拼接后的文本；取消恢复气泡；发送才是 fork／打开／回填／提交序列；失败的重新发送不 `open`，且编辑器带着草稿继续待命。message-actions 的 aria 预期输出把铅笔标为 `Edit`。历史用户消息、仍在运行的轮次、以及非文本内容都不会出现已启用的编辑器。
