# Agent Note: 桌面 surfaces 栏、标题栏尾簇与窗口控件避让

Status: implemented

[English](2026-08-14-desktop-surfaces-and-titlebar.md) | 中文

> 范围：已交付的四栏 AppFrame、`shell.titlebar.trailing` 列表 slot、桌面 `git` / `pty` / `preview` IPC，以及按实测宽度避让窗口控件。组合规则见 [slot 体系标准](2026-07-22-slot-type-chain-implementation.zh.md)；加载链与对象层见 [Web 客户端架构 note](2026-07-19-gui-web-client-architecture.zh.md)。本 note 不取代那些决策。

## 问题

桌面壳需要标题栏 Git、底栏终端和最右侧 surfaces 栏，同时不能移动 Inspect，也不能重做左侧栏。无边框窗口还要保证不断变宽的标题栏尾簇不与自绘的最小化 / 最大化 / 关闭按钮重叠。

## 决策

AppFrame 是四栏：`sidebar | conversation | details | surfaces`，外加只位于会话栏下方的终端抽屉。共享标题栏行落在会话栏与详情栏上；surfaces 跨越所有行直到窗口顶部；侧栏仍通高，顶部保留字标行。关闭的 `details` 与 `surfaces` 宽度为 0。让步顺序是先把 surfaces 压到下限，再压 details，再派生关闭 surfaces，再派生关闭 details；侧栏不让步。`ctx.layout` 对 surfaces 和抽屉的写入与 details 相互独立：标题栏开关从不打开或关闭详情栏，关闭其中一栏也不会关闭另一栏。

标题栏尾簇是布局拥有的列表 slot `shell.titlebar.trailing`，包装为 `#dshd-shell-titlebar-trailing`。贡献方通过 [slot 声明注入](2026-08-05-slot-declaration-injection.md) 注册。从左到右：Session log（`id: 'session-log-download'`，`order: 10`）、Git（`id: 'git-actions'`，`order: 20`）、面板开关（`id: 'panel-toggles'`，`order: 40`），然后是 Electron 窗口控件。开关只写入 `toggleTerminalDrawer` 和 `toggleSurfaces`。Session log 仍是原来的下载控件；仅在当前有会话时渲染。

Harness 客户端插件拥有 UI。Electron 只暴露 `window.shell.git*`、`window.shell.pty*` 和 `window.shell.preview*`；注入脚本不绘制 Git、终端或右侧栏。底栏抽屉与 Terminal surface 各自拥有面向工作区 cwd 的 PTY 会话表；在一侧打开的窗格不会出现在另一侧。五个 surface 是 Browser、Terminal、Files、Diff 和 Agents。在桌面应用之外，Git IPC 为空操作，Browser 卡禁用。

注入脚本只绘制无边框窗口控件板（`#dshd-shell-controls`），并发布 `--dshd-wco-controls`。AppFrame 拥有标题栏命中：一条 48px 的 `.captionDrag` 网格项横跨第 1 列到末列，是唯一的 `-webkit-app-region: drag` 矩形（作为第一个子节点，因此各列画在它上面）。可点击的 breadcrumb、`header.actions`、utilities、tabs、surfaces 标签控件、`#dshd-shell-titlebar-trailing`（`width: max-content`）、侧边栏字标与折叠开关，以及窗口控件板为 `no-drag` 空洞。字标盒子为 `width: max-content`，因此 logo 行中间的空隙仍留在 caption 带里。会话栏 `.titleRow` / `.blankCaption` 与 surfaces 标签栏不是拖动区。Chromium 对 `no-drag` 矩形做几何减法、不看堆叠顺序，因此凡是可能盖住该带顶部 48px 的层都要自己打洞：列缩放手柄、`overlayLayer` 条目、打开的手机抽屉及其遮罩，以及 client 样式表里每个 `position: fixed` 层（Modal、Menu portal、tooltip、hover card、toast、横幅、onboarding、lightbox、拖放遮罩、设置 overlay、CordisPanel）。壁纸背景是唯一豁免；它是 `pointer-events: none`，在那里打洞会盖住整个视口。空白 / 草稿会话仍把页头留在网格第 1 行，以便标题栏轨道保持高度。AppFrame 测量 `#dshd-shell-titlebar-trailing` 以发布 `--dshd-titlebar-conversation-reserve`；注入脚本不测量尾簇。AppFrame 有一行共享标题栏网格（`auto` + 主体 + 抽屉）。会话栏页头与滚动主体是该行对的 subgrid 项（`ConversationRoot` 为 `display: contents`）。详情栏占用主体行，因此分割线和占用者从标题栏带下方开始。surfaces 跨越所有网格行直到窗口顶部。surfaces 打开时，尾簇只占第 2–3 列（`margin-right: 8px`），Session log、Git 和面板开关停在第 4 列之前；窗口控件通过 surfaces 标签栏上的 `margin-right: var(--dshd-wco-controls)` 避让（ui-surfaces）。surfaces 关闭时，尾簇伸到右缘（`margin-right: var(--dshd-wco-controls, 8px)`）。尾簇是该标题栏行的网格项（`justify-self: end`；`width: max-content`），不是盖在栏内容上的 overlay。手机与 compact-header 框架隐藏尾簇；关闭的列宽度为 0 且不画分割线，因此不会留下空洞。尾簇仍画在被挤窄的会话栏上时，AppFrame 发布 `--dshd-titlebar-conversation-reserve` 以及 `full` / `cozy` / `compact` 密度，让页头让位、标签收起而不是互叠；由[标题栏拥挤笔记](../bug-fix/2026-08-17-titlebar-crowding-density.zh.md)拥有。注入脚本是可重复执行的 IIFE：对同一文件的第二次 `executeJavaScript` 不得抛错。

