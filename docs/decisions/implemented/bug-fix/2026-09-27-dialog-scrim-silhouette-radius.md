# Decision: 壳层确认弹窗的压暗层跟随窗口剪影圆角

Status: implemented

中文 | [English](2026-09-27-dialog-scrim-silhouette-radius.en.md)

## Problem

`ShellConfirmDialog` 的压暗层 `body::before` 是铺满透明子窗的方形 sheet。子窗与父窗同 bounds，四角缺口（壳层剪影 20px 圆角之外的透明区）也被一并压暗：暗色壁纸一侧的缺口被压到与窗内底色几乎同亮度，圆角边界在视觉上消失——任务保护确认、更新询问等壳层弹窗弹出时，暗壁纸一侧的右上/右下角读作直角（用户报障「右上和右下的圆角没了」）。截图像素逐行比对证实剪影曲线其实仍在，是缺口被压暗后与窗内失去对比。

## Decision

压暗层裁剪到与壳层剪影一致的 20px 圆角：`update-dialog.css` 的 `body::before` 加 `border-radius: 20px`，角部缺口保持透明透出桌面，与无弹窗时是同一组像素。父窗「有效最大化」时剪影为直角：`show()` 用 `chrome.js` 的 `isEffectivelyMaximized(parent)` 在 `view` 载荷下发 `maximized`，渲染层置 `html[data-window-maximized]` 使压暗层回到直角；弹窗存活期间父窗 `resize`/`moved` 翻转状态时以同 revision 重推 `view`，渲染层对非更新 revision 只刷新该属性、不重渲染。

## Alternatives considered

- **压暗层保持方形、四角缺口之上叠一条剪影描边** — rejected：描边能让曲线重新可寻，但缺口仍是压暗态，亮壁纸下窗缘矩形暗边依旧可辨，角部像素与正常态不一致，只是遮羞。
- **用 `parent.isMaximized()` 判定直角** — rejected：透明 frameless 窗在 Windows 上按 bounds 假最大化，`isMaximized()` 恒 false；必须走 `isEffectivelyMaximized` 的几何判定，与注入的 `data-window-maximized` 同源。
- **只在 `show()` 时快照一次状态** — rejected：弹窗期间父窗仍可被程序化改 bounds（display-metrics relayout、restore 路径），快照过期会让压暗层与剪影错位；resize/moved 只做状态比对，代价可忽略。

## Consequences

代价：`changed`/`status` 载荷新增 `maximized` 字段（渲染层 `Boolean(state.maximized)` 缺省容错）；压暗层半径与 boot.css、harness-chrome-inject.js 各自持有一份 20px 字面量，第三处同值常量。收益：四角缺口恢复透出桌面壁纸，圆角边界在任意壁纸上可寻；最大化父窗下压暗层保持直角、不留缺口残边。`src/main/update-dialog.test.js` 5 例钉住 radius 规则、maximized 下发与重推路径；同构建 repro（真模块+真渲染文件）截图逐像素确认四角缺口透出未压暗壁纸、剪影边界清晰。
