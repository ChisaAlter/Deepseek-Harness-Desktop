# ChisaCode 全主题字体与 UI 尺寸审查

审查日期：2026-07-16

## 结论

ChisaCode 的五套主题共用同一套布局和字号结构，设置页、欢迎页和项目页的基础层级总体稳定。需要优先修复的问题集中在桌面工作台：环境面板的标签条在 240px 固定宽度内放不下、工作区标签标题发生真实裁切、多个交互目标只有 14-22px，以及大量小字号文本把 `lineHeight` 设成了与字号相同的值。

主题色本身没有引入尺寸分叉，但 `foregroundFaint` 在 Blockchain Light、Cyber Dark、Chisaki、Aemeath 中不适合承载 11-12px 的正文或可操作图标。Liquid Glass 的弱文本对比度反而是五套主题中最稳的一套。

## 最终修复状态

2026-07-16 已完成本文全部桌面 P1/P2 项：环境面板改为五等分图标标签，工作区中文标签最小宽度提升，桌面高频控件统一到 28px 交互框，设置 Switch 调整为 44x28，Composer 输入区最小高度调整为 28px，设置/正文/元数据行高统一到 15/20、13/18、12/16、11/14，并新增 `foregroundSubtleText` 供五主题小号正文使用。Sessions 加入稳定骨架、进度说明和延迟重试，项目详情和文档链接的小型操作也已扩大。

左侧栏已参考 Codex 重构为清晰的“置顶 / 项目”结构：项目目录作为可折叠父级，会话缩进显示，选中态使用安静的整行底色，更多菜单仅在悬停时出现，底部 Host 与常用入口保持固定。

最终真实 Electron 验证覆盖 5 套主题 x 21 个桌面可访问页面，共 105 个组合。连接态矩阵没有运行时错误或页面横向溢出；最终 DOM 指标为 `tinyText=0`、`lowLineHeight=0`。自动统计剩余的裁切仅为明确的标签省略、可滚动 textarea 和脚本命令省略，图表小交互来自 Recharts 内部图元，不是可见按钮。`pair-scan` 是原生移动端路径，不计入 Electron 页面通过数。

最终证据：

- 全页面矩阵：`.qa-tmp/ui-polish-2026-07-16-final2/`
- 首次启动欢迎页：`.qa-tmp/ui-polish-2026-07-16-onboarding/`
- 真实桌面程序：`packages/desktop/release-visual-qa/win-unpacked/ChisaCode.exe`

## 审查范围

- 真实目标：打包后的 Electron 桌面应用，不以 Web 预览代替桌面验证。
- 固定视口：1200 x 800，Windows，中文界面。
- 主题：Blockchain Light、Cyber Dark、Liquid Glass、Chisaki、Aemeath。
- 路由矩阵：5 套主题 x 22 个路由，共 110 次捕获。
- 其中 105 张为目标桌面页面或预期兼容重定向后的稳定页面；5 个 `pair-scan` 路由在 Electron 中重定向到欢迎页，属于原生移动端路径。
- `agent-route` 预期重定向到对应工作区；`settings-root` 预期重定向到通用设置。
- 采集到的渲染器运行时错误为 0，页面级横向滚动为 0。
- 没有发现小于 11px 的文本；11px 文本节点 79 个，主要来自工作台侧栏分组和环境面板元数据。

证据目录：

- 截图：`.qa-tmp/ui-audit-2026-07-16/screenshots/`
- DOM 指标：`.qa-tmp/ui-audit-2026-07-16/metrics/`
- 主题总览：`.qa-tmp/ui-audit-2026-07-16/contact-sheets/`

## 主题总览

### Blockchain Light

![Blockchain Light](.qa-tmp/ui-audit-2026-07-16/contact-sheets/blockchain-light.png)

### Cyber Dark

![Cyber Dark](.qa-tmp/ui-audit-2026-07-16/contact-sheets/cyber-dark.png)

