# Agent Note: 新源客户端打开最近一条对话

Status: implemented

[English](2026-08-14-restore-latest-conversation-on-new-origin.md) | 中文

## 问题

当前会话 id 存在源限定的 `localStorage`（`dsh.sessions.current`）。手机经桌面网关进来是新源，恢复失败。`startInitialSelection` 于是去连接最近 Workspace 的空白会话。输入栏看起来是空的，Host 里桌面那些对话其实还在，只是藏在手机侧栏抽屉里。之后若源里仍把那条空白会话记为当前，会一直停在空输入栏。

## 决策

`WorkspaceRuntime.startInitialSelection` 仍然优先已记住的当前会话，但该行必须仍在、非空、未归档。已记住的空白、缺失或归档 id 不能赢。否则从列表基线打开最近更新的非空、未归档会话。一条都没有时，才连接最近 Workspace 的空白会话。New Session（`connectWorkspace`／`startSession`）不变。

## 考虑过的替代

**每个新源继续造空白会话。** 否决：手机远程连的是同一个 Host；用户要看已经有的对话，不是空输入栏。

**用配对 Cookie 共享 `dsh.sessions.current`。** 否决：选中哪条会话是浏览器本地的查看事实。Cookie 是每台手机的访问令牌；见 [paired-remote-devices](2026-08-14-paired-remote-devices.zh.md)。

## 后果

任何新源的第一次访问——手机、另一个浏览器、清过源——都会落到最近一条仍在的对话。之后若源里仍记着一次造出来的空白当前会话，同样改开最近一条有效对话。测试覆盖更新的空白行或归档行不能赢，以及已记住的空白当前会被替换。
