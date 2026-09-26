# 模块：窗口与 Chrome

## 职责与非目标

**职责：** 主窗口、boot↔harness 切换、标题栏注入、关闭遮罩、窗口控件，以及桌面宠物浮层（隐藏的 Codex `BrowserView` 宠物与启用的 Live2D 透明窗宠物）。
**非目标：** 不自绘整套窗口皮肤替代系统控件命中区。

## 用户路径

- 最大化 / 最小化 / 关闭走系统区；主题色跟随 token。
- 关闭可进托盘（见 [tray-update.md](tray-update.md)）。
- 标题栏桌面簇（Git 等）由注入 / 官方 slot 承接。
- 桌面宠物在 Harness ready 后出现：Live2D 形态整屏透明窗、悬停才交互；Codex 形态（feature 关闭）是主窗内 80–96px 小矩形视图。

## 架构要点

- shell 窗是 `transparent: true` 分层窗：剪影由页面自绘（boot 页圆角卡、harness 页注入 `body` 圆角裁切 + `#dshd-frame-canvas` 底色层 + `#dsh-wallpaper` 同径 + `#dshd-frame-ring` 嵌边发丝环锚定边缘），`paintBackground` 对透明窗跳过。代价是 Windows 分层表面语义：最大化只改 bounds、`isMaximized()` 恒假、`unmaximize()`/`restore()` 无效——有效最大化按「覆盖工作区」几何判定（`isEffectivelyMaximized`），还原用主进程跟踪的 `_dshNormalBounds` + `setBounds`（见 [2026-09-25 窗控自愈与几何最大化](../../decisions/implemented/bug-fix/2026-09-25-window-chrome-self-heal.md)、[2026-09-25 剪影嵌边环](../../decisions/implemented/bug-fix/2026-09-25-window-silhouette-edge-ring.md)）。注入丢失有三层兜底：eval 失败 retry、`did-navigate`/`focus`/`show` 重断言、页面 MutationObserver 自愈。
- `window.js` 管理 Harness BrowserView bounds 与覆盖；`desktop-pet.js` + `desktop-pets.js` 管理 Codex 宠物发现（`${CODEX_HOME:-~/.codex}/pets`、v1/v2 图集）、约 80–96px 宠物 BrowserView、右键换肤菜单、归一化位置和生命周期，feature 默认关闭。
- `desktop-live2d.js` 管理 Live2D 宠物：覆盖虚拟屏的透明 `alwaysOnTop` BrowserWindow，窗口本身永不 `setPosition`（分层透明窗移动会闪空）；默认 `setIgnoreMouseEvents` 穿透，主进程 ~30Hz 轮询 `screen.getCursorScreenPoint()` 推 `shell:live2d-cursor`，渲染器按角色 alpha bounds 决定交互。页面经特权 `pet://` scheme 加载，渲染进程内跑 onnxruntime-web（WebGPU→WASM 回落）。
- `harness-chrome-inject.js` / `chrome.js` 把桌面 chrome 接到官方页。
- `closing-overlay.js` 关闭过渡。

## 实现入口

- `src/main/window.js`、`desktop-pet.js`、`desktop-pets.js`、`desktop-live2d.js`、`pet-growth.js`、`pet-stats.js`、`chrome.js`、`harness-chrome-inject.js`、`closing-overlay.js`
- `src/renderer/pet.*`（Codex 宠物页）、`pet-live2d.*`、`pet-physics.js`、`pet-dialogue.js`、`dialogue/`、`window-controls.css`

## 不变量

- 栏是 `AppFrame`，不是卡片网格。
- Surface Tab 关闭控件在标题**右侧**。
- 两种宠物形态不得同时可见；宠物 preload/IPC 面收窄，不暴露 Harness workspace/Git/文件/远程/插件权限。

## 门槛

- QA：`TC-WS-002` … `TC-WS-004`；`TC-SURF-007`；`TC-DESK-010`（Codex 宠物）、`TC-DESK-011`（Live2D 宠物）

## 延伸阅读

- [design-language.md](../../design-language.md)；卡片：[desktop-pet](../../features/desktop-pet.md)、[desktop-live2d-pet](../../features/desktop-live2d-pet.md)
