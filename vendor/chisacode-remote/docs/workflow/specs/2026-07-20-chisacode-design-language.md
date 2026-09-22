# ChisaCode Design Language

> 产品形态已定：默认是**对话工作台**，不是全能 IDE。  
> 右栏环境能力默认隐藏，按需打开。  
> 视觉真值：本文件 + `docs/design.md` 性格；颜色主题可继续 web3 token。  
> **Craft 参考**：WorkBuddy 一类「软表面 / 大留白 / 居中空态 / 悬浮输入卡」。  
> **不复刻**：ZCode 密对话壳、WorkBuddy 的任务/空间 IA、任何竞品皮肤 1:1。

## 1. 产品一句话

ChisaCode 是 **自托管的多 provider 智能体开发环境**：在真实 project / workspace 上运行、监视、对话 coding agents，并在需要时展开 terminal、browser、git 与分屏。

界面的任务是让用户：

1. **找到**正确的 project / session
2. **读懂** agent 在做什么
3. **写入**下一条指令
4. **按需**打开工具面（git / terminal / browser / split）

不是让用户一打开就面对 IDE 工具墙，也不是做成另一款「密聊 + 左栏任务 App」。

## 2. 性格（Character）

沿用 `docs/design.md`，并明确 **Soft Workbench** 取向：

| 词            | 含义                                        |
| ------------- | ------------------------------------------- |
| **Soft**      | 软灰底、白/浅卡片、大圆角；阴影只给浮起的卡 |
| **Spacious**  | 空态居中、呼吸感强；宁松勿挤                |
| **Quiet**     | 静止态几乎无硬工具条；动态才出现状态色      |
| **Confident** | 少层级、少描边堆叠；不靠高饱和装饰          |

规则：**应用保持冷静与松弛，用户的工作可以嘈杂。**

### 2.1 借与不借

| 向 WorkBuddy 借              | 明确不抄                  |
| ---------------------------- | ------------------------- |
| 软背景 + 内容区一体          | 任务 / 空间 / 技能广场 IA |
| 空态大标题 + 分段 + 大输入卡 | 吉祥物 / 运营位体系       |
| 侧栏浅选中、轻列表           | ZCode 式密双栏对话壳      |
| 输入区大圆角悬浮卡           | IDE 厚 tab 墙 + 常驻右栏  |

## 3. 真实功能地图（设计必须覆盖）

设计语言按 **能力层** 组织，而不是按竞品截图。

### 3.1 导航层 · Left rail（对齐 `left-sidebar.tsx`）

| 能力                      | 默认可见                 | 源码 / 文案                                                                                                       |
| ------------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| **所有会话**              | 是（顶行标题按钮）       | `sidebar.allSessions` → sessions 路由                                                                             |
| **搜索**                  | 是（顶行图标）           | Command Center                                                                                                    |
| **收起/展开侧栏**         | 是（壳层固定控件，桌面） | Soft 对齐 T3 `SidebarTrigger`：`DesktopSidebarControl`（`desktop-sidebar-control`）；展开时侧栏顶行不再重复 close |
| **新对话**                | 是                       | **唯一主 CTA** `sidebar.newConversation`                                                                          |
| Project → session 列表    | 是                       | `sidebar-session-list`                                                                                            |
| Host 切换                 | 是（footer）             | Host picker + 状态点                                                                                              |
| **打开项目**              | 是（footer 图标）        | `sidebar.addProject` / FolderOpen                                                                                 |
| **主页**                  | 是（footer 图标）        | `sidebar.home` / House                                                                                            |
| **设置**                  | 是（footer 图标）        | `sidebar.settings` / Settings                                                                                     |
| Pin / archive / rename 等 | 否（hover / 菜单）       | session / project menus                                                                                           |
| 导入会话                  | 否\*                     | workspace 更多菜单等                                                                                              |

主 CTA 收束为「新对话」；**footer 三图标与 Host 不可从原型中抹掉**——那是真实产品能力。

### 3.2 工作面 · Center

| 能力                                                  | 默认可见 | 视觉角色                               |
| ----------------------------------------------------- | -------- | -------------------------------------- |
| 当前 session 标题                                     | 是       | 单层 topbar 主文案                     |
| Workspace 名 / branch                                 | 是       | 轻量 context control                   |
| Agent 消息流                                          | 是       | **主阅读面**                           |
| Composer（附件 / provider·model / 权限·voice / send） | 是       | **完整 pen bar**，永不裁切             |
| Tab 行（agent / terminal / browser / file / setup）   | 否\*     | 有多 tab 时再出现；默认单会话无 tab 墙 |
| Split panes                                           | 否\*     | 用户主动分屏后出现；默认单 pane        |
| Explorer sidebar                                      | 否       | 顶栏入口唤起                           |

