# Decision: 悬浮预览关闭后释放原生 guest

Status: implemented

中文 | [English](2026-09-27-browser-float-close-release.en.md)

## Problem

点悬浮预览的关闭键后，顶部窄条与圆角外壳消失，网页内容仍留在聊天区原处。外壳是 renderer 节点，网页是主进程 `BrowserView`：原生视图永远画在 renderer 之上，关闭外壳不会让它消失。

交付卡片路径先开浮层、右栏保持关闭。用户点关闭时，`ui-surfaces` 的 Browser 面板仍挂在隐藏的 occupant 里：它自己的 effect 局部变量 `visible` 在每次依赖变化时重置为 `false`，于是既没有可用宿主矩形去接管 guest，也没有任何一任表面发出 `previewHide`。原生视图停在浮层最后一次 `previewSetBounds` 的矩形上，直到该 guest 被别处重新导航才会离开。

## Decision

浮层关闭仍保持“由右栏面板重新接管”的既有交接语义：离任表面不发 `previewHide`，避免与新所有者的 `previewShow` 竞争。缺的是“浮层曾经真正呈现过这个 guest”的跨表面事实，因此面板补一个 `floatOwnedGuestRef`：浮层打开且 `previewId` 相同时置位，浮层关闭后的首次同步读取并清零它。

第一次同步按宿主可用性二分：宿主矩形可见时以新边界 `previewShow` 收回 guest（保持 URL、history、页面状态），宿主矩形为空（右栏收起、页面隐藏）时发出 `previewHide` 释放原生视图。此后回到常规的 `previewShow` / `previewResize` 循环。

## Alternatives considered

- **关闭键直接发 `previewHide`** — rejected：它与同一 tick 内右栏面板的 `previewShow` 竞争，正是 2026-09-24 交接修复要消除的竞态；浮层无法知道右栏是否已经接管。
- **把面板 effect 的 `visible` 提升为模块级单例** — rejected：一个进程内可能有多个座位/会话各自持有 `PreviewPanel`，共享单例会互相污染所有权。
- **关闭时销毁 guest，重开再新建** — rejected：`dshd mini-player` 的契约要求同一个 guest 在两种呈现间迁移并保留 URL / history；重建会丢页面状态。
- **改成 renderer 内 `webview` 而不是原生 `BrowserView`** — rejected：不在本次缺陷范围内，且会改变整套预览隔离与命中测试设计。

## Consequences

收益：关闭悬浮预览后聊天区立刻干净，右栏收起时不再残留网页；右栏可见时仍按原契约收回同一 guest，页面状态不丢。代价：`PreviewPanel` 多保留一个跨表面所有权标志，其正确性依赖“浮层打开时 `previewId` 已相同”这一既有排序；该排序由 `setMiniPlayerRuntime` 与 `openMiniPlayer` 的调用顺序保证，并由定向 spec 钉住。

## Sources

- [聊天浮层与右栏交接](2026-09-24-browser-preview-surface-handoff.md)
