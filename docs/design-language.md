# DSHD 设计语言

中文 · [English](design-language.en.md)

DSHD（Deepseek-Harness-Desktop，本仓库的桌面端应用；区别于 `dsh` CLI，也区别于 `src/main` 里的 dshd 守护进程）的设计语言定义在本文档：它是 DSHD 全部可见界面的唯一视觉权威。语言的基线固定为随仓库钉版的 `vendor/deepseek-harness` Web UI——当前钉 `dsh-v0.1.3-alpha.1`（`d347e703908d0406b7a7ef80e3a0e594d86b2215`），记录在 [`vendor/harness-upstream.json`](../vendor/harness-upstream.json)，由 `npm run sync:harness` 更新。桌面壳、关闭遮罩、标题栏注入、右边栏、手机远程打开的 Web UI 页、以及任何新增前端，都实现同一套语言，不得另起一套皮肤。

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

已有会话的模型控件在进入或返回会话时自动加载当前选择，不要求先打开模型菜单。发送消息与控件重新挂载不得把已保存的模型显示为「选择模型」；首次同步沿用既有加载文案，目录缺少显示名时沿用 provider/model 标识，不新增控件或改变样式。草稿页行为不变。

消息编辑复用常驻 composer、现有编辑横幅与气泡标记。确认后始终在当前会话重新生成，包括首条消息；侧栏不新增或切换会话，被替换轮次的旧问答从聊天视图移除。取消和失败保留既有草稿恢复与提示样式。

草稿发送转入会话时，常驻输入框连续到达会话位置，不得先贴底再回弹；消息区、统计行与输入框尺寸变化不能暴露中间布局。沿用已有动效时长与缓动，减少动态效果时直接稳定落位，不新增装饰或改变最终布局。

手机远程连接页沿用既有设备状态行与错误行：首次连接及保存设备重连显示「正在连接电脑…」；失败显示「连接失败」，恢复连接按钮并保留已保存设备。不得在连接中继续显示「等待配对」，不得无期限禁用按钮；已连接后的断线自动重连保持不变。

远程 Web 与 Android 共用连接恢复状态：认证后同步目录期间显示同步状态；目录失败在既有抽屉错误行下提供「重试」，不把失败画成空目录。新配对链接取代旧连接尝试，成功后移除 URL 中的一次性 offer；前后台恢复保留草稿并检查连接、重新同步目录与当前会话。沿用现有控件和状态条，不新增独立皮肤。

远程设置的连接方式使用既有分段选择控件，选项命名为「局域网 / 服务器」（英文 LAN / Server）；默认选择服务器，局域网仅作为手动选项。服务器默认中继显示为 `ayase.cn:443`，经 TLS 连接；公网扫码页为 `https://ayase.cn/dshd/`。地址切换只更新既有说明与输入占位，不改变控件布局、配色或配对协议。

插件市场不额外注入 dshbot 第一方推荐卡；目录来源、卡片原语与通用安装管理保持不变。已安装且目录仍收录的插件在发现卡片与「已安装」行内显示版本或提交差异；有更新时复用小号主按钮提供「更新」。更新状态使用正文 / 次文字与既有成功、警告反馈，不新增彩色卡片、独立进度皮肤或第二套弹窗；更新后仍由桌面 HarnessController 重启生效。

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
16. **侧栏品牌跟基线构建。** `setup:harness` 走 vendor 树自带的 `pnpm run build:official`（`DSH_CLIENT_BUILD_PROFILE=official`）；源码 `npm start` 在消费 vendor 产物前也必须确认该官方构建记录，发现旧的普通 `build` 产物时自动补做 official build。侧栏是基线鲸标 + DeepSeek Harness 字标，不是本地构建回退「DSH 本地构建」。改 client 后也用同一条命令重建，不要单独 `build:lib:client` 把品牌打回本地包。

## 独立 dshbot 工作流程

插件拥有的固定会话不使用通用 New Session 品牌首屏。空白 Bot/群聊保留底部输入框与消息画布，标题显示实际 Bot/群聊名称；受管会话顶部只保留该标题以及桌面窗口、侧栏/工作台面板控制，隐藏通用会话的预设标签、轨迹切换、Session 日志下载、Git 分支与 Commit 操作。插件正文可像 Hermes Bots 群聊一样提供自己的成员、设置和解散动作，不把开发会话工具混入机器人工作流。不要求用户重新选择工作区，不另造聊天引擎或装饰卡片。普通会话列表、搜索和 New Session 空白复用排除插件拥有的会话；已绑定会话仍可从插件入口打开。

