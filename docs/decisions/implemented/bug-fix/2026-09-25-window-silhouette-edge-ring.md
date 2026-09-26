# Decision: 透明窗圆角剪影用嵌边发丝环锚定边缘

Status: implemented

中文 | [English](2026-09-25-window-silhouette-edge-ring.en.md)

## Problem

圆角/窗控恢复后用户仍反馈「圆角很糊」。主窗口是 `frame:false + transparent:true` 分层窗，圆角剪影完全由页面自绘的 alpha 边缘构成（`harness-chrome-inject.js` 给 `body` 加 20px 圆角 + `overflow:hidden` 裁切）。像素实测直边/弧边过渡只有 ~1.5–2 物理像素（150% DPI），接近正常抗锯齿——但裸 alpha AA 边缘没有锚定线，在桌面壁纸映衬下读作发糊；同架构的 launcher 卡靠 `.shell` 的 `inset 0 0 0 1px var(--dsw-alias-border-l1)` 发丝环获得清晰轮廓，Harness 剪影缺少等价物。

## Decision

注入脚本新增专用元素 `#dshd-frame-ring`（`ensureFrameRing`，挂到 `document.body`——`--dsw-alias-*` token 定义在 body 上，挂到 documentElement 会永远只命中 fallback 色）作为剪影的发丝环：`position:fixed; inset:0; border-radius:20px; box-shadow: inset 0 0 0 1px var(--dsw-alias-border-l2, rgba(128,128,128,.4)); pointer-events:none; z-index:2147483646`（比窗控板的 2147483647 低一级）。环色走 `border-l2`（深色 12% 白 / 浅色 10% 黑）——`border-l1`（6%/4%）实测太弱不足以锚定边缘；fallback 色兜住 token 缺失页面。`html[data-window-maximized]` 下该元素 `display:none`——最大化方形剪影不留边线，与 launcher 卡最大化去环一致。

环不设 `corner-shape`——客户端全局 `* { corner-shape: var(--dsw-corner-shape) }` 自动给它 `superellipse(1.5)`，与 `body` 裁切同一曲线。实测确认合成层的 overflow 裁切确实按 `corner-shape` 生效：把环钉成 `round` 会在弧中段与剪影错位出双线，所以环与裁切必须共用同一 shape 值。

## Alternatives considered

- **发丝环画在 `body::after` 伪元素上** — rejected：占住客户端未用但未来可用的 `body::after` 命名空间（撞车即静默失效），且伪元素不在 DOM 中、自愈 observer 无法按 id 盯它；若客户端给 `body` 加 transform/filter，`position:fixed` 伪元素的包含块还会改挂。真实元素可观察、可自愈、命名空间独立——初版用伪元素，对抗性审查后改为元素。
- **发丝环画在 `body` 本体上** — rejected：`inset` 阴影绘在元素背景之上、子元素之下，会被铺满视口的 `.frame` 内容层盖住，等于没画；必须是一个在内容上层的覆盖层。
- **去掉注入裁切，让客户端 `AppFrame` 的自带圆角当剪影** — rejected：实测移除 `body` 裁切后窗口四角变方——该布局态下 `AppFrame` 半径不构成窗口级剪影，注入裁切是唯一权威边缘。
- **`corner-shape: round` 替换 superellipse** — rejected：同几何 A/B 截图几乎无差别，不是发糊根因；且 `superellipse(1.5)` 是客户端设计语言的全局 token，桌面壳不应另造一套。
- **回退 `transparent:true` 换 DWM 原生圆角** — rejected：透明分层窗承载页绘壁纸/渐变与剪影设计（feature 卡契约），为边缘质感推翻整套视觉方案不成立。

## Consequences

剪影边缘现在有 1px `border-l2` 发丝环锚定，圆角在桌面壁纸上读作清晰轮廓而不是渐变带；最大化往返中环随 `data-window-maximized` 经 `display:none` 正确消失/复现；环列入自愈 observer 的第四个注入 id，页面重建抹掉它也会重建。代价：多一个常驻 DOM 节点与一次 observer `getElementById`（开销可忽略）；`dshd-frame-ring` 成为注入面第四个 id，删除它会被自愈拉回。验证：`harness-chrome-inject` 10 项单测全过（环契约 + 自愈 id + `getWindowState` 播种断言）；真机 CDP——环元素就位、computed `superellipse(1.5)`/inset-1px-ring，最大化→`display:none`、还原→环恢复，物理像素截屏四角弧线有锚定环且右缘无黑线。
