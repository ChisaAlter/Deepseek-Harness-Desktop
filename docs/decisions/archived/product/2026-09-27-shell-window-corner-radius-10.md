# Decision: 壳层窗口剪影圆角统一收敛到 10px 圆形

Status: implemented

Archived: 2026-09-27

中文 | [English](2026-09-27-shell-window-corner-radius-10.en.md)

## Problem

启动器与桌面端两个透明窗的剪影外框合同是 20px——视觉上偏大偏泡，与 macOS 常规窗角（≈10px）差距明显，用户反馈「圆角总感觉怪怪的」。同时这个值散落持有：注入层 `harness-chrome-inject.js` 四处（body / `#dshd-frame-canvas` / `#dsh-wallpaper` / `#dshd-frame-ring`）、`boot.css` 两处（body / `.scene`）、`launcher.css` 的 `.shell`、确认弹窗 scrim、vendor `ui-layout` 的 `.frame` 与 `--dsh-windows-content-radius`——跨 4 个渲染上下文、9 处同值字面量，无单一合同点，后续必漂移。另有不一致：启动器 `.shell` 缘线用 `border-l1`（4% 黑），弱于桌面端 `#dshd-frame-ring` 的 `border-l2`（10% 黑），两窗边线强度不同。

收敛到 10px 后的真机/CDP 逐像素复核又暴露出第二层原因：harness 页带 `ui-theme/corner-shape.css` 的全局规则 `* { corner-shape: superellipse(1.5) }`，桌面端剪影各层（body / canvas / wallpaper / ring 与 `.frame`）实际按 squircle 渲染——该曲线把 10px 的窗角收成约一半视觉跨度的紧角，与启动器/弹窗（file:// 页、无此规则、天然 round）的圆角形状不一致，「怪」的来源同时是尺寸与角形。

## Decision

剪影半径 20→10（macOS Big Sur+ 常规窗角值），且 harness 页内剪影层显式 `corner-shape: round` 退出全局 squircle——窗角取正圆弧而非 UI 面板曲线；按「先文档后码」先改 design-language 外框合同，再同步全部剪影层：

- `harness-chrome-inject.js` 新增 `FRAME_RADIUS = 10` 常量，注入的四个剪影层统一引用，并各加 `corner-shape: round`；最大化归零规则不动。
- `boot.css` body 与 `.scene` 同步到 10px。
- `launcher.css` `.shell` 半径同步到 10px，缘线 token `border-l1`→`border-l2`，与桌面端发丝环同强。
- `update-dialog.css` scrim 跟随剪影到 10px（`dialog-scrim-silhouette-radius` 决策的同值合同延续）。
- vendor `ui-layout` `AppFrame.module.css` `.frame` 同步到 10px 并加 `corner-shape: round`（与 `.centerCol` 既有退出先例一致）、`--dsh-windows-content-radius` 同步到 10px（centerCol 左上角、ui-sidebar-right 全屏角经 var 自动跟随）；`lib/client.js` 编译产物同步替换；README 里残留的 16px 漂移值一并修正。
- 新增 `src/main/shell-silhouette-radius.test.js` 钉住各层同值、round 角形与最大化归零。

boot 页、launcher 页、弹窗子窗均为 file:// 渲染页、不引入 `corner-shape.css`，天然 round，无需退出声明。

## Alternatives considered

- **8px（Win11 原生值）** — rejected：用户点名对齐 mac 常规；8px 在 150% 缩放的高分屏下剪影存在感偏弱，读作近乎直角。
- **12px** — rejected：无 mac 常规依据，介于两平台惯例之间的折衷值没有锚点。
- **保留 squircle(1.5) 调大半径补视觉** — rejected：同值半径在不同渲染上下文画不同曲线，启动器与桌面端的窗角形永远错开；squircle 角区还带切向渐晕边缘，钉不住「外框视觉半径」这个合同。
- **用共享 CSS 变量统一** — rejected：boot 页、harness 页、launcher 页、弹窗子窗、vendor 模块分属不同渲染上下文，没有共同 DOM 作用域可承载变量；常量对齐加回归测试是唯一可行合同。

## Consequences

两窗剪影收敛到 mac 常规 10px 正圆弧，曲线与缘线强度一致；`--dsh-windows-content-radius` 的下游消费者（centerCol 内容角、右栏全屏角）经 var 自动跟随，不含隐患；剪影层的 round 退出只作用于窗角，页内 UI 面板继续走全局 squircle。代价：半径字面量仍按渲染上下文分散在五份文件里（结构约束），以 `shell-silhouette-radius.test.js` 兜底防漂移；`update-dialog.test.js` 的 scrim 断言随合同改为 10px。真机验证：CDP 逐像素确认 harness 页剪影角部从 squircle 紧角变为 10px 正圆弧，与启动器一致；最大化仍归零。
