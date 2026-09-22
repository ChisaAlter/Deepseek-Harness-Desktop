# Agent Note: 桌面组装手机 Remote 网关

Status: implemented

[English](2026-08-22-desktop-phone-remote.md) | 中文

## 问题

`mobile/web` 下的手机 Web SPA 能通过 `#offer=` 配对并走 Host unary 与 WebSocket，但桌面进程把 `createDisabledRemote()` 传给 HarnessController，并在 web-app 补丁里注释掉 `ui-settings-remote`。用户打不开配对二维码，也到不了这套 SPA。

## 决策

`src/main/index.js` 用 `getConfig` / `saveConfig` / `getTarget` 构造 `RemoteGateway`。仅当 `dsh.state === 'ready'` 时 `getTarget` 返回 `{ host: '127.0.0.1', port: dsh.port }`。`RemoteGateway.snapshot()` 设置 `available: true`。默认 `remoteEnabled` 仍为 false，用户打开远程之前进程不监听。Harness preload 暴露 `getRemote`、`saveRemote`、`rotateRemoteToken` 和 `unbindRemoteDevice`。`packages/bundle/web-app/cordis.patch.yml` 加载 `@deepseek-ai/dsh-client-ui-settings-remote`。触发器带 `data-dsh-remote-trigger`。认证后的 HTML 仍来自 `mobile/web`；`/api/*` 与 WebSocket 升级仍反代 loopback Host。中继 origin 仍只在 `normalizeRelayOrigin`（HTTPS）之后通过。`createDisabledRemote` 仍是测试辅助，不是生产 remote 对象。

## 考虑过的替代

**等到 Android 原生再取消 stub。** 否决：Web SPA 就是 v1 客户端；藏起二维码会挡住已交付的配对路径。

**只要 `REMOTE_FEATURE_ENABLED` 为 true 就监听，忽略 `remoteEnabled`。** 否决：产品默认关闭；静默占用 3180 不是配对。

**在 3180 上送官方四栏 `dsh web`。** 否决：手机设计是 `mobile/web` 下的独立 SPA。

## 后果

发版 UI 走查在默认配置（`remoteEnabled: false`）上要求 `remote.available` 与 `remote.notListening`。Composer 官方 QA 把 `remoteEnabled: true` 写进磁盘，并要求 `case.remote.available` 与 `case.remote.listening`。`assertDesktopForks` 要求组合 id `ui-settings-remote`。手机远程的产品契约在桌面 Feature Spine 卡 `mobile-remote`。

## 相关

[远程配对放在设置旁边的手机控件上](2026-08-14-settings-remote-section.zh.md)。[桌面输入框草稿查找与官方触发器](../bug-fix/2026-08-21-desktop-composer-draft-and-official-triggers.zh.md)。
