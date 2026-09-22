# Agent Note: 沙箱化 Sidebar 浏览器

Status: implemented

[English](2026-09-16-sidebar-browser.md) | 中文

## Problem

右侧 Sidebar 可以预览已寻址的工作区文件，但没有用于访问网页的独立界面。在应用外打开会丢失 Sidebar 的分栏、浮动与 tab 生命周期。把任意网页当成 Document Preview 内容，也会混淆两种不同的信任模型：网页控制一个活跃浏览上下文，而文档 renderer 只接收为一次预览选定的字节。

父页面不能检查或驱动跨域 iframe 的内部 history。支持的行为不能暗示具备这种能力。

## Decision

`@deepseek-ai/dsh-client-ui-sidebar-browser` 注册可多开的右侧 Sidebar `browser` tab 类型。`SidebarRightTabParamsMap.browser` 接受可选初始 URL，使其他 Client 插件无须导入本包运行时值即可打开 Browser。

`MarkdownDelegateProvider` 为嵌套的 Markdown anchor 提供可选 owner callback，用于委托普通 HTTP(S) 点击，同时保留带修饰键点击的原生行为。Chat 在 node list 外放置一个 Provider；已注册该类型时，它以 URL 作为 typed navigation 参数打开新的 `browser` tab，否则使用系统浏览器；Markdown renderer 不导入 Browser feature。

地址解析器接受 `http:` 与 `https:`，包括 loopback 目标；不带 scheme 的主机名补为 HTTPS。它拒绝内嵌凭据、应用自身 origin、畸形地址、`file:` URL，以及所有其他 scheme。本地文件继续由 Document Preview 负责。

当前 Web 与 Desktop 都使用 iframe 载体。它的默认 Web 策略是 `sandbox="allow-scripts allow-forms allow-same-origin allow-popups allow-popups-to-escape-sandbox"`；frame 没有直接的下载或顶层导航 flag。popup 会脱离 sandbox，Web popup 会保留 opener，并可以通过该链导航顶层应用。same-origin 允许被访问的 origin 使用自己的 Cookie 与 Web storage；它不会让跨域目标与 DSH 变成同源。iframe 不发送 referrer，也不添加包自有的 Permissions Policy，因此浏览器默认策略与用户授权生效。最右侧 toolbar 开关会为当前 tab occurrence 移除 sandbox attribute；该模式不持久化，启用期间持续显示警告。未受 sandbox 约束的页面可以按浏览器 activation 规则导航顶层应用，并使用下载、模态对话框和输入锁定。本包不执行 Host 侧 URL probe 或代理。

每个 tab 获得一个 `BrowserController` class。它的命令接口只有 `loadUrl`、`goBack`、`goForward` 与 `reload`；它负责地址校验和 `BrowserNavigation` 状态机。`BrowserFrame` 接口负责临时 sandbox 与 document 状态以及载体操作，`IframeImpl` 为当前 iframe 载体实现该接口。Slot injection 通过 `useBrowserFrame` 提供按 key 索引的 frame 状态，并提供普通 callback，因此 React body 不接收 controller 或 observable source；它只负责可编辑草稿与 iframe DOM。未来的 `ElectronWebViewImpl` 可以实现相同接口，而不把 URL 或载体状态放进组件。

`BrowserNavigation` 保存 canonical 当前 URL、受控加载 revision、导航状态，以及有上限的序列与当前位置。新地址丢弃 forward 分支；后退和前进移动 index；刷新重建应用最后已知的 URL 且不增加 history。body 重挂载时会重新加载应用最后已知的 URL，并且仅在尚无受控目标时使用可选初始 URL。Session-scoped store 只持久化该 class 的 immutable snapshot，供标题渲染与应用刷新恢复。occurrence abort 会删除其 bucket；`TabDomain` 对 tab 删除与 `ui-sidebar-right` 卸载使用同一个 abort，因此卸载或热重载 Sidebar 会清空 Browser history，即使 DockKit 随后恢复 tab record。

