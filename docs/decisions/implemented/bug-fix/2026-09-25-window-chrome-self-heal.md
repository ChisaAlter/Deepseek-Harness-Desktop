# Decision: 透明无边框窗口的注入式窗控自愈与几何最大化判定

Status: implemented

中文 | [English](2026-09-25-window-chrome-self-heal.en.md)

## Problem

用户报告：修改插件并重启几次之后，主窗口圆角消失、右上角最小化/最大化/关闭按钮丢失、视口最右边出现一条黑线。主窗口是 `frame:false + transparent:true`，圆角剪影与窗控按钮全部由 `harness-chrome-inject.js` 注入 Harness BrowserView 页面绘制，三个症状同源——注入脚本没生效或注入后节点被抹掉。

排查确认两个独立缺陷：

1. **注入生命周期不自愈**：`syncHarnessChrome` 只在 `did-finish-load` / `dom-ready` / `did-navigate-in-page` 与 reveal 时各跑一次 `executeJavaScript`，且不 retry。eval 撞上导航帧交换会 reject 并被静默吞掉；之后页面 DOM 重建抹掉注入节点也没有事件兜底——窗口保持 chromeless 直到下一次恰好导航。
2. **透明窗口最大化状态是假的**（Electron 43.4.0 实测）：`maximize()` 把窗口拉成工作区大小并派发 `maximize` 事件，但 `isMaximized()` 恒为 `false`，`unmaximize()`/`restore()` 是 no-op，`getNormalBounds()` 返回最大化后的矩形。窗控按钮因此永远无法还原，`data-window-maximized` 永远不置位（最大化时圆角不收 0）。

## Decision

注入侧改为「主进程 retry + 事件覆盖 + 页面自愈」三层：

- `syncHarnessChrome` 对 transient eval 失败按 `CHROME_INJECT_RETRY_MS`（250/700/1500ms）重试，每轮重查 `isHarnessUrl` 门控；最终失败才落白底兜底。
- `window.js` 增补 `did-navigate` 绑定，并在 `focus`/`show` 上以 800ms 节流重新断言注入（`_dshHarnessResizeBound` 一次性守卫内，不累积监听器）。
- 注入脚本在 `__dshShellChromeBound` 一次性块内挂一个 `MutationObserver`（childList+subtree）：三个注入节点（style/controls/frame-canvas）任一丢失即走既有 `schedule()` 去抖重建；只查自身注入 id，不触碰应用布局——既有「chrome 只拥有窗控板」契约保持成立。

最大化状态改为几何判定：`isEffectivelyMaximized(win)` = 原生 `isMaximized()` 或「窗口矩形覆盖所在显示器工作区」。`attachIntegratedChrome` 在 `resize`/`moved` 上同步有效状态：跳变时推送 `shell:window-state`，未最大化时把 `_dshNormalBounds` 刷成当前矩形。`shell:window` 的 maximize 分支：原生最大化走 `unmaximize()`；假最大化（几何最大化但 `isMaximized()` 为假）用 `setBounds(restorableNormalBounds(win))` 还原——`_dshNormalBounds` 缺失或自身已盖住工作区（小屏上普通尺寸即占满）时回退到工作区居中的 1440×920 默认矩形，还原永不落空。`shell:window-state` 查询同样返回几何判定结果。注入脚本首次运行时除订阅 `onWindowState` 外主动 `getWindowState()` 播种——状态推送只在几何跳变时发生，窗口已最大化时新文档若只等推送会以圆角剪影开局直到下次几何事件。

## Alternatives considered

- **只在渲染侧自愈（MutationObserver 单层）** — rejected：eval 因帧交换 reject 时脚本根本没跑过，页面里没有 observer；主进程 retry 是先决条件，observer 只能兜「注入后又被抹掉」一段。
- **轮询 getComputedStyle / setInterval 重断言** — rejected：等价覆盖但更耗主进程往返且粒度粗；observer 只在结构变化时触发，且复用既有 80ms 去抖。
- **去掉 `transparent:true` 换回原生最大化语义** — rejected：透明分层窗口是圆角剪影设计的承载方式（feature 卡现行契约），为一个可绕过的状态怪癖推翻整套视觉方案不成立。
- **最大化时同时监听 `getNormalBounds()` 返回值** — rejected：透明窗口下该 API 返回最大化后的矩形，实测不可信；必须自己跟踪上一个普通矩形。
- **用任意遮罩盖住右缘黑线** — rejected：黑线是注入缺席时 viewport 滚动条槽/透明背板的表象，治本靠注入不缺席；贴膏药会留下两层实现。

## Consequences

插件/页面重启循环中，注入即使被帧交换或页面重建打断也能在三次重试、导航事件、窗口重回前台或 observer 自愈中的任一跳恢复，圆角剪影与窗控按钮不再持久缺席；黑线随 `html{overflow:hidden}` 稳定生效而消失。最大化按钮在透明窗口上真正可往返：点击后 `data-window-maximized` 置位、圆角收 0、图标变还原，再点还原到跟踪的普通矩形。代价：`_dshNormalBounds` 是主进程私有约定（非 Electron API）；observer 在页面每次 DOM 变更时多三次 `getElementById`，开销可忽略。验证：`chrome-theme`/`window-harness-cover`/`harness-chrome-inject` 26+13 项单测全过（含 retry、离开 origin 终止、几何最大化判定、observer 自愈契约新用例）；真机 CDP 验证——强制删除三个注入节点后自愈重建，maximize→restore 往返 1440×920 ↔ 1646×960 且状态/图标/圆角同步，`retryFullPlugins` 六轮重启后 chrome 契约逐轮全绿。
