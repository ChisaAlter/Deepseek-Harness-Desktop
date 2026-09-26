# Decision: 远程失效监听地址的人话错误与下拉标注

Status: implemented

中文 | [English](2026-09-25-remote-stale-bind-address.en.md)

## Problem

「监听范围」持久化单块网卡地址（`remoteBindAddress`）。网卡地址是易失的——WSL `vEthernet` 每次重建换子网、DHCP 换租、网卡停用。保存值过期后，任何远程保存都会触发 `listen(3180, <stale-ip>)` → `EADDRNOTAVAIL` 原始错误穿过 `shell:save-remote` IPC 直抛设置页（`Error invoking remote method …`），用户看不懂也无从恢复；弹窗侧 `humanizeRemoteError` 把这类错误归为「关闭后再开启重试」，而重试无解。

## Decision

- `ensureMobileWebServer` 把 `EADDRNOTAVAIL` 翻译为「监听地址 X 已失效…请在『监听范围』改选其他地址」，同批覆盖 `EACCES`（Windows 保留端口段），沿用 `EADDRINUSE` 的人话模式。配置不被改写；任何字段的保存都会重跑 sync，改选有效地址即恢复。
- 设置页把不在当前网卡扫描结果里的已存地址标注为「已失效」，失效选择在下拉里自解释。
- `humanizeRemoteError` 新增 `bindGone` 分类（匹配 `EADDRNOTAVAIL` 与人话文本），弹窗提示去设置页改选监听范围而不是无脑重试；`ipcErrorMessage` 剥掉 `Error invoking remote method` 包装。
- 抛出的消息保留 `（EADDRNOTAVAIL）` 代码，既是诊断线索也是弹窗分类的稳定锚点。

## Alternatives considered

- **失效自动回落 `0.0.0.0`** — rejected：用户选单网卡就是收窄监听面，静默改回通配会在用户不知情时把配对页暴露到所有接口（含不可信网络）。
- **失效自动回落 `127.0.0.1`** — rejected：方向安全但同样静默；配对页从此对手机不可达，用户只看到「配对坏了」。
- **归一化时把不在网卡列表的值重置为默认** — rejected：网卡可能只是暂时断开（Wi-Fi 关了再开），重置会把仍可恢复的显式选择永久抹掉。
- **过滤虚拟网卡出下拉** — rejected：`tailscale|wireguard` 类 overlay 网卡是合法的单接口选择（tailnet 内手机可达）；真实网卡 DHCP 换租同样过期，过滤只堵一半。
- **保存时校验地址在网卡列表中** — rejected：存量失效配置照样失败且仍需解释，校验只挡住新选择，收益与错误翻译重复。

## Consequences

失效监听地址从一行 raw `EADDRNOTAVAIL` 变成可执行的人话错误 + 下拉「已失效」标注；存量失效配置不再 wedge 整个远程保存（改选即恢复）。代价：错误分类新增一个 kind、两条 locale 键；`ipcErrorMessage` 成为该类错误的统一剥离点。安全语义不变——绝不静默扩大监听面，同时恢复可自助修复性。
