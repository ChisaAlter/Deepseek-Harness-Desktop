# Decision: 退休退场帧失活与跨层 modal 焦点交接

Status: implemented

中文 | [English](2026-09-28-modal-focus-and-retained-exit-deactivation.en.md)

## Problem

两组相互关联的焦点/可达性缺口，都在 presence 退场（retained exit）路径上：

- 保留退场帧的弹层（`Menu`、`MenuView`、`HoverCard`、`DisclosureRow`、`Tooltip`）在逻辑关闭后仍留在 DOM 播退场 recipe，但没有 `aria-hidden`/`inert` 标记——屏幕阅读器与键盘遍历仍把它们当作可交互内容，焦点会停进一个正在消失的容器里。
- `useModalLayer` 只记直接 opener：嵌套弹层（父→子）一次提交里同时退休时，子层退役先跑，记录的 opener 落在随后也要退休的父层里，焦点被带进已隐藏父层而外部真实 opener 丢失。
- 焦点恢复只看 opener 本身是否连接，没看 opener 是否藏在 `hidden`/`aria-hidden`/`inert` 容器里；`shortcuts`、`ui-dockkit` 各自用 `modalSelector` 数 foreground 层，重复且不一致。

## Decision

- 所有 presence 保留的退场帧统一挂 `aria-hidden` + `inert`（`inertWhen` helper），逻辑关闭即退出 a11y 树与 Tab 序，退场 recipe 照常播完——可感知动效不变，交互面立即收缩。
- `useModalLayer` 加 `outerOpener` 跨层交接：下层退役时若不是顶层，把记录的外部 opener 交给上层层位，顶层退役恢复焦点时优先采用最近一个仍合格的祖先目标，焦点不再被拖进已隐藏父层。
- 焦点合格判定升级为“连接且不在 `[aria-hidden="true"]/[inert]/[hidden]` 容器内”；新增 `foregroundModalSurfaces(document)` 导出统一 foreground 层查询，`shortcuts`/`ui-dockkit/TabMenu` 不再各自拼 `modalSelector`。

## Alternatives considered

- **退场帧用 CSS `visibility` 隐藏** — rejected：只挡绘制不挡交互语义，a11y 树与焦点遍历仍可达；`inert` 才是交互失活的正确语义。
- **焦点恢复退回 `document.body`** — rejected：用户会从弹层工作上下文掉到页面顶，比落在隐藏父层更糟；`outerOpener` 保留了“回到唤起它的按钮”这一预期。
- **`modalSelector` 继续分散** — rejected：三个消费方各自维护选择器，一处改 selector 其余静默脱节；单一导出是 fork 断言能钉住的最小面。

## Consequences

代价：每个保留退场帧多两个属性、一份 `lastOpenCrumbs` 快照；`useModalLayer` 多一个 `outerOpener` 字段与一层祖先回退。收益：屏幕阅读器/键盘不再把退出动画当成可交互层，嵌套弹层批量关闭时焦点回到真实外部 opener，foreground 层查询归一到一处，`modal-layer` spec 从 11 扩到 18 项覆盖三种失活标记与父子同帧退休两种顺序。