\*能力保留，默认不铺 chrome。

### 3.3 环境层 · Right / overlay

| 能力                          | 默认可见 | 视觉角色        |
| ----------------------------- | -------- | --------------- |
| Git 状态 / diff / commit·push | 否       | 顶栏入口 → 面板 |
| PR / GitHub                   | 否       | 环境面板 tab    |
| Tasks / todos                 | 否       | 环境面板 tab    |
| Subagents                     | 否       | 环境面板 tab    |
| Browser context               | 否       | 环境面板 tab    |

### 3.4 系统层

| 能力                                              | 入口                 |
| ------------------------------------------------- | -------------------- |
| Settings（hosts / providers / theme / shortcuts） | 侧栏 footer 或路由   |
| Import session                                    | 菜单 / 空态次级动作  |
| Voice / dictation                                 | Composer 控件行      |
| Multi-host daemon                                 | Footer host combobox |

## 4. 桌面默认拓扑（两态一体）

### 4.1 Home / 空工作台（优先观感）

主区是 **居中 hero**，不是顶满的对话壳：

```
┌─────────────┬─────────────────────────────────────────┐
│  NAV soft   │                                         │
│  brand      │          ChisaCode                      │
│  新建对话    │          你的多智能体工作台               │
│  (唯一主CTA) │     [日常开发] [代码审查] [重构]          │
│             │     快捷 chips                          │
│  projects   │     ┌─────────────────────────────┐   │
│  └ sessions │     │  大圆角悬浮 COMPOSER 卡      │   │
│             │     │  文本 + workspace/model/send  │   │
│  user·host  │     └─────────────────────────────┘   │
└─────────────┴─────────────────────────────────────────┘
```

侧栏不再堆「全部会话 / 打开 project / 导入会话」等并列入口。

### 4.2 Session / 有对话

同一套软表面，composer **同一组件**从中央落到钉底：

```
┌─────────────┬─────────────────────────────────────────┐
│  NAV        │  轻 session bar（标题 · ws · branch）    │
│             │  阅读流（文档感，非气泡墙）                │
│             │  ─────────────────────────────────────  │
│             │  同款悬浮 COMPOSER 卡（钉底、完整可见）   │
└─────────────┴─────────────────────────────────────────┘
```

环境面板按需从右侧推入（约 260–280），与 nav / surface 同一 craft；不是另一套硬 IDE dock。

### 禁止的默认态

- ZCode 式「密顶栏 + 密消息 + 窄 pen bar」作为唯一语言
- 常驻右栏 inspector / 厚 tab 墙
- 中栏硬边多卡片堆叠、多条抢戏分隔线
- 侧栏做成任务广场 / 技能中心等非 Chisa IA

## 5. 设计 token 纪律

实现真值仍在 `packages/app/src/styles/theme.ts`。工作台额外约定：

### 5.1 表面角色（Surface roles）

| 角色       | 用途                   | Token 意向                                      |
| ---------- | ---------------------- | ----------------------------------------------- |
| `canvas`   | 窗口最底层             | `surface0` / workspace bg                       |
| `nav`      | 左栏                   | 略区别于 canvas 的 `surfaceSidebar` 或同色+分隔 |
| `read`     | 消息阅读面             | 与 canvas 同族，避免「卡片浮在底上」            |
| `chrome`   | topbar / 窄工具条      | 与 read 同色 + 底部分隔线                       |
| `panel`    | 环境面板、explorer     | 同 nav 或 read，一侧 border                     |
| `elevated` | menu / popover / modal | 唯一允许 shadow 的层                            |

**静止 chrome 禁止 shadow。** Shadow 只给真正浮起的层。

### 5.2 圆角（Soft 取向，略大于密 IDE）

| 语义             | 建议 px | 用途                       |
| ---------------- | ------- | -------------------------- |
| Control          | 8       | 图标按钮                   |
| Chip / row       | 10–12   | 会话行、nav 项、小按钮     |
| Composer / panel | 16–20   | **主输入卡**、空态大卡     |
| Pill             | full    | 分段、发送键、context chip |

同一语义全 app 一致；禁止 chrome 魔法数散落。

### 5.3 表面与阴影