Bot/群聊输入区复用现有编辑器、附件、发送/停止与主题原语，通过通用的受管输入区展示标记收起独立模型选择、工作区权限快捷选择、计划模式、开发统计和预设标签。模型入口由插件提供，单聊显示机器人配置中的模型并直接打开资料编辑，群聊打开群资料而不显示虚假的统一模型。模型配置唯一归属于机器人资料；未指定时跟随当前应用默认，切换联系人不得写入应用默认。此展示标记不是权限控制，既有工具审批与能力限制仍然生效。参考 Hermes 的共享编辑器和 Bot profile 跟随规则；单一配置入口是针对本产品重复模型入口问题的适配，不声称 Hermes 删除了模型选择器。

受管输入区隐藏开发统计行时仍保留与普通会话统计行等高的底部占位，使输入卡到视口底边的呼吸空间在普通会话、Bot 与群聊之间一致。展开侧栏的一级区域切换占满可用宽度并将选项等分；Bot 页的「联系人 / 任务 / 定时」使用同一 32px 高、8px 圆角、透明静止面与 hover/selected token 的区域切换合同，也占满可用宽度并等分，不再使用内容宽度的独立 Pill 外观。折叠侧栏维持既有圆形纵向导航。

固定 Bot 会话保留同一身份和历史边界；在该会话中执行通用 `/new`、`/reset` 时改为同 Session 压缩上下文，不得创建、切换或复用普通草稿会话，普通会话命令行为不变。Bot 的 `name` 是稳定地址，`title` 是可编辑展示身份；标题为空时回退名称，标题变化同步联系人、会话标题、群成员显示、任务/A2A 可见来源与 Agent 目录，但不得改写 ID、路由或名称唯一性。联系人行的主预览取绑定 Session 的最近安全文本，群聊取最近用户或成员可见消息；模型名只作辅助元数据，不能替代最近活动。后台回复、A2A、任务与定时结果以持久 last-seen 水位产生未读标记，打开对应 Bot/群聊后清除，客户端重启后仍保留，首次启用不得把安装前旧历史误报为新消息。A2A 历史使用真实发送 Bot 的稳定 Session 身份呈现，不退化成无来源注入。群聊主动停止显示 stopped / held，清除待处理交互并抑制不应接纳的晚到回复，不得把用户停止渲染为成员失败；sticky hold 只由后续用户的明确恢复或重新点名解除，普通新消息不得静默释放。

群聊正文采用 Hermes Bots 的 thread 结构而不是普通 DSH 对话记录：底部常驻输入框发送时创建新 thread，展开 thread 内的「回复」动作复用同一常驻输入框、附件上传和提交状态，并继续目标 thread；取消回复恢复进入前草稿和附件。每条用户/成员消息持久归属一个稳定 thread，历史无标记记录只在读取时确定性迁移，不改写原日志。最新 thread 默认展开且不显示无必要的收起命令；较早 thread 折叠为首条摘要、回复数和最近时间，展开后才显示「收起本轮对话」。用户可独立展开/收起这些历史轮次，每个展开 thread 显示完整成员身份、附件、失败/停止/等待交互状态。成员选择、轮次、发言上限、水位、提及接力和迟到结果均按目标 thread 隔离；房间级 held 状态跨 thread 保留。新 thread 不得让旧 thread 的完成结果消失，thread 回复不得带入其他 thread 或私聊历史。Host/桌面端重启后恢复原 thread、原成员调用和原待处理审批/提问，不复制用户消息、成员消息或工具调用。群聊正文通过通用按 Session 选择的 Conversation body 扩展点接入，普通会话仍使用原 Chat View，不为 dshbot 硬编码宿主判断。

群聊的信息层级参考 OpenBot 的多人会话而不是复制其皮肤：宿主会话头部是群名的唯一标题，正文不得再次重复群名和成员数。正文顶部只保留一条无卡片的紧凑参与者栏，以头像表示成员并通过 tooltip / 无障碍名称提供身份和实时状态；设置与解散仍是尾部图标动作。最新 thread 视觉上是一段连续多人对话，不画左侧 thread 轨道；只有显式展开的历史 thread 使用缩进轨道说明轮次边界。成员全部空闲时不铺「空闲」状态行，没有运行活动时也不显示「活动 / 还没有活动」占位。只有成员运行、等待、跳过、失败、停止或运行态加载失败时才显示紧凑状态/活动入口，停止动作与错误必须保持可见。没有正文的 passed / failed / timeout / held / stopped / capped 等成员执行结果归入当前轮次活动区，不得带头像伪装成一条聊天消息；真正的用户和成员发言才进入正文。OpenBot 的 AgentGroup 广播属于向成员分别创建后台任务，不得冒充或替换这里的 Hermes 共享群聊语义。

