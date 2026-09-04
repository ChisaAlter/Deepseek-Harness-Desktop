# `@deepseek-ai/dsh-client-ui-settings-remote`

[English](README.md) | 中文

仅桌面端的 **远程** 面：

1. 侧栏底部手机控件（`sidebar.footer.action` id `remote`）——开启／关闭、配对二维码、已连接设备（支持行内重命名）。
2. 设置分区 id `remote`（`settings.remote.tab`）——**网关**（局域网／中继、端口、绑定、LAN TLS、中继 URL·令牌、轮换 pairing token）与 **消息渠道**（预置 `@xmanrui/dsh-im`）。

注册要求 Electron `window.shell` 提供 `getRemote`／`saveRemote`／`rotateRemoteToken`／`unbindRemoteDevice`／`renameRemoteDevice`。普通浏览器里的 `dsh web` 没有这些面。

详见桌面 Feature Card `remote-settings` 与 `mobile-remote`。
