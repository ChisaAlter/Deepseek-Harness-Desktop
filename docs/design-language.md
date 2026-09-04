# DSHD 设计语言

中文 · [English](design-language.en.md)

DSHD（Deepseek-Harness-Desktop，本仓库的桌面端应用；区别于 `dsh` CLI，也区别于 `src/main` 里的 dshd 守护进程）的设计语言定义在本文档：它是 DSHD 全部可见界面的唯一视觉权威。语言的基线固定为随仓库钉版的 `vendor/deepseek-harness` Web UI——当前钉 `dsh-v0.1.2-rc.1`（`a66e4702047846cdaa10c66c9d3df3951f5ea70d`），记录在 [`vendor/harness-upstream.json`](../vendor/harness-upstream.json)，由 `npm run sync:harness` 更新。桌面壳、关闭遮罩、标题栏注入、右边栏、手机远程打开的 Web UI 页、以及任何新增前端，都实现同一套语言，不得另起一套皮肤。

「与基线一致」不靠主观印象，按三条硬标准判定，全部落在实物上：

1. **同一张 token 表。** 颜色只来自 vendor `ui-theme` 的 [`design-platform.css`](../vendor/deepseek-harness/packages/client/ui-theme/src/styles/design-platform.css) / [`base.css`](../vendor/deepseek-harness/packages/client/ui-theme/src/styles/base.css)；不能 import 主题包的面用同值镜像表：壳层 [`src/shared/dsh-webui-tokens.css`](../src/shared/dsh-webui-tokens.css)（文件头自述与 design-platform.css 同值）、手机 SPA 的 `mobile/web/tokens.css`、Android Compose 的 `DshTokens`。
2. **同一套原语。** 控件复用 [`ui-primitives`](../vendor/deepseek-harness/packages/client/ui-primitives/)：`Button` / `Input` / `Menu` / `Modal` / `Tooltip` / `Switch` / `HoverCard` / `DisclosureRow` / `FlipText` / `usePresence` / `Toast` / `ic_ds_*` 图标（`icons/`）。
3. **同一组数值。** 描边与 hover 透明度、圆角、字号行高、间距、阴影层级以本文档固定值为准（见[强制规则](#强制规则)、[视觉锚点](#视觉锚点)）；这些数值就是从钉版基线蒸馏出的合同。

责任方向是单向的：**先改本文档，再改代码。** `sync:harness` 换钉版只更新代码基线，不自动改设计语言；新基线带来的视觉差异必须先写进本文档裁决，再落到实现。启动页的仪器风只活在 [`src/renderer/boot.html`](../src/renderer/boot.html)，见 [桌面启动页](#桌面启动页)，不得扩散。

改 UI / 布局 / 前端之前先读本文。工程落地细则（CSS Modules、token 分层、动效 recipe）以钉版 vendor 树内的文档为准，本文不重复那份清单：

- Token 源码：[design-platform.css](../vendor/deepseek-harness/packages/client/ui-theme/src/styles/design-platform.css)、[base.css](../vendor/deepseek-harness/packages/client/ui-theme/src/styles/base.css)、[gradient-shadow-text.css](../vendor/deepseek-harness/packages/client/ui-theme/src/styles/gradient-shadow-text.css)、[motion.css](../vendor/deepseek-harness/packages/client/ui-theme/src/styles/motion.css)
- 控件原语：`vendor/deepseek-harness/packages/client/ui-primitives/`（`Button` / `Input` / `Menu` / `Modal` / `Tooltip` / 图标）
- 工程规则：[web-styling.md](../vendor/deepseek-harness/docs/web-styling.md)
- 动效规范与使用对照：[motion.md](motion.md)

## 适用范围

凡改动可见界面，都受约束，包括但不限于：

- `vendor/deepseek-harness/packages/client/**`、`apps/web/**`
- `src/renderer/**`、`src/main/closing-overlay.js`、`src/main/harness-chrome-inject.js`

终端、diff、代码块按基线约定保留等宽、不换行；那是内容排版，不是另做一套 chrome。

## 强制规则

1. **先复用，再绘制。** 按钮、输入、菜单、对话框、Tooltip、开关行，用 `ui-primitives`。不要再造一套圆角、高度、hover。
2. **颜色只走 `--dsw-alias-*` / `--dsw-specific-*`。** 功能 CSS 禁止写 `#hex`、`rgb()`、独立 `--bg` / `--accent`。缺 token 先加主题表，再引用语义别名。
3. **明暗只发生在主题表。** 功能 CSS 不得写 `[data-theme]`、`[data-ds-dark-theme]`、`prefers-color-scheme` 分支。
4. **主色不是电光蓝。** 默认主按钮是近黑（浅色）/ 近白（深色）：`--dsw-alias-button-primary-fill`（浅色即 `rgb(15, 17, 21)`）。品牌蓝是 `--dsw-static-deepseek-500`（`rgb(65, 118, 230)`）及其 alias（`--dsw-alias-button-info-fill`、`--dsw-alias-state-business-primary`），用于信息强调、用户气泡、选中态。禁止 `#2b5cff`、`#6ea8ff`、`#3964fe` 这类平行色板。
5. **描边用透明度，不用实心灰。** 浅色 `rgba(0,0,0,.04/.10/.12)`，深色 `rgba(255,255,255,.06/.12/.16)`，对应 `--dsw-alias-border-l1`～`l3`。栏与栏之间是 1px 发丝线，不是投影卡片墙。
6. **Hover / Active 用交互 token。** 浅色 `rgba(38, 49, 72, .06 / .10)`，深色 `rgba(255,255,255,.08 / .14)`：`--dsw-alias-interactive-bg-hover` / `active`。不要新造一层实心灰底。
7. **圆角按角色。** 主按钮胶囊 18（高 36）/ 小按钮 14（高 28）；输入 8；菜单 12；对话框 24；Tooltip 8；图标点击区 8。不要 6px 方钮；999px 只给胶囊按钮和开关。
8. **字号必须配行高。** 标题 16/24，正文 14/22，紧凑 12/18，Tooltip 13/20。字重 400 / 500 / 600 / 700；Figma 510 渲染为 500。禁止 `font-weight: 650`。
9. **间距是 4 的倍数。** 控件内边距、gap、栏间距用 4 / 8 / 12 / 14 / 16 / 20 / 24。
10. **图标 16px、`currentColor`。** 用 `ui-primitives` 的 `ic_ds_*`。密集标题栏可用 14px。不要引入另一套图标库或彩色填充图标。
11. **动效只动 opacity 和 transform。** 时长走 `--ds-transition-duration*`（100–200ms，flip 400ms）。新对话框 / 菜单用 `usePresence` + `motion.css` recipe。禁止动画 `backdrop-filter` 和大面板宽高，禁止引入动画库。对照与例外见 [动效规范](motion.md)。
12. **阴影只用 lv1 / lv2 / lv3。** 菜单和对话框用 `lv3`；悬浮卡片用 `lv2`；输入条不铺外投影（静止轮廓光 + 发丝描边承担分离）。禁止 `0 18px 40px` 这类重阴影。
13. **毛玻璃止于基线配方。** 遮罩 `blur(2px)`（`--dsw-mask-blur`）+ `--dsw-alias-bg-mask-*`；抬起面用 `color-mix(..., var(--dsw-alias-glass-opacity), transparent)`。不要加更重的 blur，也不要每层都铺投影。
14. **滚动条用共享样式。** 禁止组件内 `::-webkit-scrollbar`。
15. **产品文案中文，代码注释英文。** 不要把 VS Code / Material / iOS 的密度和装饰搬进来压过基线 Web UI。
16. **侧栏品牌跟基线构建。** `setup:harness` 走 vendor 树自带的 `pnpm run build:official`（`DSH_CLIENT_BUILD_PROFILE=official`）。侧栏是基线鲸标 + DeepSeek Harness 字标，不是本地构建回退「DSH 本地构建」。改 client 后也用同一条命令重建，不要单独 `build:lib:client` 把品牌打回本地包。

## 视觉锚点

对照基线自检——基线就是本地 `npm start` 起来的钉版 Web UI，不是记忆或截图里的某个版本：侧栏浅灰蓝底、会话区干净画布、用户气泡淡蓝、发丝分隔、胶囊主按钮、16px 线框图标、菜单 12 圆角 + 轻阴影。新块放进 DSHD 的任何一面时，不应一眼能看出是「另一套产品」。

| 角色 | Token / 几何 |
| --- | --- |
| 画布 | `--dsw-alias-bg-base` |
| 侧栏 | `--dsw-specific-sidebar-fill` |
| 抬起层 | `--dsw-alias-bg-layer-1`～`3` |
| 主文字 / 次文字 / 说明 | `--dsw-alias-label-primary` / `secondary` / `tertiary` |
| 用户气泡 | `--dsw-specific-bubble` |
| 选中行 | `--dsw-specific-sidebar-nav-item-active`（强调用 `*-accent`） |
| 字体栈 | `--dsw-font-family`（系统 UI + 苹方 / 雅黑）；代码 `--ds-font-family-code` |

布局：`AppFrame` 是栏，不是卡片网格。关着的栏宽度为 0 且不画分隔线。标题栏尾簇是 28×28 图标按钮，给窗口控件留出实测避让，不要自绘一套窗口皮肤。右边栏 surface Tab 的关闭控件在标题**右侧**；未经用户明确要求，不要把它挪到左侧。右栏空态的面板选择卡（`ui-surfaces` 的 `EmptyState`）是居中**方块瓷砖**：两列、内宽上限 320、`aspect-ratio: 1 / 1`、间距 8、圆角 12，图标 / 标题 / 描述垂直堆叠居中；不是横向长条卡。

输入条：`InputBar` 胶囊卡（22 圆角）静止态自带整圈轮廓光——`inset 0 0 12px 1px rgba(255, 255, 255, 0.25)`，四条边与四个圆角均匀包裹（inset 光天然跟随 `border-radius`；浅色主题白上加白自然隐形，不写主题分支）。卡片不带外投影（elevation-soft 不上输入条），分离由轮廓光 + 发丝描边承担；壁纸亮部透过玻璃只做环境叠加，轮廓光才是自有合同。运行态思考炫光（beam）叠加在这圈轮廓光之上，静止/运行的层级靠流光对比，不加新色板。壁纸模式下输入条背后不铺座位暗带：输入卡与统计行直接坐在壁纸上，任何带状填充都会读成输入框投下的阴影。

## 允许的例外

- **xterm / diff / 代码**：等宽、ANSI、字符网格，不套胶囊按钮。
- **原生窗口控件**：最小化 / 最大化 / 关闭保持系统命中区；颜色仍跟随当前主题 token。
- **无法 import 主题包的壳层**（远程登录页、手机 Web SPA、Android Compose）：复用同一套语义色和几何。手机 SPA 把 `--dsw-alias-*` 抄进 `mobile/web/tokens.css`；Android 抄进 `mobile/android` 的 Compose `DshTokens` / `Color` 表。都不挂官方 CSS Modules，也不把启动页 `--boot-*` 带过去。禁止再开 `--bg` / `--accent` 平行色板，禁止 Material 默认紫或动态取色覆盖语义表。Git 胶囊上的 Commit / Push / Pull 等 action 标签保持英文。
- **桌面启动页**：整页仪器画布与独立 `--boot-*` 表，详见 [桌面启动页](#桌面启动页)。

## 桌面启动页

启动页是整窗一张仪器画布，不是中间再套卡片，也不是把日志关进带边框的盒子。源文件是 [`boot.html`](../src/renderer/boot.html)、[`boot.css`](../src/renderer/boot.css)、[`boot-tokens.css`](../src/renderer/boot-tokens.css)、[`boot.js`](../src/renderer/boot.js)。

构图：四角 L 形瞄准轨画在视口上；中区垂直居中，依次是 DeepSeek 标志、品牌名 `Deepseek-Harness-Desktop`、状态与说明，失败时出现直角重试与下载日志键。顶栏左侧技术码 `DSH-DESKTOP`，右侧盖章随 `body[data-state]` 切换：启动中 / 就绪 / 停止中 / 异常，对应 BOOT / READY / HALT / ERROR。左下等宽日志铺在画布上，无边框、无底色，长行换行；字号行高 14/22。日志贴底向上堆，底与左侧让开角轨（`--boot-log-inset`），超出高度时裁掉上方旧行，最新行始终完整可见。运行时就绪后，基线客户端插件装载仍留在这张画布上（状态行写 `正在加载插件 n/m`），后台 BrowserView 装完再露出 Web UI，不再切到基线那张「正在加载插件」页。

色与主题：[`boot-tokens.css`](../src/renderer/boot-tokens.css) 是唯一色表。浅色是纸面近黑，深色是 CRT 近白；`--boot-accent` 与正文同色，失败用 `--boot-alert`。`html[data-boot-theme]` 让 [`theme.js`](../src/renderer/theme.js) 只切 `theme.scheme` 的明暗半，不把用户主题的 `bg` / `accent` 写进启动页。[`boot.css`](../src/renderer/boot.css) 只引用 `--boot-*` 与基线字体、动效 token，不写 `[data-ds-dark-theme]` 分支，也不写颜色字面量。

窗口控件仍走 [`window-controls.css`](../src/renderer/window-controls.css)。禁止 NERV / MAGI / SEELE / EVA 商标或官方标志。禁止把 `--boot-*` 用到设置页、关闭遮罩、标题栏或 Web UI。

## 桌面启动器

启动器是冷启动闸门窗，不是仪器画布。源文件是 [`launcher.html`](../src/renderer/launcher.html)、[`launcher.css`](../src/renderer/launcher.css)、[`launcher.js`](../src/renderer/launcher.js)。色表是 [`dsh-webui-tokens.css`](../src/shared/dsh-webui-tokens.css) 的基线浅色 `:root` 与深色 `html[data-ds-dark-theme]`。`html[data-shell-theme=official]` 让 [`theme.js`](../src/renderer/theme.js) 只切 `theme.scheme` 的明暗半，不把 Appearance 壁纸种子写进 `--dsw-alias-*`。禁止 `--boot-*`、`data-boot-theme`，也禁止在 `launcher.css` 里写第二套 `[data-theme]` / `prefers-color-scheme` 色板。

## 现有偏差（不要再扩散）

产品页使用本语言的 token 与 `ui-primitives`。手机远程 Web（`mobile/web`）是文档化例外：抄 `--dsw-alias-*`，不嵌入基线插件树，不用启动页仪器画布。设置里的插件市场是桌面自有包 `ui-settings-market` 的 `settings.section`（id `market`），必须跟设置页基线同一套 token / primitives。用量统计是预置改版 `dsh-usage-panel`（id `usage-stats`），必须跟设置页基线同一套 token / primitives，不沿用上游插件色板。不要再开 `--bg` / `--accent` 平行色板。桌面启动页是文档化的仪器画布例外，见 [桌面启动页](#桌面启动页)，不得扩散。冷启动启动器走基线 token，见 [桌面启动器](#桌面启动器)，不是第二套例外。

## 自检

提交 UI 改动前：

- [ ] 有现成原语却手写了按钮 / 菜单 / 对话框？
- [ ] 功能 CSS 里出现了颜色字面量或第二套 CSS 变量？
- [ ] 圆角、高度、字号行高不在上表？
- [ ] 深色模式写在了组件里？
- [ ] 新弹层没用 `usePresence` / 基线 recipe？
- [ ] 看起来像另一款 IDE 或手机皮肤，而不是钉版基线（`vendor/deepseek-harness` 渲染的 Web UI）？