群聊正文使用 Conversation 已有的 composer-overlay 展示标记：正文高度必须被限制在标题栏与输入区之间，由群聊内部滚动区滚动，最后一条消息、线程操作和活动区不得落在输入框下方或把扩展视图按历史内容撑出视口。插件 body 已接管空白 Session 时，宿主用于普通空会话的占位画布不得继续参与 flex 布局或分走正文高度。已有成员但没有消息的新群沿用 Hermes Bots 的群聊空态语义「说点什么 — 这个群里的每个机器人都会听到。」，不得显示添加联系人或成员数量要求。左栏不重复常驻一块群运行态面板；正常、加载中和无成员运行数据只在群联系人行与群页状态条呈现。只有待审批/提问、成员错误或成员会话缺失等需要处理的状态，才在左栏联系人列表上方展开可操作区域。

完整工作流扩展沿用相同表面：Bot 页增加「定时」Pill，采用可滚动任务行和编辑 Modal，不新增仪表盘。联系人可归入用户创建的命名分组；新增、重命名、排序、折叠、移动和删除均在列表原位完成，删除分组只让成员回到「未分组」并提供限时撤销，绝不删除联系人。筛选菜单复用紧凑 Menu，提供 Bot/群聊、活跃/最近/较早以及真实来源选择；没有多来源注册表时只显示当前来源，不制造虚假网关。列表仍以置顶优先、最近活动次序排列，筛选与分组不能让任一匹配联系人消失。定时编辑使用名称、机器人选择、任务正文、结构化频率选择、启用复选框与可选运行次数上限；频率覆盖一次执行、分钟/小时/天间隔、每天/工作日/每周/每月以及五段 cron 高级输入，展示并持久化实际时区。窄屏下间隔数量、单位和运行次数不得把中文字段名挤成逐字竖排；标签占独立一行，数值与单位在下一行保持稳定网格。行内提供运行、启停、编辑、删除，显示原始计划、下次时间与实际排队/失败状态，不把排队写成执行成功。能力配置在机器人资料中按工具、Skills、MCP 工具分组，以 SettingsSelect 的继承 / 指定模式加复选框选择已发现能力；不可用与已失效项明确呈现。Bot 资料里的管理入口必须调用 Harness 真实的 Skills 安装/启停、工具凭据配置与 MCP 增删/启停/测试/登录能力；Skills 安装面展示公开仓库与精确路径，区分用户/当前项目作用域，执行前确认，禁止静默覆盖，并将 GitHub CLI 缺失、版本不足和冲突错误保留在当前上下文。搜索结果区分可安装、同一 GitHub 来源已安装与本地同名冲突；已安装状态通过技能目录内的持久来源元数据跨重启恢复，同名但来源不明的技能禁止覆盖。若宿主缺少按 Bot 隔离作用域，应明确标为应用级并要求用户确认范围，不能复制一套不生效的假配置。群聊轮数和发言上限使用有界数字输入。任务操作只按真实状态开放：排队可暂停、暂停可恢复、未结束可取消、失败/取消可重新委派；重试和取消先确认，取消记录与停止整个机器人会话不得混淆。停止会话用明确命令和确认，不暗示可撤销已发生的副作用。所有编辑窗、来源与能力列表在 320px 窄屏可滚动且无横向溢出。

群成员需要审批或澄清时，Bot 页的群运行态在对应成员行内直接呈现真实待处理交互，不要求用户离开群聊去寻找隐藏成员会话。审批提供拒绝与单次允许；提问保留完整问题批次、单选/多选、自定义回答、跳过和取消，并调用 Harness pending interaction 自身的 `answer()` / `cancel()` 完成原请求。待处理交互以 Session 日志中的稳定请求 ID 为准；Host 或桌面端重启后重新加载同一请求，回应必须幂等地续接原 turn / step / tool call，不重发用户消息、不复制工具调用，也不把已回应请求重新显示为待处理。对已开始但结果未知的外部工具执行保守失败，不能为恢复而重复副作用。界面不得复制请求、预填未经用户选择的答案或在交互仍等待时显示为已完成；只有真实 pending carrier 不可用时，才显示打开精确成员 Session 的降级入口和明确错误。

