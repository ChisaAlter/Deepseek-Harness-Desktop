# Decision: 首次收进托盘改一次性 toast，关窗路径不弹框

Status: implemented

中文 | [English](2026-09-27-tray-close-once-toast.en.md)

## Problem

`closeToTray` 本来就由设置控制（桌面「设置 → 通用 → 关闭窗口时」、启动器「关闭时最小化到托盘」），但上游移植来的 `TrayHideNotice` 用原生 `dialog.showMessageBox` 做首次关窗教学，既丑又打断关窗。曾换成壳层双选弹窗（最小化到托盘 / 直接退出、选择即持久化），结果选「直接退出」会立刻接任务保护确认——**一个关闭动作两个弹窗**，比原生框更打扰。关窗这条路径根本不该出现按钮式提示：设置已经表达了用户偏好，提示只需做到「让你知道窗口去了哪」。

## Decision

`TrayHideNotice` 收敛为「首次隐藏一次性 toast」：

- 关窗立即隐藏，不等待任何交互；
- 仅首次隐藏发一条系统 `Notification`（窗口去了托盘 + 设置入口「通用 → 关闭窗口时」），写 `userData/tray-hide-acknowledged` marker 后不再出现；
- toast 发送失败不阻塞隐藏、不影响 marker；
- 退出分支保持任务保护协调——仅在存在运行中/定时任务时才确认，与关闭行为解耦。

形态与 slim 启动器的 `trayHintShown` 通知一致，复用同一类「一次性被动告知」而不是引入新的交互面。

## Alternatives considered

- **壳层双选弹窗（选择即改设置）** — rejected：已落地又回退——「直接退出」后每次关窗都会接任务保护确认形成双重提示；且把一次性提示做成设置问卷属于过度设计。
- **壳层单按钮教学框（换皮的「知道了」）** — rejected：仍需用户多点一次才能藏窗；提示信息量一条 toast 足够承载。
- **首次隐藏也完全静默** — rejected：不知情用户会以为应用已退出；零交互的一次性 toast 是更轻的告知方式。

## Consequences

`TrayHideNotice` 不再持有 `show`/`focus`/pending 状态，只剩 marker + notify；关窗路径不存在任何按钮式提示，原生 messagebox 彻底退出此路径。任务保护确认只在有真实工作时出现，频率与关闭行为无关。老用户的已读 marker 继续有效。Windows 无通知支持时静默隐藏（行为等价于老用户）。
