# Feature: 鲸屿侧栏品牌

| Field | Value |
| --- | --- |
| **id** | `desktop-branding` |
| **status** | `active` |
| **last verified** | 2026-09-25 — 品牌测试 7/7、官方 profile 客户端/Web 构建、头像副本哈希一致且 Web 静态资源返回 200 |

## User paths

1. 在桌面应用或 Web 展开侧栏时，左上角显示透明鲸鱼娘头像，同排「鲸屿 / WHALE ISLE」，下一行显示「BASED ON DEEPSEEK HARNESS」。
2. 收起侧栏时，展开按钮直接显示面板图标；悬停与点击行为不变。
3. 切换浅色、深色主题时，文字与蓝色「屿」随主题 token 变化，头像保持透明原图。

## Invariants

- 侧栏头像复用 `assets/whale-head.png` 的透明图像，不显示方形底板。中文「鲸屿」为主，第二字为品牌蓝；英文位于同一标题行，完整「BASED ON DEEPSEEK HARNESS」来源说明位于下一行且始终可读。
- 桌面壳与 Web 的官方构建共用鲸屿侧栏品牌槽位；聊天首屏品牌和应用图标保持原有契约。
- 两端侧栏仍使用已有的品牌槽位、标题栏拖拽与新建会话行为。明暗颜色只在 `ui-theme` 主题 token 表定义。

## Allowed touch

- `docs/design-language.md` / `docs/design-language.en.md`、本卡与索引、品牌决策记录和对应翻译 sidecar — 品牌合同。
- `vendor/deepseek-harness/packages/client/ui-brand-official/` — 桌面品牌槽位内容及测试。
- `vendor/deepseek-harness/packages/client/ui-sidebar/src/client/SidebarRoot.module.css` — 调整字标行高及收起态面板图标。
- `vendor/deepseek-harness/packages/client/ui-theme/src/styles/design-platform.css` — 深浅色品牌强调 token。
- `vendor/deepseek-harness/apps/web/public/whale-isle-head.png` — 桌面与 Web 共用的透明头像副本。
- `docs/handbook/modules/design-and-spine.md` — 当前态入口。

## Do not touch

- 安装器、窗口/任务栏/托盘图标，启动页及聊天首屏品牌。
- 侧栏导航与标题栏交互。

## Gates

| Kind | What |
| --- | --- |
| Automated | 品牌组件定向测试、官方客户端构建、`npm run check:governance`、`npm run doc-sync` |
| Manual / QA | 桌面与 Web 侧栏展开/收起、浅色/深色、标题栏拖拽和新建会话 |

## Sources

- Design: [DSHD 设计语言](../design-language.md)
- Decision: [统一鲸鱼品牌资源](../decisions/implemented/product/2026-09-18-whale-brand-assets.md)
- Implementation entry: `vendor/deepseek-harness/packages/client/ui-brand-official/src/client/Brand.tsx`