独立安装的 dshbot 沿用本语言，不改变桌面默认装配或市场推荐。Bot 页内以同一级区域切换合同切换「联系人 / 任务 / 定时」；任务是紧凑可滚动行列表，搜索与状态筛选使用 Input / SettingsSelect，不铺统计卡片。任务详情复用居中 Modal，展示状态、参与者、任务正文、约束、验收条件、结果或错误、时间与事件记录；参与者会话通过明确按钮打开，不占右侧 surfaces。所有长名称、任务 ID 和正文可换行，窄屏不横向溢出。当前可操作状态只对应 queued / delivered / paused / completed / failed / cancelled，「已送达」不写成「运行中」；旧数据中的 expired 仅作为不可变终态兼容显示，不进入新建、筛选或重试选项。排队可暂停、暂停可恢复、未结束可取消、失败或取消可重试为新的关联任务；界面只展示 Host 已提供真实执行接口的动作。

Bot 编辑资料中的「消息与任务来源」使用 SettingsSelect 选择「默认规则 / 指定机器人」，后者以复选框选已有联系人。默认规则保留现有语义：消息不限制、仅同群成员可委派；指定列表非空时仅列出的机器人可发消息与委派，包括同群成员。列表为空不能冒充拒绝全部。加载、不可用、只读、保存错误及版本冲突使用既有状态文字与错误行，不能伪装成空列表或保存成功。复用现有头像、主题 token、原语和动效，不引入新配色或新侧栏皮肤。

Bot 的确定性形状头像沿用 Hermes Bots 的状态化动态脸：空闲时只做低幅呼吸、轻摆和自然眨眼，绑定 Session 或群成员运行时切换为更明显的姿态、视线与三点工作节奏；联系人当前选中态在头像外增加基于现有边框与业务色 token 的双层环。所有形状头像共用一个最高 15fps 的可见性时钟，窗口隐藏、头像离屏或没有挂载头像时停止更新；`prefers-reduced-motion` 下保持静态。用户上传的图片头像不得拉伸变形，只保留选中环和既有状态点。不得借此恢复头像生成。

机器人资料页中的工具、Skills 与 MCP 能力组保持紧凑：主表单只呈现模式、授权范围、选择摘要和“选择”命令；具体复选框清单在同一套 `Modal` 弹层中编辑。弹层必须可滚动，在 320px 宽度下不得横向溢出；“取消”丢弃本次弹层改动，“完成”仅写回资料草稿，最终仍由资料页“保存”持久化。

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

布局：`AppFrame` 是栏，不是卡片网格。关着的栏宽度为 0 且不画分隔线。标题栏尾簇是 28×28 图标按钮，给窗口控件留出实测避让，不要自绘一套窗口皮肤。右边栏 surface Tab 的关闭控件在标题**右侧**；未经用户明确要求，不要把它挪到左侧。右栏空态的面板选择卡（`ui-surfaces` 的 `EmptyState`）是居中**方块瓷砖**：两列、内宽上限 320、`aspect-ratio: 1 / 1`、间距 8、圆角 12，图标 / 标题 / 描述垂直堆叠居中；不是横向长条卡。工作区文件与产物的主点击留在应用工作环内：HTML / HTM / XHTML / PDF 进入右栏 Browser，其余可读文件进入 Files；Files 工具栏的悬浮文件预览是显式次级动作，系统默认程序仅用于右键命令或工作区权威之外的回退。Files 的悬浮文件预览是单实例、只读、置顶的原生子窗口：保留系统标题栏与关闭命中区，内容面直接使用官方 Web UI canvas / `--dsw-alias-*` token，不套卡片、不引入第二套壳层皮肤；图片、音视频按 contain 居中，文本 / HTML / PDF 占满可滚动内容区，打开下一文件原位替换。Browser 另提供 `dshd mini-player`：它是同一 Browser guest 的 renderer 浮层投影，挂在 `shell.overlay`、限定在聊天可视区内，可拖拽和四边/四角缩放；浮层只迁移 guest 的呈现边界，不创建第二个 BrowserView 或外部窗口。浮层工具条使用现有 `ui-primitives` 图标按钮与 `--dsw-alias-*` 角色色，guest 像素区与拖拽/缩放命中区分离，关闭或恢复后回到原 Browser surface 且保留 URL / history。