- 壳：`shell` 软灰；侧栏略同色或略深
- 浮卡：`surface` 白/浅 + **轻 shadow**（composer、选中会话、文件卡）
- 静止 nav / 阅读底：**无**重 shadow
- 阴影是「浮起」信号，不是每个控件都加
- **钉底 pen-bar（composer）**：短接触影，默认  
  `0 1px 2px rgba(20,23,31,0.04), 0 4px 12px rgba(20,23,31,0.06)`  
  禁止长拖影（旧 `--shadow-composer` 的 `0 14px 36px` 已弃用）

### 5.4 分隔

- Home 空态：主区 **尽量无横线**，靠留白分区
- Session：session bar 可用极弱分隔或不分割线
- Nav|Main：1px 软 border 即可
- 列表内：间距 + hover，不逐行描边

### 5.5 字号与字重

| 角色         | 字号          | 字重                  |
| ------------ | ------------- | --------------------- |
| Home 主标题  | 28–40         | bold / 650+           |
| Home 副标题  | 22–32         | semibold              |
| 消息正文     | 14–15 / lh 22 | normal                |
| 侧栏会话标题 | 12.5–13.5     | normal；选中可 medium |
| 结构标签     | 12            | medium + muted        |
| Session 标题 | 14            | medium                |
| Meta         | 11–12         | faint                 |
| 控件标签     | 12–13         | normal                |

Home 允许大标题；工作态仍靠 **foreground / muted / faint**，不靠乱放大。

### 5.6 间距节奏

- Home：垂直呼吸大（标题区与输入卡之间 16–24）
- 控件簇内部：4–8
- 会话行：舒适可扫读，不为塞行而压扁
- **阅读列 / pen-bar 同宽**：硬顶  
  `WORKBENCH_ASSISTANT_MESSAGE_MAX_WIDTH`（当前 **800**）  
  `ConversationAspectColumn` 与消息列共用该 token
- 桌面会话宿主左右 inset **20**（`conversationAspectHostDesktopInset`）；  
  **composer 桌面不再叠一层 28px 水平 padding**——水平边距只由宿主/Home 容器承担，  
  避免输入卡比正文更窄
- Compact：`.m-composer-wrap` 仍可保留 12 水平内边距

### 5.7 颜色语义

| 色                    | 何时出现                     |
| --------------------- | ---------------------------- |
| `foreground`          | 标题、正文                   |
| `muted / faint`       | 结构标签、hint、meta         |
| 中性实心（近黑/近白） | 发送键；少用 accent 实心抢戏 |
| `ok / warn / danger`  | 状态，不装饰                 |
| Provider 色           | 小点 / 小图标                |

## 6. 组件语法（工作台）

### 6.1 Nav row（会话 / 项目）

```
[ 可选状态点 ]  主标题（一行省略）     弱 meta
```

- 选中：浅 `active` 底，无粗左边框也可；若保留强调条则宽 ≤ 2px
- Hover：露出 pin / archive 等，**默认两枚以内**；更多进菜单
- Project 头：muted + medium，可折叠；不是第二套 toolbar

### 6.2 Home hero

- 居中列 max 与 Session 阅读列一致（`WORKBENCH_ASSISTANT_MESSAGE_MAX_WIDTH`，当前 800）
- 主副标题大气、字重高、字距略收
- 可选 segmented（场景）+ 轻 chips（快捷意图）——文案贴 Chisa 场景，不抄办公/设计分类
- **主交互是大 composer 卡**，不是第三导航
- Soft Home 容器水平 inset 与会话宿主对齐（当前 20）

### 6.3 Session bar

高度约 48，尽量轻：

```
[ 标题 ]                    [ workspace ] [ branch ] [ env ] [ ⋯ ]
```

无多 tab 时不渲染 tab 行。

### 6.3a Electron 窗控与侧栏开关（Win/Linux）

- **自定义标题栏**：Win/Linux **不**使用原生 `titleBarOverlay`；  
  Web 绘制 `− □ ×`（`packages/app/src/components/desktop/window-controls.tsx`），  
  与 Soft dimmer 同一层，避免 Command Center 打开时原生按钮露馅/闪色
- 主进程：`titleBarStyle: "hidden"` + `frame: false`；  
  IPC：`window:minimize` / `close` / `isMaximized` / `toggleMaximize` + `resized`
- 几何：3×46 命中区，高度 48 对齐 Soft topbar；  
  `DESKTOP_WINDOW_CONTROLS_WIDTH/HEIGHT` 在 `constants/layout.ts`
- **侧栏开关（T3 壳层常驻）**：桌面 `DesktopSidebarControl` 固定在 App shell（`AppContainer`），  
  展开/收起同一控件（`PanelLeftClose` / `PanelLeft`），不依赖页面 header 挂载；  
  页面 `SidebarMenuToggle` 仅 compact；**折叠时不渲染** 44px 灰底 rail