Browser 状态只属于呈现层，不进入 Session log、模型请求、resource model 或 DockKit layout operation。现有的[右侧 Sidebar 基础设施](2026-09-04-right-sidebar-docking-infrastructure.zh.md)、[tab 类型契约](../architecture/2026-09-05-sidebar-tab-types-and-navigation.zh.md)、[resource model](../architecture/2026-09-05-client-resource-model.zh.md)和[文档预览操作](../architecture/2026-09-08-document-preview-operations.zh.md)继续负责各自现有职责。

## Web 导航状态

对于一个受控 revision，Web 载体只把 iframe 的第一次 `load` 当作应用已知 URL 的确认。同一 revision 后续发生 `load`，只能证明文档已经变化，无法给出新的跨域 URL。携带旧 revision 的事件会被忽略。

| 状态 | 进入条件 | 地址与控件 |
|---|---|---|
| `empty` | tab 没有受控目标。 | 地址为空；后退、前进、刷新与外部打开均禁用。 |
| `loading` | 地址提交、应用 history 移动或刷新启动新的 revision。 | 请求 URL 仍是权威地址；后退和前进遵循应用 history 范围；刷新保持可用；外部打开遵循已知目标的协议。 |
| `known` | 当前 revision 收到 iframe 的第一次 `load`。 | 即使第一次加载包含 HTTP redirect，请求 URL 仍是权威地址。控件规则与 `loading` 的已知目标规则相同。 |
| `unknown` | 当前 revision 收到 iframe 的第二次或后续 `load`。 | 最后一个受控 URL 变灰，并标记 `URL 已变化`。iframe 不提供跨域 `canGoBack` 或 `canGoForward`，因此后退和前进禁用；外部打开禁用。刷新以最后一个受控 URL 启动新的 revision。 |

每个状态都允许编辑地址。无效草稿只报告地址错误，不改变当前导航状态。聚焦 unknown 地址会隐藏标记并显示前往按钮；回车与前往都会启动受控加载。切换 sandbox 模式会使用新的 revision 重新加载最后一个受控 Web 目标。iframe `error` event 只会为当前 `BrowserFrame` revision 标记临时加载失败 notice；它不改变 URL history，下一个受控 document 会清除它。浏览器不会为 DNS、TLS、mixed-content、CSP 或 `X-Frame-Options` 失败可靠触发该 event。不产生 iframe `load` 的 `pushState`、`replaceState` 与 fragment 变化仍不可观察。

## Deferred Electron carrier

Electron `<webview>` 支持已经完成设计，但当前不注册也不测试。controller 保持相同的四个命令，独立的 per-tab view 对象负责 attachment、detachment、状态观察与 target identity。这沿用 Playwright 的 Android WebView 划分：`AndroidWebView` 是由 package、process 与调试 socket 标识的 target 和生命周期 handle，`page()` 返回负责 Web 导航与 DOM 命令的普通 `Page`；设备级输入仍属于 `AndroidDevice`。

Desktop 设计只在应用窗口启用 `webviewTag`。其隔离 preload 获得不可猜的 per-window capability，每个 Browser tab 再追加新的 UUID，形成独立非持久化 partition。主进程只接受携带该 capability 且初始地址为 `about:blank` 的 guest，删除任何 preload，并强制启用 sandbox 与 context isolation、在所有 frame 禁用 Node integration、启用 Web security 与安全内容检查、禁用嵌套 webview 和 plugin。

主进程只允许页面发起的 main-frame 导航与重定向前往不含凭据的 HTTP(S)。请求可以使用 HTTP(S)、WebSocket、data 与 Blob URL；直接 file、自定义协议、extension 与特权请求都会被取消。permission 检查与请求、显示捕获、设备授权、下载、弹窗和拖放导航全部拒绝。