### Liquid Glass

![Liquid Glass](.qa-tmp/ui-audit-2026-07-16/contact-sheets/liquid-glass.png)

### Chisaki

![Chisaki](.qa-tmp/ui-audit-2026-07-16/contact-sheets/chisaki.png)

### Aemeath

![Aemeath](.qa-tmp/ui-audit-2026-07-16/contact-sheets/aemeath.png)

## Findings

### P1-1 环境面板标签条必然越界

工作台环境面板固定为 240px，但同一行放置 Git、PR、Tasks、Subagents、Browser 五个带图标和水平内边距的标签。1200px 宽截图中 `Subagents` 已被截断，`Browser` 完全落到视口外；DOM 指标在全部工作台证据中重复记录这两个标签越界。

![环境面板越界](.qa-tmp/ui-audit-2026-07-16/screenshots/blockchain-light--workspace.png)

源码位置：

- `packages/app/src/constants/layout.ts:16` 固定面板宽度为 240。
- `packages/app/src/screens/workspace/workspace-environment-panel.tsx:1062` 标签容器没有横向滚动或溢出菜单。
- `packages/app/src/screens/workspace/workspace-environment-panel.tsx:1070` 每个标签保留图标、3px gap 和 14px 水平 padding。

建议：保留面板 240px 时改为图标优先加溢出菜单，或根据可用宽度把标签切换为图标模式；不要继续缩小 12px 文本。验收标准是 1200px 和 1000px 桌面宽度下五个入口都可发现、可聚焦、可点击。

### P1-2 小字号行高等于字号，造成真实垂直裁切风险

设置导航的 13px 文本使用 13px 行高，设置行标题 15/15，提示 12/12；工作台标签、环境面板元数据和侧栏分组也大量使用 11/11、12/12、13/13。React Native Web 实测常出现 `scrollHeight` 比 `clientHeight` 多 2px，例如设置导航 13px 文本实际需要约 15px。中文截图暂时不明显，但英文、数字、重音字符和不同系统字体更容易被削顶或削底。

源码位置：

- `packages/app/src/styles/settings.ts:72`
- `packages/app/src/screens/settings-screen.tsx:1950`
- `packages/app/src/screens/workspace/workspace-desktop-tabs-row.tsx:1295`
- `packages/app/src/screens/workspace/workspace-environment-panel.tsx:1087`
- `packages/app/src/components/sidebar-session-list.tsx:1113`

建议建立桌面密度行高 token：11px 元数据至少 14px，12px 文本至少 16px，13px 文本至少 16px，15px 设置标题至少 18px。工作台可以保持紧凑，但不应把行高压到字面框高度。

### P1-3 多个高频交互目标小于 24px，标签关闭按钮还缺少可访问名称

重复出现的实测尺寸包括：工作区标签关闭 18x18、环境设置与关闭 22x22、侧栏分组折叠 165x14、模型选择器和附件按钮高 22px、项目详情信息与菜单按钮 22x22。工作区标签本体有可访问名称，但内部关闭按钮没有独立 `accessibilityLabel`。

源码位置：

- `packages/app/src/screens/workspace/workspace-desktop-tabs-row.tsx:710`
- `packages/app/src/screens/workspace/workspace-desktop-tabs-row.tsx:1323`
- `packages/app/src/screens/workspace/workspace-environment-panel.tsx:1039`
- `packages/app/src/components/sidebar-session-list.tsx:1088`
- `packages/app/src/components/combined-model-selector.tsx:887`
- `packages/app/src/composer/agent-controls/mode-control.tsx:373`
- `packages/app/src/composer/runtime-controls.tsx:425`

建议：桌面可见框最小 24px，高频图标按钮优先 28px；需要保持 18-22px 视觉尺寸时，用稳定的外层点击框或 `hitSlop` 扩到至少 28px。每个关闭、设置、更多、信息按钮都应有独立可访问名称和焦点态。