### 6.4 Message stream

| 角色        | 语法                                 |
| ----------- | ------------------------------------ |
| Assistant   | 文档流，左齐                         |
| User        | 软白卡片气泡（轻 shadow 可选），右齐 |
| File / tool | 同 soft 卡片语法，可折叠             |
| 消息操作    | ghost 图标，低对比                   |

**2026-08-12 决策增补（对抗审查 + 用户实机确认）**：

- **AI 回复上方无标题条**：不渲染 `AI ⚙ 时长` 式 turn header；完成回合 footer 只保留复制按钮，**不显示时长文案**。时长信息属于 T3 风格冗余，用户判定多余。
- **AI 正文排版对齐 T3 阅读 token**：正文 `14 / Math.round(14*1.625) / foreground@80%`（`foregroundSoft` 颜色 token，非容器 opacity），标题阶梯 20/18/16/14，段落与 block 间距 10。门禁：`markdown-styles.test.ts` + 桌面门禁全文本叶断言（禁止 16px 默认黑误报）。

### 6.5 Composer（悬浮输入卡 · 两态共用）

**同一组件**，Home 居中、Session 钉底；结构完整、不可裁切：

```
┌───────────────────────────────────────────────┐
│  多行文本 / 附件 chips                        │
│  [＋] [workspace/模式]   [model ▾] [voice] [↑] │
└───────────────────────────────────────────────┘
```

- 圆角 16–20，白/浅底 + 轻 shadow
- focus：淡 accent ring
- 控件行稳定可见（约 32–36 靶高）
- 发送：圆形中性实心
- Home 下卡下可跟 1 行次要 foot chips（打开 project / 导入 / host）

### 6.6 Environment panel

- 宽约 260–280，按需
- 顶：Git / PR / Tasks / Subagents / Browser
- 内：soft 卡片 + row，与 Home/Session 同族
- 关闭与顶栏 toggle 同步

### 6.7 Tabs & splits（能力保留）

- **0–1 tab**：不渲染 tab 行
- **≥2 tabs**：轻 tab（~32–36），无立体标签墙
- Split：1px 分隔；pane 内复用 reading + 同款 composer 卡

## 7. 状态与动效

| 状态         | 表达                                    |
| ------------ | --------------------------------------- |
| Agent 运行中 | 小点 / 细进度，不闪整行                 |
| 未读         | 标题 weight 或小点，不整行高亮块        |
| 连接断开     | footer 文案 + 可选 banner；不重绘整个壳 |
| Hover        | 120–160ms 级背景过渡即可                |
| 面板开关     | 宽度或 overlay；避免弹跳弹簧过度        |

**Hover 长期不变量（2026-08-12）**：

- **Hover 只允许背景反馈，禁止改变行内容/布局**（文字、图标、操作按钮均不得因 hover 出现/替换）。
- 侧栏**选中行 hover 背景必须不变**（选中填充是稳定 chrome）；未选中行可正常变灰。
- 状态卡片**无行内 hover 操作按钮**——Settle/Snooze 只在右键菜单；T3 式 hover 露出按钮曾替换状态标签导致行跳动，已删除。
- 门禁：`workbench-fidelity-style-boundaries.test.ts`（负面源码断言）+ `desktop-selected-hover-stable.script.ts`（打包 Electron：选中 hover 背景/透明度不变、无 settle/snooze 按钮出现）。

## 8. 跨端与多表面（对齐真实导航模型）

| 表面             | 真实模型                                  | Soft 表现                                 |
| ---------------- | ----------------------------------------- | ----------------------------------------- |
| Electron 工作台  | 钉侧栏 + workspace                        | Soft shell；env 默认关；footer 三图标保留 |
| Electron 设置    | list/detail · `SIDEBAR_SECTION_ITEMS`     | 左 ~240 / 右 ~720 card-row                |
| Compact 会话     | **抽屉侧栏** + 全屏 agent/workspace       | 轻顶栏 ☰；钉底输入卡；无底栏 Tab         |
| Compact 抽屉     | 同桌面侧栏能力 + **当前焦点快捷操作**     | resume / 变更 / 终端 / 所有会话 / 关闭    |
| Compact 所有会话 | `/h/[serverId]/sessions`                  | Agent 列表 + load more                    |
| Compact 设置     | 全宽 list → push detail；隐藏 desktopOnly | 分区 slug 与桌面一致                      |
| Web              | 同桌面                                    | 收紧窗控 padding                          |

