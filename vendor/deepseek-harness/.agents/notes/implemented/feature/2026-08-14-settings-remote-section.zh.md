# Agent Note: 远程配对放在设置旁边的手机控件上

Status: implemented

[English](2026-08-14-settings-remote-section.md) | 中文

## 问题

设置 → 远程那一页带着端口、局域网地址、原始配对链接和令牌轮换，把配对做成了技术配置。用户只需要打开远程、选局域网或服务器中继、扫二维码。把它埋在设置里，控件看起来没做完，也把手机真正要看的东西藏起来了。

## 决策

远程是 `@deepseek-ai/dsh-client-ui-settings-remote` 里受桌面门控的 `sidebar.footer.action`（`id: 'remote'`），画在设置齿轮旁边。触发器和标题文案是 **远程**。网关关闭时手机图标用次级文字色，开启后用主文字色。弹窗暴露一对 `ui-primitives` `Button` 的开启／关闭、一对 `Button` 的局域网／服务器中继（`size="sm"`：选中 `primary`，未选中 `ghost`）、配对二维码，以及带描边和 `IconChevronRightOutline14` 的 **已连接设备** 行；点该行打开设备管理。改模式先写入 `snap.mode`，不置弹窗级 busy，因此开启／关闭按钮保持可点。改模式只换配对二维码；远程开启时局域网网关和出站中继都保持运行，只有关闭远程才会停掉它们。端口、地址、复制、换令牌和中继地址编辑不在这一面。注册仍要求 `desktopShell()` 提供 `getRemote`／`saveRemote`／`rotateRemoteToken`／`unbindRemoteDevice`。配对 URL 把密钥放在 `#offer=`。扫码成功后给这台设备签发长期凭证，和二维码里的配对密钥分开；解绑后该设备失效。中继是桌面对 `normalizeRelayOrigin` 后 HTTPS origin 的出站连接。dsh 仍然绑定 `127.0.0.1`。web-app 补丁加载 `ui-settings-remote` 行。触发器带 `data-dsh-remote-trigger`。桌面主进程构造 `RemoteGateway`（[桌面组装手机 Remote 网关](2026-08-22-desktop-phone-remote.zh.md)）。

## 考虑过的替代

**保留完整的设置 → 远程页。** 否决：那一页把网关内部暴露给每一次配对。齿轮仍是产品设置；远程是配对动作。

**做在 Electron 铬架上。** 否决：官方侧栏已经拥有设置触发器；再做一个铬架按钮会重复配对窗的错误。

**把 `dsh web` 绑到 `0.0.0.0`，或重做原生聊天客户端。** 否决：Host 围栏没有鉴权，产品包装的是官方页。

## 后果

GUI 测试必须证明没有 `window.shell` 时不出现、关闭时触发器是暗的、开启时弹窗有二维码和已连接设备行、开启／关闭和局域网／中继都是 radio `Button`，以及解绑。改模式时开启／关闭按钮必须保持可点，并且不得启停局域网网关或中继。监听／令牌／中继／设备仍归主进程 IPC。标题栏和托盘不再打开远程设置节。
