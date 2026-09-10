# Agent Note: 移除 user 消息的编辑存根

Status: implemented
Archived: 2026-09-04

[English](2026-07-31-drop-user-message-edit-stub.md) | 中文

## 问题

user 气泡的 IconActions 行在复制和分支旁边还有一个编辑按钮，但其背后什么都没有：该控件没有点击处理、没有 client 侧变更，也没有 host 侧重新发送已编辑消息的操作。用户找到它时，看到的是一个产品无法兑现的可供性。

## 决策

`MessageIconActions` 只渲染时钟／复制／分支，其 `edit` prop 随按钮一并删除；`MessageItem` 不再传入该 prop。现在 user 气泡与 assistant chrome 只在时钟位置上不同。插件可以占据 `conversation.chat.user-actions` 和 `conversation.chat.user-editor` 把控件加回来；那条路径是[就地编辑，确认时 fork](../feature/2026-08-15-inline-user-message-edit.md)，不是对日志的原地改写。

公共 locale 保留通用的 `edit` 词条：它是共享词汇，而非本组件的文案。

## 曾考虑的替代方案

**把按钮置灰并加提示。** 一个可见但无效的控件仍在宣告可以编辑，解释成本相同；直接移除才是诚实的状态。

**接到队列编辑器上。** 队列编辑的是尚未发送的消息。已定稿的 user 消息已经进入 transcript（文本记录）和模型上下文，复用该编辑器会让同一个动作悄悄变成另一件事。

## 后果

Web 核心 chrome 仍然没有编辑按钮。已落地的重新引入是一个插件：就地编辑气泡，确认时在该消息之前 fork，因为 Host 仍然没有对已定稿用户事件的改写。
