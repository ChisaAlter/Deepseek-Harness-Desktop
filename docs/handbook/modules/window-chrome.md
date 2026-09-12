# 模块：窗口与 Chrome

## 职责与非目标

**职责：** 主窗口、boot↔harness 切换、标题栏注入、关闭遮罩、窗口控件，以及仅在 Harness ready 时出现的受限桌面宠物浮层。  
**非目标：** 不自绘整套窗口皮肤替代系统控件命中区。

## 用户路径

- 最大化 / 最小化 / 关闭走系统区；主题色跟随 token。  
- 关闭可进托盘（见 [tray-update.md](tray-update.md)）。  
- 标题栏桌面簇（Git 等）由注入 / 官方 slot 承接。

## 架构要点

- `window.js` 管理 Harness BrowserView bounds 与覆盖；`desktop-pet.js` 管理约 80–96px 的宠物 BrowserView、层级、归一化位置和生命周期。宠物在 Harness reveal 后重新置顶，boot/teardown 时移除，不注入 Harness DOM。
- `harness-chrome-inject.js` / `chrome.js` 把桌面 chrome 接到官方页。  
- `closing-overlay.js` 关闭过渡。

## 实现入口

- `src/main/window.js`、`desktop-pet.js`、`chrome.js`、`harness-chrome-inject.js`、`closing-overlay.js`
- `src/renderer/window-controls.css`

## 不变量

- 栏是 `AppFrame`，不是卡片网格。  
- Surface Tab 关闭控件在标题**右侧**。

## 门槛

- QA：`TC-WS-002` … `TC-WS-004`；`TC-SURF-007`

## 延伸阅读

- [design-language.md](../../design-language.md)
