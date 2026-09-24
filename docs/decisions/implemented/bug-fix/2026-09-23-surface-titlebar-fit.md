# Decision: 右栏展开时按标题行余量收起会话操作

Status: implemented

中文 | [English](2026-09-23-surface-titlebar-fit.en.md)

## Problem

打开 DSHD 右栏会压窄会话列，但 `AppFrame` 的 `full/cozy/compact` 只按整列宽度选档。实机 1440px 窗口中，会话列仍高于 720px，保持 `full`；Session 日志与 Git 尾簇占去约 500px 后，标题行仅余 225px。`Agent Team` 到 x≈482，而打开目录按钮从 x≈471 开始，两者重叠约 11px，标题被挤到 16px。已有静态 CSS 测试与尾簇内部间距测试没有检查头部两组控件之间的真实边界。

## Decision

会话标题行以扣除尾簇预留后的自身内容宽度为 CSS 查询容器。在宽度不超过 520px 时收起次级 `header.actions`，保留标题、打开方式与尾簇。动作组在其余宽度也允许收缩，并把溢出裁在自己的盒子内，不得画到 utilities 上。密度仍按整列宽度决定尾簇标签，避免标签宽度与密度相互触发振荡。`AppFrame` 将尾簇的实测小数像素向上取整后写入预留宽度；四舍五入会在实机中把 8px 安全间隔缩成 7.7px。新增 Electron/CDP 几何门禁：打开右栏后，头部动作与 utilities、utilities 与尾簇各保留至少 8px 水平间距。

## Alternatives considered

- **只改整列的 720px 密度阈值**：右栏、侧栏、窗口控件和插件按钮宽度都会变化，固定整列阈值仍无法保证实际标题余量。
- **用标题余量驱动尾簇 `full/cozy/compact`**：尾簇收起文字后会改变测得宽度，可能在档位间往返；既有拥挤密度笔记已否决这一反馈环。
- **只把动作组裁掉**：虽然盒子不再交叉，按钮会被截断且仍占用标题宽度，不能作为正常窄态呈现。

## Consequences

右栏打开且标题行受挤压时，Agent 次级操作暂时收起；收起右栏后按可用空间自动恢复，无持久设置变化。打开方式与右侧尾簇仍可点击，标题保留省略语义。该局部查询不改变尾簇宽度，因而不引入密度振荡。实机复现由动作与打开方式重叠约 11px 变为无动作组；`ui-layout` 单测锁住小数像素向上取整，`apps/web/tests/titlebar-fit.e2e.ts` 在构建浏览器中锁住三组控件的真实几何，`scripts/verify-titlebar-fit.mjs` 提供源码 Electron 的重复验收。与[右栏恢复决定](../product/2026-09-23-right-sidebar-dshd-guide.md)部分重叠，但只负责顶部避让；[标题栏点击区域决定](2026-09-23-titlebar-click-regions.md)仍负责 `no-drag` 命中区。
