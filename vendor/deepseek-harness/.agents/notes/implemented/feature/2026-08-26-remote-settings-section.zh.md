# Agent Note: 设置 → 远程承载网关高级项与 IM 渠道

Status: implemented

[English](2026-08-26-remote-settings-section.md) | 中文

## 问题

手机配对应留在设置旁的快捷开关 + 二维码动作里，但网关高级项（端口、绑定、TLS、中继 URL·令牌、轮换 pairing token）与成熟 IM 机器人（经社区 `@xmanrui/dsh-im` 的 QQ / 飞书 / 微信）需要稳定的设置落点，既不能把二维码埋进设置，也不能自研第二套 IM 协议。

## 决策

桌面 `ui-settings-remote` 继续用侧栏 footer Remote 弹窗管开启／二维码／设备，并额外注册设置分区 id `remote`，子列表 slot 为 `settings.remote.tab`。标签 `gateway`（order 0）拥有高级 RemoteGateway 字段（含局域网／中继），走既有 `window.shell` Remote IPC。标签 `channels`（order 10）是桌面一等公民 `@xmanrui/dsh-im`（`vendor/dsh-im`，由 `dsh-im-desktop.js` 以包名 cordis + node_modules junction 接入；缺依赖挡启动）；不再单独注册 `settings.section`「IM机器人」。

## 考虑过的方案

**全部放在侧栏弹窗。** 否决：端口、中继密钥与多渠道 IM UI 会压垮配对面。

**只从市场安装 dsh-im 并深链。** v1 否决：产品要求直接集成成熟插件；桌面预置对齐用量统计。

**裁剪 dsh-im 只留 QQ／飞书／微信。** 否决：维护成本；上游九渠道 UI 已包含这三者。

## 后果

GUI 测试覆盖设置 → 远程注册与网关保存；预置测试覆盖拷贝／junction／禁用。升 pin 必须按 `vendor/dsh-im/DESKTOP-FORK.md` 重放 `settings.remote.tab` 改挂。部分收回 [Remote pairing lives on a phone control beside Settings](2026-08-14-settings-remote-section.zh.md) 中「不要 Settings → Remote 页」的立场：配对仍在手机控件；设置只放高级网关与 IM。
