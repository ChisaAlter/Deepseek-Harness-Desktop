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

- Windows 主窗口与启动器使用 `shellWindowChrome` 的不透明原生窗口策略，DWM 负责外框圆角、阴影和最大化/最小化/还原过渡。页面收到 `nativeFrame` 状态后铺满客户区，移除第二层外轮廓裁切与缘线；内部内容角和壁纸仍用原有 token。非 Windows 保留透明自绘剪影，只有登记过的透明窗使用几何最大化与 `_dshNormalBounds` 还原。详见 [window-motion](../../features/window-motion.md) 和 [恢复原生动画决策](../../decisions/implemented/bug-fix/2026-09-29-native-window-motion.md)。注入自愈继续覆盖 eval retry、导航/focus/show 与页面 MutationObserver。
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

- Windows：`node scripts/run-window-motion-qa.mjs` 检查真实工厂 HWND 样式和 IPC；可见动画在交互桌面逐帧验收。

- QA：`TC-WS-002` … `TC-WS-004`；`TC-SURF-007`；`TC-DESK-010`（Codex 宠物）、`TC-DESK-011`（Live2D 宠物）

## 延伸阅读

- [design-language.md](../../design-language.md)；卡片：[desktop-pet](../../features/desktop-pet.md)、[desktop-live2d-pet](../../features/desktop-live2d-pet.md)