### P1-4 工作区标签的最小宽度不足以容纳短中文标题

三字标题“你好啊”和“浏览器”实际需要约 39px，但标签内部只剩约 33px，导致即使顶部仍有空间也显示省略。当前 88px 最小标签宽度同时扣除图标、关闭按钮、水平 padding 和多个 gap 后，对 CJK 标题不足。

源码位置：

- `packages/app/src/constants/layout.ts:23`
- `packages/app/src/screens/workspace/workspace-desktop-tabs-row.tsx:825`
- `packages/app/src/screens/workspace/workspace-desktop-tabs-row.tsx:1295`

建议：用实际文本测量结果计算标签宽度，或把带关闭按钮的最小宽度提高到约 100-104px；非悬停标签可以隐藏关闭图标，但关闭按钮出现时不能挤压标题导致布局跳动。

### P2-1 四套主题的 `foregroundFaint` 不适合小号文本

按截图中对应底色计算，弱文本近似对比度为：Blockchain Light 2.56:1、Cyber Dark 3.04:1、Chisaki 3.86:1、Aemeath 2.89:1、Liquid Glass 5.36:1。侧栏 11px 分组标题和折叠图标直接使用该 token，因此前四套主题的可读性明显低于普通文本要求。

源码位置：

- `packages/app/src/styles/theme.ts:185`
- `packages/app/src/styles/theme.ts:385`
- `packages/app/src/styles/theme.ts:412`
- `packages/app/src/styles/theme.ts:741`
- `packages/app/src/styles/theme.ts:773`
- `packages/app/src/components/sidebar-session-list.tsx:687`
- `packages/app/src/components/sidebar-session-list.tsx:1116`

建议拆分 `foregroundFaint` 的职责：装饰线和非文本图形可以保留当前颜色，11-12px 文本改用满足至少 4.5:1 的 `foregroundSubtleText`。不要全局增亮所有边框和装饰。

### P2-2 会话历史页加载期间缺少进度语义和恢复入口

真实 Electron 中会话列表最终能加载，但 QA 数据下约 12 秒后才出现内容；此前主区域只有一个居中转圈。页面没有说明正在加载什么、是否仍在连接，也没有超时或重试入口。

![会话历史](.qa-tmp/ui-audit-2026-07-16/screenshots/blockchain-light--sessions.png)

源码位置：`packages/app/src/screens/sessions-screen.tsx:69`。

建议：首屏使用 4-6 行稳定骨架并保留页面标题；超过 3-5 秒后显示连接状态，超过既定阈值提供重试。这样既减少空白感，也避免用户把长查询误判为卡死。

## 主题差异

| 主题             | 字体与尺寸结论               | 主题特有风险                                         |
| ---------------- | ---------------------------- | ---------------------------------------------------- |
| Blockchain Light | 结构清楚，设置页层级最易扫读 | `foregroundFaint` 对比度最低，11px 分组标题偏淡      |
| Cyber Dark       | 主文本与 muted 文本清晰      | faint 文本和次要图标偏暗，长时间工作更易疲劳         |
| Liquid Glass     | 五套主题中弱文本对比度最好   | 玻璃面板信息密度高时边界较多，但不是尺寸分叉         |
| Chisaki          | 字体层级稳定，强调色明确     | faint 文本仍低于小正文目标，红色强调区域需避免再缩字 |
| Aemeath          | 设置页和欢迎页观感轻盈       | 淡粉侧栏中 faint 文本与边框容易同时变弱              |

## 页面健康列表

