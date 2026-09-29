# Decision: Windows 壳窗恢复原生合成与动画门禁

Status: implemented

中文 | [English](2026-09-29-native-window-motion.en.md)

> 用户否决了不透明窗口/系统小圆角取舍；该部分由[圆角与动画同时保留](2026-09-29-rounded-window-motion.md)取代，HWND/IPC 门禁保留。前次验收只证明动画，漏掉了既定外框圆角的退化。

## Problem

最大化、最小化动画反复消失。Git 记录显示 9 月 15 日的暂存 `3d22cd024d9` 已注明透明改造破坏 DWM 动画；9 月 23 日同步前保存本地改动的 `abe95b0dac3` 再次给主窗口与启动器引入 `transparent: true`。不是上游删除动画实现。旧门禁检查页面圆角和几何状态，未检查原生窗口样式；旧决策又要求保留透明剪影，使回归容易被当成正确设计。

本机 Electron 实测中，修复前系统动画开启，但两个壳窗缺少 `WS_CAPTION` / `WS_THICKFRAME`；原生最大化状态测试仍可能通过，证明只测尺寸或 `isMaximized()` 不足。`node scripts/run-window-motion-qa.mjs` 新增 HWND 样式检查后在旧实现报错，改用不透明窗口后通过。

既有决策审计：[窗控自愈](2026-09-25-window-chrome-self-heal.md)、[剪影缘线](2026-09-25-window-silhouette-edge-ring.md)、[OS 圆角遮罩](2026-09-27-transparent-window-os-corner-mask.md)和 [20px 圆角](../product/2026-09-27-shell-window-corner-radius-20.md)均部分重叠。本篇取代其中 Windows 主窗口和启动器必须透明、自绘外轮廓的部分；注入自愈、非 Windows 剪影、内部内容圆角及透明覆盖层的决定保留。没有完全被取代的记录。

## Decision

- `shellWindowChrome` 集中持有主窗口/启动器策略：Windows `transparent: false`、`thickFrame: true`、`roundedCorners: true`，透明宠物和覆盖层继续使用原有 `windowChrome`。构造参数不能覆盖该策略；测试同时检查最终工厂参数，避免调用方在策略之后重新覆盖。
- Windows 外缘和过渡交给系统，尊重系统动画开关；IPC 窗口状态携带 `nativeFrame`，boot、launcher 和注入的 Harness 外层据此移除第二层圆角裁切/描边。内部内容角、壁纸和透明主题不变。原生窗不使用几何最大化判定，旧几何回退只用于登记过的透明窗。
- 新增 `window-motion` feature 卡与 always-on rule，根 AGENTS、设计语言、motion、手册、QA 和 Harness 同步卡共同指向同一契约。旧记录明确标注 Windows 部分已被取代。
- 单测保护策略、两个真实创建函数的最终参数与外缘 CSS；Windows CI 运行独立 Electron 实测，使用真实工厂、预加载和授权 IPC，读取 HWND 样式并检查最大化/还原、最小化/恢复及正常尺寸。测试使用独立临时 profile，不启动 Harness、不改用户数据或系统偏好。可见插值另走交互桌面逐帧验收，不能用 CI 状态通过冒充。

## Alternatives considered

- 保留透明窗，仅补 `thickFrame: true`：透明模式本身改变原生窗口样式，单个选项不足以保证系统动画；拒绝继续将外框 20px 优先于原生行为。
- JavaScript 插值 `setBounds` 或缩放页面：看似能补动画，但任务栏恢复、系统快捷操作与辅助功能设置难以一致，且缩放内容不等于窗口合成；拒绝另造动画实现。
- 只补文档或只测最大化状态：成本低，但旧实现已能通过状态测试，无法拦住本次故障；采用参数、HWND 样式、真实 IPC 和可见过渡分层验证。

## Consequences

Windows 壳窗恢复系统动画所需的原生样式、状态和恢复路径；外框使用当前 Windows 版本的系统圆角，不能继续承诺固定 20px。非 Windows 保留旧剪影，桌宠透明性不变。测试在关闭系统动画或无交互桌面的 CI 上只认证结构与状态，不强制打开系统动画；可见过渡必须在交互桌面验证。验证结果记录在 [window-motion 卡](../../../features/window-motion.md)及其 QA 来源。
