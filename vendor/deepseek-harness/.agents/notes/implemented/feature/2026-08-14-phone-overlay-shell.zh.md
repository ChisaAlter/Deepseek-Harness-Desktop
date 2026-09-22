# Agent Note: Phone overlay shell for the official web UI

Status: implemented

[English](2026-08-14-phone-overlay-shell.md) | 中文

## Problem

官方 web 外壳把 1024px 以下一律当成被挤窄的桌面：侧边栏收成 56px 轨道，让步链仍为该轨道和 640px 中间栏下限留位。手机宽度的浏览器或 Android WebView 因此会在被压扁的会话栏上叠一条轨道，没有安全区留白，也无法在不挡住输入栏的情况下找回完整会话列表。手机远程客户端套的就是这一页，所以缺陷是桌面窄窗布局，而不是缺少原生聊天界面。

## Decision

`AppFrame` 在设备竖屏且宽度低于 `PHONE_MAX`（768px）时增加更严的一档。横屏是设备旋转：先看 `screen.orientation.type`，该 type 过期或未触发 `orientation.change` 时再看物理 `screen.availWidth`/`availHeight`，然后才是 matchMedia。手机键盘会把视口高度压到小于宽度，否则会退出覆盖层档，让标题栏尾簇重新盖住会话标题，并在切会话后闪出桌面铬栏（输入栏会聚焦 textarea）。AppFrame 在 window resize、visualViewport resize、matchMedia 和 `orientation.change` 上重新读取横屏。紧凑标题（`data-compact-header`）是任何低于 1024px 的视口，包括横屏，因此旋转不能把尾簇重新显示出来。该档仍使用现有的窄窗 store 开关（`narrowExpanded` / `toggleSidebar`），因此竖屏 1024px 的平板自动折叠保持不变。竖屏手机上网格轨道为 `0px minmax(0, 1fr) 0px`：会话栏占满框架，侧边栏画成左侧覆盖抽屉（`PHONE_DRAWER`，320px，夹紧后右侧留出点击遮罩），已打开的详情栏偏好则画成全框覆盖层。不挂载拖动手柄。AppFrame 上的浮动菜单按钮打开抽屉；点击遮罩关闭。切换当前 Session 也会关掉覆盖抽屉。中间栏隔离会话栏的 z-index（粘性输入栏、占用圆环），避免这些层画到抽屉上面；手机遮罩／侧栏／菜单／详情栏为 10–13，低于 `shell.overlay`（20）。手机抽屉把 `--dsw-specific-sidebar-fill` 叠在 `--dsw-alias-bg-base` 上，避免壁纸玻璃把遮罩混进侧栏；遮罩沿用 Modal 配方（`--dsw-alias-bg-mask-1` + `--dsw-mask-blur`）。标题栏尾簇（Session log、Git、分栏开关）在 `data-phone` / `data-compact-header` 上不显示——它在手机宽度上会绝对定位盖住会话标题。侧边栏 owner share 仍只携带 `collapsed` 和 `width`；关闭的手机抽屉报告 `width: 0`，因为没有轨道。会话栏标题、输入栏、详情栏标题和设置面板增加 `max-width: 767px` 的安全区与全幅规则；输入栏工具行会换行，模型芯片会缩短，避免权限和模型控件挤在一起。`apps/web/index.html` 设置 `viewport-fit=cover`。

横屏跳过覆盖层档和 `SIDEBAR_AUTO_COLLAPSE`：侧边栏留在网格里，宽度用偏好（或 `SIDEBAR_DEFAULT`）。手机旋转不得掉进 56px 轨道。

web-app 组合包钉 browse 目录选择配对（`dsh-host-directory-picker-browse` + `dsh-client-ui-directory-picker-browse`），而不是 auto/native 选择器。手机远程共用这个 Host；原生 OS 对话框会在桌面屏幕打开，同时手机上的添加工作区控件保持禁用（`flowBusy`）且没有应用内界面。`host.listDirectory` 不是仅回环的特权方法，因此应用内对话框可以从远程客户端工作。对话框是完整的文件系统导航：主目录是默认落地与快捷入口，面包屑保留其上的祖先，Win32 在卷选择器列出可进入的盘符根。

## Alternatives considered

**重做一套原生 Android / Expo 聊天界面。** 否决：产品包装的是官方页；第二套会话栈会立刻和工具、审批、主题分叉。

**把手机当成现有的 1024px 轨道。** 否决：390px 框架上的 56px 轨道会让会话栏不可用，并且仍然藏起会话标题。

**把侧边栏 slot 契约加宽，加入 `toggleSidebar` / `phone`。** 否决：手机铬栏是外壳职责；AppFrame 已经拥有折叠。会话栏和侧边栏插件不需要新的 owner 字段来恢复抽屉。

**把 `dsh web` 绑到 `0.0.0.0` 供手机访问。** 否决：Host 围栏和缺失鉴权使未认证的局域网绑定不安全。桌面反向代理让 dsh 继续只听回环地址。

## Consequences

竖屏手机、竖屏平板、横屏是三档：测试必须把 390px 竖屏（覆盖层，无手柄）、980px 竖屏（轨道）和约 844px 横屏（侧栏在网格里，无菜单按钮，仍隐藏标题栏尾簇）分开钉住，并钉住设备竖屏但 matchMedia 报横屏（键盘）时仍留在覆盖层，以及 `orientation.change` 不触发时靠 resize / 物理屏幕进入横屏。覆盖层 CSS 住在 ui-layout；会话栏和设置只加媒体查询内边距，因此之后改抽屉不必重触 slot 契约。作者不得把 `PHONE_MAX` 折回 `SIDEBAR_AUTO_COLLAPSE`，不得把轨道套到横屏上，也不得用 CSS `orientation` 驱动手机铬栏。桌面加手机远程的 Host 钉 browse 目录选择，不得改回 auto/native，否则添加工作区会在宿主屏幕弹系统对话框、手机按钮保持禁用。