| #   | 页面/路由                 | 健康状态   | 主要结论                                                           |
| --- | ------------------------- | ---------- | ------------------------------------------------------------------ |
| 1   | Workspace                 | 需修复     | 环境标签越界、标签标题裁切、18-22px 控件、11-13px 紧行高           |
| 2   | New workspace             | 良好       | 主结构稳定；底部 composer 继承 22px 控件问题                       |
| 3   | Open project              | 良好       | 16px 标题与卡片尺寸清楚，四入口无裁切                              |
| 4   | Sessions                  | 需优化     | 最终内容稳定，但加载阶段可能持续约 12 秒且只有转圈                 |
| 5   | Agent compatibility route | 等价重定向 | 预期进入对应 Workspace，不重复计算视觉问题                         |
| 6   | Settings root             | 等价重定向 | 预期进入 General                                                   |
| 7   | Settings / General        | 良好       | 13px 导航、15px 行标题、54px 行高结构合理；需统一行高 token        |
| 8   | Settings / Models         | 良好       | 空状态和操作区尺寸稳定                                             |
| 9   | Settings / Usage          | 良好       | 指标卡与图表层级清楚；下方操作需通过滚动访问                       |
| 10  | Settings / Skills         | 良好       | 搜索和分段控件清楚                                                 |
| 11  | Settings / MCP            | 良好       | 横向 provider 标签在当前宽度可用                                   |
| 12  | Settings / Shortcuts      | 良好       | 列表密度适中，快捷键值对齐稳定                                     |
| 13  | Settings / Integrations   | 良好       | 多行列表可扫读，按钮尺寸基本充足                                   |
| 14  | Settings / Permissions    | 良好       | 内容少但层级明确                                                   |
| 15  | Settings / Diagnostics    | 良好       | 信息组清楚，操作按钮不拥挤                                         |
| 16  | Settings / Feedback       | 良好       | 两个反馈入口尺寸合理                                               |
| 17  | Settings / About          | 良好       | 信息层级稳定，主按钮清晰                                           |
| 18  | Settings / Host           | 基本良好   | 22px 编辑/信息控件需扩大；异步卡片加载状态可更具体                 |
| 19  | Settings / Projects       | 良好       | 项目列表尺寸和留白稳定                                             |
| 20  | Settings / Project detail | 需优化     | 22px 信息/菜单控件偏小，12px 长命令元数据较密                      |
| 21  | Welcome                   | 良好       | 20/16/14/12px 层级清楚，按钮 420x58，五主题均稳定                  |
| 22  | Pair scan                 | 桌面不适用 | Electron 确定性重定向到 Welcome；需在 Android/iOS 原生环境单独审查 |

## 修复顺序

1. 先补字体行高 token 和交互目标最小尺寸，覆盖设置、工作台、composer、项目详情等共享组件。
2. 修复工作台环境标签条与工作区标签宽度算法，这是当前唯一在 1200px 首屏可直接看到的布局破损。
3. 为四套主题补独立的弱正文颜色 token，保留现有装饰色。
4. 改进 Sessions 的长加载状态和 Host 页异步卡片状态。
5. 在真实 Android 模拟器或设备上补 `pair-scan`、紧凑设置页、工作区标签切换和触控目标验证。

## 验收建议

- 桌面：1000x700、1200x800、1440x900，Windows 100% 与 125% 缩放。
- 所有正常文本不得发生垂直裁切；三字中文标签不应在有可用空间时省略。
- 所有高频桌面交互目标至少 24px，图标按钮优先 28px，并具备键盘焦点和可访问名称。
- 环境面板五个入口在所有桌面宽度下均可发现和访问。
- 普通小文本对比度至少 4.5:1；装饰性图标和边框单独使用弱色 token。

## 证据限制

- 本机没有 `adb`、`ANDROID_HOME` 或 `ANDROID_SDK_ROOT`，因此没有用 Web/Electron 冒充 Android 验收。
- 本轮只验证了 1200x800、默认缩放和中文文案；Windows 125% 缩放、英文长文案、原生移动端、键盘完整遍历和屏幕阅读器仍需后续验证。
- 自动 DOM 统计会把虚拟化或隐藏面板中的离屏节点计入 `offscreenInteractive`，也会把 React Native Web 的 1-2px 文本测量差异计入裁切；报告只采用逐张截图复核后确认的可见问题。
