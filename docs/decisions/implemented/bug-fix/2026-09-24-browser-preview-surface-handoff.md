# Decision: Browser 预览在右栏与聊天浮层间交接

Status: implemented

中文 | [English](2026-09-24-browser-preview-surface-handoff.en.md)

## Problem

HTML 交付卡片原先直接展开右栏 Browser，用户无法通过卡片先看到聊天区悬浮预览。T3 Code 的 Browser 自动预览路径先打开 mini player，再由 mini player 的按钮打开右栏。Files 页还把另一个置顶原生文件窗口也称为“悬浮预览”，容易让用户混淆。实机点击另发现，从聊天浮层恢复到右栏后，guest 有时仍停留在浮层的 280×152 视口：离任浮层的异步 `previewHide` 与右栏的 `previewShow` 发生竞争。

## Decision

Browser 浮在聊天区的入口明确称“悬浮预览”；Files 的原生只读窗口入口称“独立窗口预览”。交付卡片对 HTML / HTM / XHTML / PDF 优先取得受保护的 Browser URL，先打开聊天区悬浮预览；点浮层“在右侧栏打开”才展开右栏 Browser。无法取得 URL 时退回 Files；其他文件保持 Files 路径。普通文件提及和工具路径维持现有右栏路径。两个呈现表面交接同一个 guest 时，离任表面不再发 `previewHide`；新所有者负责 `previewShow` 和后续尺寸同步。浮层被菜单或 PiP 遮挡时仍由浮层所有者隐藏 guest。

悬浮窗外观以 T3 Code 的 mini player 为参照：默认右上 12px、320×200、网页铺满主体。原生 BrowserView 会覆盖 renderer 控件，故保留顶部窄操作条，文件名取 URL 的最后路径段，普通网址显示主机名。顶部遵循 DSHD 语义色与幽灵图标按钮，只保留右栏和关闭动作，不放装饰性状态点。移除四周 20px 留白、常驻边框与八向外露刻线；缩放使用网页矩形外侧的透明四边和四角命中区，避开 BrowserView 对 renderer 指针事件的遮挡。

## Alternatives considered

- **点击交付卡片直接创建原生窗口**：绕过已有聊天区 Browser 浮层，也混淆文件独立窗口与 Browser 预览。
- **交付文档先展开右栏，再从工具栏浮起**：与用户要求的 Browser mini player 优先顺序不符。
- **复制第二个 Browser guest 给浮层**：会分裂 URL、历史和页面状态，并扩大资源开销。
- **保留两处“悬浮预览”文案**：用户无法辨别聊天区浮层和原生置顶窗口。

## Consequences

HTML 等交付文档卡片打开聊天区悬浮预览；浮层“在右侧栏打开”后，同一 guest 采用右栏当前边界并保留页面。Files 的独立窗口动作有不同名称。定向测试覆盖交付卡片意图、mini 优先打开和双向交接时的隐藏调用。
