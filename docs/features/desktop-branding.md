# Feature: Whale Isle 应用品牌

| Field | Value |
| --- | --- |
| **id** | `desktop-branding` |
| **status** | `active` |
| **last verified** | 2026-09-25 — 已恢复定稿的中文主字标及原字号，仅应用其他入口使用英文主名；品牌与侧栏定向测试 25/25、官方 profile 完整构建、`check:governance` 与 `doc-sync` 通过。桌面应用已重启。 |

## User paths

1. 在桌面应用或 Web 展开侧栏时，左上角保持已定稿的字标：透明鲸鱼娘头像、同排以「鲸屿」为主和「WHALE ISLE」为辅，下一行显示「BASED ON DEEPSEEK HARNESS」。
2. 收起侧栏时，左上角展开按钮显示同一透明头像；悬停或键盘聚焦时切换为面板图标，点击仍展开侧栏。
3. 切换浅色、深色主题时，文字与蓝色「屿」随主题 token 变化，头像保持透明原图。
4. 窗口、启动器、安装器、快捷方式、托盘、Web/PWA 与手机伴侣界面统一显示 Whale Isle；已有配置和会话继续从原数据目录读取。

## Invariants

- 侧栏头像复用 `assets/whale-head.png` 的透明图像，不显示方形底板。沿用既有字标比例与顺序：中文「鲸屿」为主，第二字为品牌蓝；英文「WHALE ISLE」位于同一行作为辅字，完整「BASED ON DEEPSEEK HARNESS」来源说明位于下一行且始终可读。
- `appId`、仓库名、包名与数据目录路径保持稳定；安装与更新识别旧版 Deepseek-Harness-Desktop 资产及可执行文件。
- 收起态只保留头像作为左上角品牌标记；它仍是既有展开按钮，保留可访问名称、快捷键与焦点反馈。展开态右上角的收起按钮继续显示原面板图标，不放头像。桌面标题栏与普通 Web 侧栏使用同一收起态。
- 桌面壳与 Web 的官方构建共用鲸屿侧栏品牌槽位；聊天首屏品牌和应用图标保持原有契约。
- 两端侧栏仍使用已有的品牌槽位、标题栏拖拽与新建会话行为。明暗颜色只在 `ui-theme` 主题 token 表定义。

## Allowed touch

- `docs/design-language.md` / `docs/design-language.en.md`、本卡与索引、品牌决策记录和对应翻译 sidecar — 品牌合同。
- `vendor/deepseek-harness/packages/client/ui-brand-official/` — 桌面品牌槽位内容及测试。
- `vendor/deepseek-harness/packages/client/ui-sidebar/src/client/SidebarRoot.tsx` / `SidebarRoot.module.css` 及定向测试 — 收起态品牌标记、展开按钮和行高。
- `vendor/deepseek-harness/packages/client/ui-theme/src/styles/design-platform.css` — 深浅色品牌强调 token。
- `vendor/deepseek-harness/apps/web/public/whale-isle-head.png` — 桌面与 Web 共用的透明头像副本。
- `docs/handbook/modules/design-and-spine.md` — 当前态入口。
- `package.json`、`electron-builder.launcher.yml`、`build/installer.nsh`、`scripts/render-installer-assets.js`、发布工作流及资产校验 — 打包显示名和发行资产。
- `src/main/`、`src/main-launcher/`、`src/launcher/`、`src/renderer/`、`src/shared/product-identity.js` 中的产品显示名及旧安装兼容；`scripts/prestart-ensure.mjs`、`scripts/measure-whale-runtime.ps1`、`vendor/deepseek-harness/scripts/client-build-environment.ts`、Web manifest 与相关测试 — 官方客户端标题。
- `vendor/deepseek-harness/packages/client/ui-settings-{general,account}/`、`ui-plugin-manager/`、`ui-sidebar-documentpreview/` — 应用自有界面的显示文案与相关测试。
- `mobile/web/`、`mobile/android/app/src/main/`、`mobile/app.json` — 手机伴侣显示名。
- `README.md` / `README.en.md`、`.github/release-notes.md` / `.github/release-notes.en.md` — 对外介绍名称。

## Do not touch

- 窗口/任务栏/托盘图标与聊天首屏的 Harness 内容。
- 侧栏导航与标题栏交互。

## Gates

| Kind | What |
| --- | --- |
| Automated | 品牌组件定向测试、官方客户端构建、`npm run check:governance`、`npm run doc-sync` |
| Manual / QA | 桌面与 Web 侧栏展开/收起、浅色/深色、标题栏拖拽和新建会话 |

## Sources

- Design: [DSHD 设计语言](../design-language.md)
- Decision: [统一鲸鱼品牌资源](../decisions/implemented/product/2026-09-18-whale-brand-assets.md)，[对外应用名统一为 Whale Isle](../decisions/implemented/product/2026-09-25-whale-isle-application-name.md)
- Implementation entry: `vendor/deepseek-harness/packages/client/ui-brand-official/src/client/Brand.tsx`
