# Decision: 启动器侧「停止桌面端」改为预确认不再弹窗

Status: implemented

中文 | [English](2026-09-27-launcher-stop-preconfirmed.en.md)

## Problem

slim 启动器点「停止桌面端」，桌面经 peer `stop-desktop` 跑 `coordinate('stop')`；检测到活跃远程连接后需要确认——但桌面侧窗口全部隐藏（应用驻托盘），`confirmTaskStop` 锚点落空退到原生 `dialog.showMessageBox`，弹出一个不属于任何产品窗口的原生框，观感与打扰感双差。用户判定：在启动器上点「停止」本身就是明确指令，任何二次确认都不该出现；且同类「显式动作被再确认」的弹窗已多次被否。

## Decision

`coordinate()` 新增 `preConfirmed: true` 选项：inspect→acquire→drain→复查→commit 的锁序照常运行，两道用户确认门（首查脏检查、锁内复查新工作）整体跳过。启动器发起的两条停止链——peer `onPeerStop`（slim 启动器）与 `launcher-service` `stopOp`（桌面自带启动器窗）——都改传 `preConfirmed`。附带修正 `confirmTaskStop` 锚点为首个**可见**窗口（原实现取主窗，主窗隐藏时即使启动器可见也退原生框）；窗口关闭/托盘/菜单的 quit 与 install/update 路径的确认语义不变。

## Alternatives considered

- **把确认路由回启动器窗内 `app-confirm`**（peer 往返携带检查清单，用户确认后再调 `confirmed`）— rejected：仍是给「用户刚点过的按钮」补一次确认；协议加双程往返只为多一次打扰，用户明确选择零确认。
- **仅在有可见窗时确认、无窗时跳过** — rejected：同一按钮按窗口状态行为不一，不可预期。
- **连 inspect/acquire 一并跳过** — rejected：锁与 drain 是 Host 接纳语义不是打扰；`preConfirmed` 只移除确认门。

## Consequences

点「停止桌面端」立刻进入协调提交，永远零弹窗；中断远程连接等活跃工作的提示整个消失（用户显式接受）。`preConfirmed` 是协调器 opt-in，后续同类「显式动作被二次确认」可复用；不得扩散到窗口关闭/托盘/菜单的 quit 与 install/update 路径——那些路径的确认仍是设计本意。**（2026-09-27 修订：install/update 链随后经全量清点确认同属二次确认，已扩入 `preConfirmed`，见 [update-install-preconfirmed](2026-09-27-update-install-preconfirmed.md)；quit/restart/reload 约束不变。）**