view 对象把非活动 guest 保持连接并停放在自有隐藏 DOM host 中，再把它移回可见占位符而不重建。这会在 Sidebar body remount 后保留页面与 target identity。因为 `<webview>` 参与 renderer 布局与合成，普通 DOM dialog、menu、tooltip 与拖拽预览可以覆盖它。`WebContentsView` 仍不合适，因为它是原生 child surface：CSS 无法覆盖它，每个 overlay 或动画都需要主进程同步 visibility 与 bounds。

每个 guest 都是独立 WebContents 和 CDP target。开发环境可以开放 Electron 的进程级 remote-debugging port，并明确选择 guest target。生产环境保持该 endpoint 关闭；browser-use 或 computer-use 需要一个经过认证的 broker，把一个已授权 tab 绑定到其 WebContents，并使用 `webContents.debugger` 或等价的 scoped transport，而不公开全部应用 target。

## Alternatives considered

**增加 Host embeddability probe 并持久化 sandbox 偏好。** 不采用，因为由 Host 请求任意目标会新增 SSRF 路径，probe 可能与后续重定向结果不一致，而持久化的全局逃生开关会让后续 tab 继承不安全选择。Browser 改为提供显式、按 tab、非持久化的 sandbox 开关，并持续显示警告。

**把 parent-owned history 当成完整 Web 模型。** 不采用，因为 iframe 内导航后，地址会悄然陈旧，而相关操作仍显示可用。当前受控 URL 已知时，有上限的 parent history 仍然有用；显式 `unknown` 状态会移除 iframe API 无法支持的能力声明。

**在 Browser 中支持 `file:` URL。** 不采用，因为本地文件已由 Document Preview 负责，而 browser 导航使用不同的信任模型。Browser 直接拒绝该协议，不获取文件系统或 Workspace Files 能力。

**通过 Host 代理网页。** 不采用，因为兼容代理必须重写 URL、CSP、Cookie、module、stream、form 与 download，同时会把 Host 变成通用出站请求器。

**在首个 Browser 变更中实现 Electron 载体。** 延期处理，避免在没有打包应用证据覆盖 overlay stacking、target lifetime、Cookie 隔离与全部 permission 拒绝路径时启用新的 Electron guest surface。

## Verification

单元测试覆盖协议解析、Markdown 链接委托、controller 命令与生命周期、确定性导航状态转换、有界 history、best-effort iframe error 和插件 disposal。Keyless Web 场景启动随附 composition，并覆盖消息链接路由、HTTP(S)、后退、前进、sandbox 控制、unknown 导航和协议拒绝。

## Consequences

Browser 不增加 Electron 权限，并在当前 Web 与 Desktop 构建中保持相同行为。很多站点拒绝 iframe 嵌入，或者依赖默认 sandbox 不向 frame 提供的下载或顶层导航。HTTPS 应用可能按 mixed-content 策略阻止公共 HTTP 页面，或限制 private-network 请求；关闭 sandbox 也无法绕过这些浏览器策略。关闭 sandbox 在其他方面会用自身保护换取兼容性：frame 可以按浏览器 activation 规则导航顶层应用，并使用下载、模态对话框和输入锁定。逃逸出 sandbox 的 Web popup 会保留 opener，并可以通过该链导航顶层应用。这两条路径都不会增加 Electron 或 Node API。URL 检查无法阻止 iframe 内页面自行选择目标。后续 iframe load 能表明已经发生导航，但无法给出跨域 URL；History API 与 fragment 变化可能完全不可见。延期的 Electron 载体必须通过真实打包应用验证，才能成为当前行为。

站点 Cookie 行为遵循用户浏览器，并不按 Browser tab 隔离。本地文件会被拒绝，并继续由 Document Preview 负责。持久化 URL 可能含敏感 query 或 fragment，因此用户不应在地址栏输入不希望保留在应用本地浏览器存储中的凭据。