输入条：`InputBar` 胶囊卡（22 圆角）静止态自带整圈轮廓光——`inset 0 0 12px 1px rgba(255, 255, 255, 0.25)`，四条边与四个圆角均匀包裹（inset 光天然跟随 `border-radius`；浅色主题白上加白自然隐形，不写主题分支）。卡片不带外投影（elevation-soft 不上输入条），分离由轮廓光 + 发丝描边承担；壁纸亮部透过玻璃只做环境叠加，轮廓光才是自有合同。运行态思考炫光（beam）参照 Libraries.dev Border Beam 的 Rotate / Large / Colorful 层次叠加在这圈轮廓光之上：未滤镜的命中壳在卡边外扩 4px 并继续 `overflow: hidden`，22px stroke / inner 内缩回原卡边，stroke 以 0.6 透明度、inner 以旋转窗口共同形成移动亮区，masked bloom 光源由外层容器以 `blur(8px)` 模糊并以 0.36 透明度进入这圈圆角光晕；4px 小于 composer stack 的 6px 间距，因此不盖住 dock。空会话 Hero 的 workspace / agent-preset 行与输入卡共享实际宽轴：有已保存宽度时读取 `--dsh-composer-resized-width`，否则回退 `--dsh-composer-card-max-width`，整行在 composer stack 内居中，不能留在外层满宽左缘。静止/运行的层级靠流光对比，不加新色板。壁纸模式下输入条背后不铺座位暗带：输入卡与统计行直接坐在壁纸上，任何带状填充都会读成输入框投下的阴影。

思考炫光不是常亮彩色整圈：2px stroke 使用参考实现的旋转 conic 强度窗口，inner 使用同方向的双 conic 窗口，允许尾迹之外透明；移动 filament / bloom 是唯一高亮峰，静态 rim 负责始终完整的四边与四角轮廓。圆角按**整轮经过性**验收：24 个冻结角度内，亮峰必须完整经过四个 22px 圆角弧，经过时与相邻直边连续、没有平切或缺口；同时至少存在暗帧，防止再次退化成整圈等亮霓虹。stroke 保留 `border-radius + 两层 ring mask`，不得叠加第二层 `clip-path` 抗锯齿。

输入卡及其 beam 裁切壳、stroke、inner、bloom 光源明确使用 `corner-shape: round`，不跟随全局 superellipse。各层共用圆弧几何，保证 inset 静止轮廓光可见，并与 inner 的圆弧裁切一致。stroke 升至 2px 以覆盖 100% 缩放下的圆角抗锯齿像素；bloom 光源仍为 1.5px。像素验收必须加载产品全局圆角样式、归一化系统缩放，并额外检查静止轮廓的四角覆盖，不能只检查动态亮峰。

界面设置里的「发送消息时的思考炫光」保留即时开关，并在开关左侧提供 28px 齿轮图标按钮打开官方 `Modal`；Switch 的右边界必须与同组其他设置行共用同一条对齐线，不能因增加齿轮而左移。弹窗只配置这一条运行态 beam：第一批提供顺/逆时针/往返方向、0.8～60s 单圈周期、整体强度、bloom 强度、整体色相、呼吸与色相循环；第二批增加 lounge / aurora / reactive / custom 模式、8 个内置色板或 2～6 个自定义颜色、0.5～4px stroke 宽度、0～12px bloom blur、夜间时段与亮度、缓动、最多 5 个用户预设，以及 v1 JSON 剪贴板导入导出。弹窗内用同一套 beam 图层实时预览，保存时将 active style 与预设库作为一次 `ui-conversation` namespace mutation 写入，取消不改当前值，恢复默认回到现有 1.96s / 原方向 / 原强度 / 原色相的 legacy 视觉基线。模式只是视觉 / 运动 profile，不读取聚焦、输入、发送、完成、失败或其他业务状态，也不扩展为第二套状态灯。

配置允许调整 stroke 的 track width 与 bloom 的 blur，但不得改变 1.5px bloom 光源、4px 裁切壳、22px 圆角、两层 ring mask、pointer-events 或强度窗口；legacy 默认值必须与改动前等价。减弱动效下预览与实际 beam 都隐藏，但设置值保留；移动端继续使用默认时间值，不继承桌面自定义。

## 允许的例外

