# 设置导航图标收尾计划（第二轮加固）

上一轮计划 `2026-08-27-settings-nav-icons-harden.md` 已勾完，但父级复查发现残留缺口。本计划逐项关闭。

## 服务器图标重绘

- [x] `IconServerOutline16` 移除 path 上的 `transform="translate(...) scale(...)"`，改为原生 16×16 正坐标展开路径。
- [x] 保留 server/rack 语义（两层机架 + 指示点 + 状态条），几何完全落在 0–16 视窗内（旧版经变换后横向溢出视窗）。
- [x] 描边光学重量约 1.3px，与 `IconSkillOutline16` / `IconBrowseOutline16` / `IconDeviceOutline16` 并排一致（对照图 `/opt/cursor/artifacts/server_icon_family_weight_compare.png`）。
- [x] 仅 `fill="currentColor"` 展开路径；根 SVG 维持 `viewBox="0 0 16 16"`、`fill="none"`。

## 无 transform 测试

- [x] `icons.client.spec.tsx` 对全部四个 `settingsNavIconNames` 断言 SVG 内无任何带 `transform` 属性的元素（`svg.querySelector('[transform]')` 为 null）。
- [x] `settings-root.client.spec.tsx` 的 12-id 互异 + 未知回退断言保持通过、不改语义。

## 代码审查结论（Phase 1）

- [x] `NAV_ICONS` 12 个 id（general/interface/appearance/models/agent-presets/plugins/skills/mcp/market/remote/about/usage-stats）映射互异组件，未知 id 回退 `IconSettingsOutline16` —— 无 bug，不改映射。
- [x] 四个新增图标中仅 `IconServerOutline16` 含 path transform；`IconDeviceOutline16` / `IconInfoOutline16` / `IconChartOutline16` 已是原生正坐标路径。plugins 行的 `IconPersonalizationOutline16` 是先于本 PR 的官方 figma extract（自带 transform），不在本次四图标范围内，不动。
- [x] 不触碰 slot API、section id、市场/用量/启动器边界。

## 测试门槛（Phase 3）

- [x] 聚焦：`settings-root.client.spec.tsx`、`icons.client.spec.tsx` 全绿（2 文件 108 用例）。
- [x] `pnpm run test:gui` 全绿（411 files passed、1 skipped；5393 tests passed、4 skipped）。
- [x] 触及源文件 `ui-primitives/src/icons/**` per-file 覆盖 statements / branches / functions / lines 100%。

## 12 分区验证矩阵（Phase 4）

在本机以 Xvfb 启动真实 Electron 桌面端（`node_modules/electron/dist/electron .`，主窗口加载 `http://127.0.0.1:3080` 的组装 Web UI，构建号即本分支 HEAD），经 CDP 走完引导后打开设置面板：

| 分区 | 验证面 |
| --- | --- |
| general / interface / appearance / models / agent-presets / plugins / skills / mcp / about | Electron 桌面端实机可见 |
| market / remote / usage-stats | Electron 桌面端实机可见（preload `window.shell` 真实存在，desktop-usage-panel overlay 真实挂载） |

- [x] 面板 DOM 断言：12 行、12 个互异 SVG、四个新图标 transform 计数为 0、mcp 行 3 条 path。
- [x] 明暗两主题（Appearance → Light/Dark 实际切换）截图：`/opt/cursor/artifacts/settings_nav_12sections_light.png`、`/opt/cursor/artifacts/settings_nav_12sections_dark.png`；导航栏特写 `settings_nav_closeup_light.png` / `settings_nav_closeup_dark.png`。
- [x] 逐行点击 12 个分区的短录屏：`/opt/cursor/artifacts/settings_nav_12sections_walk.webm`。

## 文档（Phase 5）

- [x] Agent Note（中英）同步一句实现事实：四个图标均为原生 16×16 正坐标展开路径、path 无 transform。
- [x] 映射未变 → 不动 handbook 附录、不建 Feature Card、不加 `.cursor/rules`。

## CI 与 PR 就绪（Phase 6）

- [x] 推送 `cursor/unique-settings-nav-icons-cc5b`，HEAD `30f3ff51` 上 Desktop unit tests (windows + macos) + vendor-gui 三项全 SUCCESS（run 33057605173）。
- [x] 历史 `54c3579b` vendor-gui 失败已定位：icons spec 的 TS2722（可能为 undefined 的调用），`fe5b191c` 已修复，非 flake。
- [x] `19523019`（纯文档提交）的 macOS 失败已定位为既有 flake：`git-workspace-watch.test.js`「fires once (debounced)」在 fs.watch（FSEvents 异步起流）武装间隙写入被吞，与本 PR diff 无关；本地 8/8 通过，重跑同树全绿。修 test 属另一 PR。
- [x] 全绿且验证完成，PR #51 达到 ready 标准（本环境无 PR 写权限，置 ready 由上游执行）。
