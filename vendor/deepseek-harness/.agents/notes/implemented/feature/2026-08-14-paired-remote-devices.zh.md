# Agent Note: 扫码绑定长期手机

Status: implemented

[English](2026-08-14-paired-remote-devices.md) | 中文

## 问题

扫远程二维码只是用共享访问令牌换了一张会话 Cookie。手机是匿名新访客：关掉浏览器绑定就丢，桌面没有设备列表，也不能只撤销一台手机而不把二维码对所有人轮换掉。

## 决策

扫码成功后给这台设备签发独立凭证，由桌面壳保存在凭据文件的 `remoteDevices` 里。HttpOnly Cookie 带的是这台设备的令牌（一年 `Max-Age`），不是二维码里的配对密钥。同一浏览器再次打开会复用这次绑定。远程弹窗把 **已连接设备** 和已绑定数量画成带描边的一行。管理对话框列出名称和在线（仍开着的 WebSocket）、可选的 `detail`（从已存 user-agent 抽出，不是原始 UA），然后是短编号、绑定时间和最近访问，各占一行。Windows、Mac、Linux 显示为 **电脑**，`detail` 写系统、架构和浏览器；手机仍用 iPhone／iPad／Android。`publicDevices` 在有 UA 时按 UA 重算 `name`，带上 `shortId`（`id` 后四位）和解析得到的 `detail`；不返回 `token` 或 `userAgent`。没有 UA 的旧设备沿用已存名称且没有 `detail`。缺名称时回退为 **设备**。解绑删除该设备并断开它的套接字；二维码密钥仍可用于重新扫码。弹窗调用 `window.shell.unbindRemoteDevice`；签发和撤销归桌面网关。

## 考虑过的替代

**继续用一把共享令牌当长期 Cookie。** 否决：解绑一台手机就得轮换二维码，所有手机一起掉线。

**把每次扫码当成新源，靠打开最近一条对话当产品修复。** 否决：看不到对话是还没绑定的症状。配对才是长期关系；第一次打开选哪条会话是另一条运行时规则，见 [restore-latest-conversation-on-new-origin](2026-08-14-restore-latest-conversation-on-new-origin.zh.md)。

## 后果

已经持有设备 Cookie 的浏览器再扫一次会刷新这一行，而不是再造一台设备。轮换配对密钥不会解绑已有设备。测试覆盖登录签发、Cookie 复用、解绑后 401、数量／管理对话框，以及 `publicDevices` 的身份字段。