手机**没有**「主页 / 会话 / 设置」底栏——那是错误臆造。入口来自抽屉 footer 与路由。

设置分区（`settings-screen.tsx`）：  
`general` · `models` · `usage` · `skills` · `mcp` · `shortcuts*` · `integrations*` · `permissions*` · `diagnostics` · `feedback` · `about`  
（`*` = `desktopOnly`）另有 hosts / projects 独立路由。

Workspace 更多菜单能力（`workspace-header`）：新建智能体/终端/浏览器、Git dock、浏览器上下文、导入会话、复制路径/分支、Setup 等。

可交互示意：`design/chisacode-surfaces-soft.html`（code-faithful）。

验证：桌面 Electron；移动真机/模拟器；**Web 不替代。**

## 9. 与历史文档的关系

| 文档                                                                | 关系                                                    |
| ------------------------------------------------------------------- | ------------------------------------------------------- |
| `docs/design.md`                                                    | 性格与组件复用总则；本文件是工作台应用层                |
| `design/web3-themes-v2.html`                                        | **配色参考**，不再是布局拓扑真值                        |
| `docs/workflow/specs/2026-07-15-workbench-visual-rebuild-design.md` | 历史紧凑复刻；与 Soft Workbench 冲突处以 **本文件为准** |
| `design/chisacode-design-language.html`                             | Soft Workbench 可交互示意（Home + Session）             |
| `design/chisacode-surfaces-soft.html`                               | 桌面使用中/设置 + 手机主页/会话/设置                    |
| WorkBuddy 空态截图                                                  | craft 参考（松/软/大输入卡），非 IA 真值                |

## 10. 落地切片（工程）

| 阶段    | 目标                                                         | 主要触点                                                           |
| ------- | ------------------------------------------------------------ | ------------------------------------------------------------------ |
| **P0**  | Soft shell：中栏软底、去 IDE 硬边；环境默认关                | `workspace-center-column`、surface roles、env 默认                 |
| **P1**  | Home 空态：居中 hero + 大 composer 卡                        | `new-workspace-screen`、草稿空态                                   |
| **P2**  | Session：轻 bar + 同款钉底 composer 卡；消息 soft 阅读       | `composer/*`、`message.tsx`、header                                |
| **P3**  | 侧栏 soft 列表：仅「新建对话」+ project/session 树           | `left-sidebar`、`sidebar-session-list`                             |
| **P4**  | tab/分屏/env 按需；token 圆角阴影扫尾                        | tabs row、environment panel、layout tokens                         |
| **P2′** | 阅读列/pen-bar 同宽（800）、短 composer shadow、自定义标题栏 | `conversation-aspect-column`、`composer/*`、desktop window-manager |

每阶段验收：**真实 Electron** 默认主题下，用第 11 节清单过一遍。

## 11. 精致验收清单

**Home 10 秒：**

1. 是否感觉 **松、软**，而不是密 IDE / 密 ZCode？
2. 第一眼是否落在 **大标题 + 大输入卡**？
3. Composer 是否完整（文本 + 控件行），无裁切？

**Session 10 秒：**

4. 是否仍像同一产品（同圆角/阴影/输入卡），只是进入阅读态？
5. 侧栏是否是 **project/session**，不是任务广场？
6. 无多 tab 时是否没有 tab 墙？
7. 环境面板默认是否关闭？

任一项为否 → 先修语法，再加功能入口。

## 12. 非目标

- 像素级复刻任何第三方 App
- 为截图引入演示数据或假壳
- 用 Web 验收代替 Electron / Android
- 一次 PR 重写全部 agent 协议或 provider

## 13. 项目名显示约定（2026-08-12）

- **所有项目相关 UI 只显示 repo basename，禁止 `owner/repo` 形态**：状态卡片项目名、状态视图"所有项目" scope 下拉、by-project 组标题、项目设置对话框。
- GitHub remote（`remote:github.com/owner/repo`）一律短化为 `repo`（`deriveProjectName` / `deriveProjectDisplayName` / `shortProjectName`）。
- 门禁：`agent-grouping.test.ts`（deriveProjectName/DisplayName 短名断言）、`projects.test.ts`（shortProjectName）、`sidebar-status-view.test.tsx`（scope 下拉短名渲染）、`workbench-fidelity-style-boundaries.test.ts`（status 卡片必须调用 `shortProjectName`）。

---

**维护：** 新增工作台 UI 时，先在本文件的功能地图与组件语法中归类；无法归类则先补语言，再写样式。
