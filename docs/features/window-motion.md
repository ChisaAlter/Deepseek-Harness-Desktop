# Feature: Windows 原生窗口动画

| Field | Value |
| --- | --- |
| **id** | `window-motion` |
| **status** | `active` |
| **last verified** | 2026-09-29 — 定向测试 54/54、两工厂 HWND/IPC 门禁通过；8 份逐帧图确认四种原生过渡，重启后的 Harness 原生最大化/还原与外缘已验证；全量 2815 通过/2 跳过/1 既有远程文案失败；见验证记录 |

## User paths

1. 主窗口（启动画布和 Harness）与启动器点击最大化、还原、最小化，任务栏恢复，均使用 Windows 原生窗口行为。
2. 系统关闭动画时尊重系统设置；恢复后尺寸、窗控图标和页面边缘同步。

## Invariants

- Windows 两个壳窗必须是不透明原生窗口：`transparent: false`、`thickFrame: true`、`roundedCorners: true`。不以透明分层窗换取自绘外框圆角。
- 外轮廓、阴影和窗口动画归 Windows；页面绘制到原生裁切边缘，内部 20px 圆角、壁纸与透明主题不变。透明主题指页面表面，不代表操作系统窗口透明。
- 最大化与还原必须改变原生 `isMaximized()`，不得仅以 `setBounds()` 或几何覆盖充当 Windows 壳窗最大化。
- 桌宠及透明覆盖层保留自己的窗口类型；非 Windows 保留现有剪影路径。不得改系统动画偏好。
- 上游同步、圆角/启动页重构和 Electron 升级都必须运行本卡门禁；状态测试不替代真实动画播放验收。

## Allowed touch

- `src/main/window.js`、`src/main/chrome.js`、`src/main/harness-chrome-inject.js` 及对应窗口测试。
- `src/renderer/boot.css`、`src/renderer/launcher.css`、`src/renderer/window-controls.js` — 原生外缘适配。
- `scripts/` — 独立 Electron 窗控回归；`.github/workflows/test.yml` — Windows 门禁。
- `AGENTS.md`、`docs/`、`.cursor/rules/` — 设计、手册、决策、QA 和同步维护约束。

## Do not touch

- 桌宠透明窗口、系统动画设置、DSH 内部布局、会话和用户数据。

## Gates

| Kind | What |
| --- | --- |
| Automated | `node --test src/main/chrome-theme.test.js src/main/window-marketplace.test.js src/main/shell-silhouette-radius.test.js`；Windows：`node scripts/run-window-motion-qa.mjs`；`npm test` |
| Manual / QA | 主窗口与启动器最大化/还原、最小化/任务栏恢复；浅深色、壁纸、系统动画开关；见 [QA](../qa/production-acceptance-test-cases.md) |

## Sources

- Decision: [原生窗口动画与防复发](../decisions/implemented/bug-fix/2026-09-29-native-window-motion.md)
- Design: [设计语言](../design-language.md)
- Handbook: [窗口与 Chrome](../handbook/modules/window-chrome.md)
- QA: [2026-09-29 验证记录](../qa/results/2026-09-29-window-motion/README.md)
- Implementation entry: `src/main/window.js`、`src/main/chrome.js`