- **xterm / diff / 代码**：等宽、ANSI、字符网格，不套胶囊按钮。
- **原生窗口控件**：最小化 / 最大化 / 关闭保持系统命中区；颜色仍跟随当前主题 token。
- **无法 import 主题包的壳层**（远程登录页、手机 Web SPA、Android Compose）：复用同一套语义色和几何。手机 SPA 把 `--dsw-alias-*` 抄进 `mobile/web/tokens.css`；Android 抄进 `mobile/android` 的 Compose `DshTokens` / `Color` 表。都不挂官方 CSS Modules，也不把启动页 `--boot-*` 带过去。禁止再开 `--bg` / `--accent` 平行色板，禁止 Material 默认紫或动态取色覆盖语义表。Git 胶囊上的 Commit / Push / Pull 等 action 标签保持英文。
- **桌面启动页**：整页仪器画布与独立 `--boot-*` 表，详见 [桌面启动页](#桌面启动页)。

## 手机远程交互

远程 Web 与 Android 内置 SPA 是桌面 Harness 的窄屏重排，不是第二套移动设计系统。会话画布、侧栏层级、用户气泡、InputBar、权限/模型触发器、Menu 行、Modal 标题与动作、Git split control 必须直接继承桌面端的角色、token、字号、圆角和选中规则；只允许因宽度改变排列方向、可见标签与滚动容器。不得套用 Material、iOS 或通用移动 App 的大标题栏、贴底大圆角 sheet、等宽双按钮、胶囊底栏等外观。

权限、模型、附件来源、Git 操作与行菜单在手机上仍读作桌面 popover/Menu：菜单面使用 `--dsw-specific-menu`、20px 圆角、4px 内垫、40px 行和尾部勾选，靠近触发器优先；空间不足时才贴近视口边缘并内部滚动，不能变成带独立 52px 标题栏的原生底部面板。设置、目录浏览和 Git 表单使用全屏任务，但其标题、28px 图标按钮、字段、分段控件和 36px 胶囊动作仍沿用桌面原语。破坏性确认沿用桌面 Modal 的 24px 圆角、标题/正文间距与右对齐动作；窄屏只缩小外边距，不改成另一套底部确认栏。

手机会话头部是桌面 conversation header 的压缩版：标题与元信息占主轴，Git 保持 32px split-control / pill 语义，菜单图标只扩透明命中区。常驻 composer 继续使用桌面 InputBar 的 22px 圆角、内轮廓光、28px 附件圆钮、28px 权限/模型触发器和圆形发送钮；窄屏优先省略次要文字并允许桌面既有的两组工具换行，不得把触发器填成大块灰胶囊或另做移动工具栏。

Web 独立操作命中区至少 44 CSS px，Android 至少 48dp；图标仍用既有 16px 图标，允许透明命中区扩大。手机编辑控件字号 16px、行高 24px；其他排版继续基线。长模型名省略但不能只剩箭头，完整现值与思考档在选择面板中可见。保留用户缩放和选区，代码/表格横滚优先于抽屉手势。

屏幕返回、浏览器返回和 Android 返回使用同一导航层级；软键盘出现时系统返回先收键盘，再退当前层。关闭恢复触发器但不强制唤起编辑键盘；背景层不可点击或聚焦。history 不写入凭证或草稿，不在返回时重放业务写请求。普通成功原位反馈，失败原位可重试；审批关闭详情不等于拒绝请求。长草稿阅读时可收起，恢复编辑保留草稿与选区。动画只使用已有 transform/opacity token，减弱动效直接落位。

Android 保持稳定 asset origin 与同一 Web 源码，不平行实现聊天；原生只补返回、扫码、拍照/选择、键盘和生命周期。新一轮 Web 与 Android 分轨验收，不继承历史未测结论为 Pass。

## 桌面启动页

启动页是整窗一张仪器画布，不是中间再套卡片，也不是把日志关进带边框的盒子。源文件是 [`boot.html`](../src/renderer/boot.html)、[`boot.css`](../src/renderer/boot.css)、[`boot-tokens.css`](../src/renderer/boot-tokens.css)、[`boot.js`](../src/renderer/boot.js)。

构图：四角 L 形瞄准轨画在视口上；中区垂直居中，依次是 DeepSeek 标志、品牌名 `Deepseek-Harness-Desktop`、状态与说明，失败时出现直角重试与下载日志键。顶栏左侧技术码 `DSH-DESKTOP`，右侧盖章随 `body[data-state]` 切换：启动中 / 就绪 / 停止中 / 异常，对应 BOOT / READY / HALT / ERROR。左下等宽日志铺在画布上，无边框、无底色，长行换行；字号行高 14/22。日志贴底向上堆，底与左侧让开角轨（`--boot-log-inset`），超出高度时裁掉上方旧行，最新行始终完整可见。运行时就绪后，基线客户端插件装载仍留在这张画布上（状态行写 `正在加载插件 n/m`），后台 BrowserView 装完再露出 Web UI，不再切到基线那张「正在加载插件」页。

色与主题：[`boot-tokens.css`](../src/renderer/boot-tokens.css) 是唯一色表。浅色是纸面近黑，深色是 CRT 近白；`--boot-accent` 与正文同色，失败用 `--boot-alert`。`html[data-boot-theme]` 让 [`theme.js`](../src/renderer/theme.js) 只切 `theme.scheme` 的明暗半，不把用户主题的 `bg` / `accent` 写进启动页。[`boot.css`](../src/renderer/boot.css) 只引用 `--boot-*` 与基线字体、动效 token，不写 `[data-ds-dark-theme]` 分支，也不写颜色字面量。

窗口控件仍走 [`window-controls.css`](../src/renderer/window-controls.css)。禁止 NERV / MAGI / SEELE / EVA 商标或官方标志。禁止把 `--boot-*` 用到设置页、关闭遮罩、标题栏或 Web UI。

## 桌面启动器

Recovery Board 在既有归因文本位区分会话投影缓存格式错误与用户插件失败；缓存错误提示优先于跳过插件模式状态，不新增面板或操作控件，不建议清空原始会话。

启动器是冷启动闸门窗，不是仪器画布。源文件是 [`launcher.html`](../src/renderer/launcher.html)、[`launcher.css`](../src/renderer/launcher.css)、[`launcher.js`](../src/renderer/launcher.js)。色表是 [`dsh-webui-tokens.css`](../src/shared/dsh-webui-tokens.css) 的基线浅色 `:root` 与深色 `html[data-ds-dark-theme]`。`html[data-shell-theme=official]` 让 [`theme.js`](../src/renderer/theme.js) 只切 `theme.scheme` 的明暗半，不把 Appearance 壁纸种子写进 `--dsw-alias-*`。禁止 `--boot-*`、`data-boot-theme`，也禁止在 `launcher.css` 里写第二套 `[data-theme]` / `prefers-color-scheme` 色板。

## 现有偏差（不要再扩散）

产品页使用本语言的 token 与 `ui-primitives`。手机远程 Web（`mobile/web`）是文档化例外：抄 `--dsw-alias-*`，不嵌入基线插件树，不用启动页仪器画布。设置里的插件市场是桌面自有包 `ui-settings-market` 的 `settings.section`（id `market`），必须跟设置页基线同一套 token / primitives。用量统计是预置改版 `dsh-usage-panel`（id `usage-stats`），必须跟设置页基线同一套 token / primitives，不沿用上游插件色板。不要再开 `--bg` / `--accent` 平行色板。桌面启动页是文档化的仪器画布例外，见 [桌面启动页](#桌面启动页)，不得扩散。冷启动启动器走基线 token，见 [桌面启动器](#桌面启动器)，不是第二套例外。

### 市场功能迁移

市场扩展使用「发现 / 收藏 / 已安装 / 操作记录」页签。排序与时间范围复用 Menu，收藏用带 Tooltip 的图标按钮；
详情与安装 / 卸载 / 批量更新确认使用 ui-primitives Modal。详情展示目录截图（固定比例、contain）、来源与主页，
不引入上游样式或不可信 HTML；README 使用既有 MarkdownText 原语。操作记录使用紧凑列表和可展开纯文本日志，批量更新串行执行后只重启一次。

## 自检

提交 UI 改动前：

- [ ] 有现成原语却手写了按钮 / 菜单 / 对话框？
- [ ] 功能 CSS 里出现了颜色字面量或第二套 CSS 变量？
- [ ] 圆角、高度、字号行高不在上表？
- [ ] 深色模式写在了组件里？
- [ ] 新弹层没用 `usePresence` / 基线 recipe？
- [ ] 看起来像另一款 IDE 或手机皮肤，而不是钉版基线（`vendor/deepseek-harness` 渲染的 Web UI）？
