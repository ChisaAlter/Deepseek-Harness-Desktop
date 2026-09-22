# Agent Note：中继配对设备名与可重命名设备标签

Status: implemented

[English](2026-09-04-relay-pairing-device-name-and-rename.md) | 中文

## Problem

桌面「设备管理」列表里每一行都显示 "relay-pair"。配对 offer 恒走中继传输，守护进程看不到设备的 WebSocket 握手、拿不到 User-Agent；中继设备认证证明只携带密码学材料。签发设备时 `websocket-server.ts` 写死常量标签 `relay-pair`，桌面壳把 `device.label || device.deviceId` 映射为显示名，而凭据存储没有改名路径——同名无法由用户修复，只剩 4 位十六进制 shortId 后缀可区分。

## Decision

**客户端在配对时自报名称，桌面负责改名。** `WSHelloMessageSchema.relayDeviceAuth` 增加可选 `deviceName`（trim 后 1–120 字符，append-only——旧守护进程忽略它）；客户端库把它放进首次配对载荷；守护进程将其存为设备标签，`relay-pair` 仅作旧客户端兜底。手机配对页从 `navigator.userAgent` 派生名称（`iPhone · iOS 18.2`、`Android 15 · Pixel 8`、`电脑`，兜底 `设备`），与桌面 `remote-devices.js` 的命名合同一致。

本包侧：`DesktopShell` 增 `renameRemoteDevice(id, name)`，`hasRemoteApi` 与 `unbindRemoteDevice` 一并要求它；侧栏弹层经 `RemoteSectionInjected` 注入；设备管理行增加行内重命名编辑器（输入框预填当前名称，`maxLength` 120，保存／取消）。提交走新的 `shell:rename-remote-device` IPC，落到 `RelayDeviceCredentialStore.renameDevice`——文件落盘、幂等、封顶 120、拒绝已吊销设备。两条标签写入路径（签发与改名）归一到同一 1–120 预算，因为 `DeviceRecordSchema` 在加载时封顶 `label`，超长持久化标签会让整个存储文件加载失败。

## Alternatives considered

**服务端解析设备 User-Agent。** 否决：配对恒走中继传输（`attachExternalSocket` 不携带设备请求），守护进程收不到可解析的设备 User-Agent。

**只提供改名、配对不自报名。** 否决：每次新配对仍显示 `relay-pair`，用户还得逐台手改。

**把名称并入 HMAC 证明抄本。** 否决：抄本绑定信道材料（`deviceId`、challenge、密钥）；纯展示数据不得进入密码学抄本。

**把改名放进设置 → 远程分区而非设备对话框。** 否决：设备列表只存在于弹层的设备管理对话框；`GatewaySettingsTab` 不渲染设备行。

## Consequences

新配对显示真实设备名；存量 `relay-pair` 行保留原标签，由用户手动改名——改名即迁移路径。缺 `renameRemoteDevice` 的 preload 现在过不了 `hasRemoteApi`，混装构建会隐藏远程面；桌面 preload 与 UI 同仓同发，只有错配的桌面才会察觉。部署备注（因影响验证而记录）：客户端 bundle 以 `Cache-Control: immutable` 服务且 URL 不随内容变化——重建后的 UI 只有在清空 Electron `Cache` / `Code Cache` 目录并重启应用后才会到达渲染进程；已配对的手机无需重新配对，其存储标签保留至手动改名。

## Testing

`NODE_ENV=test pnpm exec vitest run packages/client/ui-settings-remote --testTimeout=30000` → 5 文件 / 44 测试全绿。新用例：行内编辑器预填打开且取消不调用；提交调用 `renameRemoteDevice('dev-1', 'Pixel 8')`、关闭编辑器并渲染新名；抛错的改名浮出 `statusErrorGeneric`；`hasRemoteApi` 拒绝缺 `renameRemoteDevice` 的 preload；注入面接通新回调。跨仓：chisacode store spec 钉死 120 封顶与改名语义（幂等、空标签无操作、拒绝已吊销/不存在、文件重开可见）；客户端库 spec 钉死配对 hello 上的 `deviceName`；手机配对 spec 钉死 UA 派生名与 `pairFromOfferUrl` 载荷；桌面壳 spec 钉死 IPC 透传与 preload 的按旗暴露。