## 备选方案

**在 `harness-chrome-inject.js` 里绘制 Git、终端或右侧栏。** 该文件会执行两次（`dom-ready` 然后 `did-finish-load`）；顶层绑定会抛错，catch 会把窗口涂成白色。桌面 chrome 也没有 slot、locale 或 store（存储）座位。

**用 surfaces 替换 details 栏，或让标题栏开关驱动 details。** Inspect、轨迹表的 TOOL 检查器和现有的详情开闭仍属于 `details`。共用一个开关会把两列耦合在一起。

**引入 GPU 终端模拟器外加 Effect / zustand 右侧栏栈。** 客户端已经通过 slot 和 `defineStore` 组合。第二套状态栈会重复所有权，并破坏四份 props 规则。

**把尾簇绝对定位在框架上，再用 `margin-top` inset surfaces。** overlay 会压在空态卡片和 Tab 上；56px 的列 spacer 会在右栏上方留出空洞，而会话栏仍有自己的页头。surfaces 通到窗口顶部；该列打开时尾簇停在第 4 列之前，因此不会压住标签栏。

**注入超高 z-index 的 48px 拖动遮罩。** 下层元素的 `no-drag` 无法恢复点击。改由 AppFrame 拥有一条画在各列后面的 caption 矩形。不在 surfaces 标签栏上再声明一块互不隶属的 drag：Chromium 会丢掉先声明的矩形，打开右侧栏后会话栏标题就无法再拖动窗口。

**把 `-webkit-app-region: drag` 散落在会话栏 caption 行和 surfaces 标签栏上。** 两块兄弟矩形在 CSS 上看起来正确，但 Windows 上会合成失败，右侧栏一开就只剩一块能拖。

**用 `--dshd-wco-pad` 定位尾簇。** pad 包含尾簇自身宽度，每次测量都会把尾簇推向左侧。`--dshd-wco-controls` 才是仅窗口控件的 inset。

**用写死的尾簇宽度代替实测 `#dshd-shell-titlebar-trailing`。** Session log、Git 和开关会随 locale、状态和占用变化宽度。常量要么挡住窗口控件，要么留下永久空洞。

## 影响

Web 组合与桌面窗口共用同一批客户端插件；Electron 是 IPC 宿主，不是第二棵 UI 树。details 与 surfaces 可以各自开闭。窗口控件 inset 是固定的控件宽度。AppFrame 尾簇上的 ResizeObserver 是唯一的实时尾簇测量，因此新增标题栏占用者不必再改注入常量。

注入脚本保持为封闭的 chrome IIFE，只拥有窗口控件板。需要新标题栏控件的贡献方以带 `order` 的方式注册到 `shell.titlebar.trailing`，不要把 Node 辅助函数写进该文件。

本仓库的桌面 PR CI 在 `.github/workflows/test.yml` 运行单元测试、vendor GUI 套件和 Windows 源码 Electron smoke。`release.yml` 的安装包工作流对打包后的应用运行同一套命中探针。两条工作流都不运行 harness 的 `test:coverage`、`typecheck`、`lint` 或 `doc-sync`。新的客户端包在本地仍受 harness 的逐文件 100% 覆盖率门槛约束，对真正不可达的分支使用 `/* v8 ignore -- <reason> */`。

用户终端在会话栏抽屉和 Terminal surface 中都是 `@xterm/xterm` VT 模拟器。

## 测试

各包套件钉住让步、store 动作、标题栏注入 / dispose（资源释放）、Git 状态、独立 PTY 所有权，以及五卡空态。`src/main/harness-chrome-inject.test.js` 钉住 IIFE 形态、二次求值、窗口控件板上的 pointerdown、仅 `--dshd-wco-controls`，以及不存在拖动条、MARK/HIT 属性和 DOM 嗅探。AppFrame CSS 钉住一条 caption drag 带（第 1 列到末列）和 max-content 的尾簇 no-drag 空洞；会话栏与 surfaces CSS 钉住控件 no-drag，且不再声明第二块 drag 矩形。侧边栏 CSS 钉住 max-content 的字标空洞和折叠开关空洞，使 logo 行中间的空隙留在 caption 带里。`ui-layout/tests/caption-drag-regions.client.spec.ts` 扫描 `packages/client` 与 `packages/extensions` 下的全部样式表：只允许一个 `drag` 块（`.captionDrag`），且每个 `position: fixed` 块都要有 `no-drag`，壁纸背景是记录在案的指针惰性豁免。`apps/web/tests/desktop-chrome.e2e.ts` 是无密钥的组装布局断言：标题栏有 Session log、Git 和两个开关且框不互叠，右侧栏空态有五张卡，surfaces 打开时仍能打开 branch menu。该通道不执行 Electron `-webkit-app-region` 命中。源码与打包 Electron smoke 在打开 surfaces 后，于真实按钮中心发送 `Input.dispatchMouseEvent`，并要求 branch 与 Git 菜单发生变化。

## 相关

[右边栏与终端工作环](../feature/2026-08-16-surfaces-terminal-work-loops.zh.md) 拥有工作环和本桌面不交付的能力。[Web GUI 浏览器 e2e 通道](../testing/2026-07-24-web-gui-browser-e2e-lane.zh.md) 拥有快照机制。[slot 声明注入决策](2026-08-05-slot-declaration-injection.md) 拥有 `shell.titlebar.trailing` 上贡献方的生命周期。[标题栏拥挤密度笔记](../bug-fix/2026-08-17-titlebar-crowding-density.zh.md) 拥有会话栏页头避让与标签收起。
