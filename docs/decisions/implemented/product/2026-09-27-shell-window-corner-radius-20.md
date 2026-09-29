# Decision: 壳层窗口剪影圆角回调到 20px

Status: implemented

中文 | [English](2026-09-27-shell-window-corner-radius-20.en.md)

> Supersedes [2026-09-27-shell-window-corner-radius-10](../../archived/product/2026-09-27-shell-window-corner-radius-10.md)

> 20px 透明剪影继续有效；[圆角与动画同时保留](../bug-fix/2026-09-29-rounded-window-motion.md)在 Windows 补回原生动画样式，撤销先前不透明窗口取舍。几何回退仅用于未启用原生桥的窗口。

## Problem

剪影半径统一收敛到 10px 落地当天，用户实测反馈「启动器和桌面端的圆角太小」。复核 mac 参照系发现锚点本身在漂移：10pt 是 Big Sur–Sequoia（macOS 11–15）的标准窗角；现版 Tahoe（macOS 26）已把窗角加大到 16pt 起步、带工具栏/侧栏的窗更大且不再统一，理由是窗角与内部玻璃工具栏同心（concentricity）。10px 锚的是上一代 mac，在本产品桌面上读作偏紧。

## Decision

剪影半径 10→20，其余合同原样保留：四个渲染上下文的同值分层（注入层 `FRAME_RADIUS`、boot `body`/`.scene`、launcher `.shell`、弹窗 scrim、vendor `.frame` + `--dsh-windows-content-radius` + `lib/client.js` 产物 + ui-layout README）、`corner-shape: round` 正圆弧、`border-l2` 缘线、最大化归零、`shell-silhouette-radius.test.js` 跨层钉值随合同更新。

## Alternatives considered

- **16px（Tahoe 无工具栏窗默认）** — rejected：用户直接指定 20；且 Tahoe 窗角随窗口家具浮动没有单一值，16 只是其下限。
- **保持 10px（Sequoia 锚点）** — rejected：用户实测偏小，且 Tahoe 之后该锚点已不再代表「mac 常规」。
- **squircle 角形补视觉半径** — rejected：沿用前篇角形决定；同值半径在不同渲染上下文画不同曲线的问题不变，页面内 UI 面板继续走全局 squircle、窗角保持 round 的区分也保留。

## Consequences

窗角 20px 高于 Sequoia 常规（10），也高于 Tahoe 无工具栏默认（16），落在 Tahoe 带工具栏窗的视觉区间——这是明确的偏好取值而非平台锚定。角形、分层结构、缘线强度与最大化归零规则不变；`--dsh-windows-content-radius` 下游消费者（centerCol 内容角、右栏全屏角）经 var 自动跟随。代价与前篇相同：半径字面量跨渲染上下文分散持有，靠测试防漂移。
