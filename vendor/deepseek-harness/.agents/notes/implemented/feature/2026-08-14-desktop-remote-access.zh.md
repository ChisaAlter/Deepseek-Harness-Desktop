# Agent Note: 桌面端远程访问配对

Status: implemented

[English](2026-08-14-desktop-remote-access.md) | 中文

## 问题

桌面壳把 `dsh web` 绑在 `127.0.0.1`，CLI 也拒绝 `--host 0.0.0.0`，因为 `/api` 没有认证。用户仍然需要在离开座位时用手机或另一个浏览器继续会话。

## 决策

Electron 主进程持有一条出站中继 sidecar。`dsh web` 继续只听回环。已配对客户端经产品托管的 WebSocket 中继到达 sidecar；sidecar 解开 E2EE 通道，用一次性配对令牌或回访设备 HMAC 认证，并把办公 RPC 白名单代理到 `http://127.0.0.1:<port>/api`。特权方法（`settings.*`、`credentials.*`、`host.pickDirectory` 以及其余仅回环集合）在 sidecar 返回 403，到不了 Harness。

`ui-settings-general` 仅在 `window.shell` 暴露 `getRemoteAccess`、`setRemoteEnabled` 和 `revokeRemoteDevice` 时注册 id 为 `remote-access` 的通用行。该行开关 `remoteAccessEnabled`、展示配对二维码 / fragment URL，并撤销设备。普通浏览器看不到这一行。

## 考虑过的替代

**把 `dsh web` 绑到 `0.0.0.0`，手机直接打开现有 SPA。** 否决：这等于把远程代码执行开到局域网，CLI 已经拦住。

**把偏好写进 Host `settings.yaml`。** 否决：中继生命周期和设备密钥属于 Electron userData，远程浏览器不得签发配对令牌。

## 后果

打开该行即可启动 sidecar，不必重启 Harness。配对 URL 把 offer 放在 fragment。Web 客户端只把设备密钥放在会话内存；Android 使用系统密钥库。3080 端口从不离开回环。

## 测试

`ui-settings-general` 客户端规格只在远程访问 shell 方法存在时注册该行，并驱动开启 / 复制 / 撤销。桌面 `npm test` 覆盖 offer 编码、E2EE、中继认证重放、RPC 白名单，以及经 loopback 中继代理 `session.list` 同时拒绝 `settings.describe` 的回声。
