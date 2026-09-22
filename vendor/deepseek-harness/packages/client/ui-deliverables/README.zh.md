---
description: "Web GUI 的改动文件、交付文件与可点击文件引用：已完成轮次末尾的改动文件卡片与交付文件卡片、逐个对比改动文件的 review tab，以及收尾正文中的行内代码链接；供产出物体验的用户与维护者阅读。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-deliverables

[English](README.md) | 中文

## 概述

本包渲染已完成轮次末尾的改动文件卡片——列出本轮改动的文件及 Host 记录的行数，每一行在该文件上打开本轮的 review tab——以及显式交付文件的卡片，并把收尾正文中匹配的行内代码引用转为链接，让被点名的文件在右侧 Sidebar 中打开。列出与链接的路径来自记录的改动摘要、成功的根级或 PTC 文件修改与显式交付，而非收尾正文。只有正式提供的 Web patch 加载本包；删除其 cordis.yml 条目会同时移除指引、卡片与正文链接。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

与 `ui-conversation` 和 Host 侧的 [workspace-changes](../../deliverables/workspace-changes/README.zh.md) 插件一起挂载本插件；已完成轮次随即以改动文件卡片收尾，位于收尾消息正文与其动作页脚之间。没有可提供的摘要时——本轮没有改动任何文件、该插件被组合出去，或该轮之后 Host 重启过——卡片不出现，只保留交付卡片与正文链接；工作区不在 git 仓库内时摘要只列文件工具的编辑。

<a id="explicit-deliveries"></a>
### 显式交付

Web 的 `standard`、`ptc` 与 `cordis` preset 提供 `present` 用于声明交付会话文件系统可访问的最终文件，包括通过 Bash 创建的文件。创建文件后，以 `files: [{ path, description? }]` 调用。[present 工具](../../deliverables/tool-present/README.zh.md)拥有文件数量限制和会话声明。收尾轮次把单个交付显示为横向占满内容区的卡片，把多个交付显示为间距 10px 的双列网格。文件超过四个时，列表默认收起，并提供显示或隐藏完整列表的控件。每张卡片高 60px，上下内边距为 8px、左右为 10px；40px 图标框内使用 20px 的共享 `FileTypeIcon`，文件名为 13px、次要文本为 10px，“打开”操作为 12px。卡片显示 basename 与说明；没有说明时显示文件类型，说明末尾的括号后缀会被省略，悬停卡片时该行切换为侧栏预览提示。点击卡片或分段“打开”控件的左侧会在右侧 Sidebar 中预览文件；右侧箭头打开标准菜单，其中提供 Host 默认应用，以及 macOS 上的“在 Finder 中显示”、Windows 和 WSL 上的“在文件资源管理器中显示”或 Linux 默认文件管理器的“打开所在文件夹”。匹配的行内代码引用在右侧 Sidebar 中预览相同源文件；原生打开需要显式选择卡片菜单中的操作。同一路径重复声明时，选择收尾回复之前最近一次的说明。

`present` 工具行显示正在交付、已交付、失败或中断状态；展开已结束的调用可查看其记录的结果。可折叠卡片网格保留全部交付文件。菜单中的两个操作共享等待状态，并显示进度、成功确认或各自可重试的错误。交付卡片出现时读取桌面信息，连接更换时清除缓存，旧连接的响应不能更新元数据。选择原生菜单操作后，键盘焦点回到仍可用的侧边栏“打开”按钮。等待操作完成时关闭菜单，用户再次点击才会打开。Host 没有桌面时禁用“打开”菜单；桌面信息读取失败时提供“重试”。服务 Host 必须具备桌面和合适的默认应用；远程浏览器不会打开其所在设备上的应用。

### 改动文件卡片

卡片渲染 Host 为本轮最新一条 `workspace/changes` 宣告提供的摘要，每条宣告通过经过认证的摘要路由读取一次；读取尚未完成、Host 答复摘要已不存在，或摘要没有列出任何文件时，没有卡片。标题给出改动文件总数与增删行数合计，每一行显示一个文件的展示路径及其增删行数，二进制文件显示“二进制”，Host 没有捕获的文件显示“过大”。行按记录的展示顺序排列，因此仓库内位于工作目录之上的文件与工作区外的文件排在最前。折叠前显示三行；下方的控件展开全部记录文件，展开后同一位置的控件从底部收起列表。每一行在右侧 Sidebar 中打开本轮的 review 并选中该文件，标题则在第一个文件上打开它。首个文件区块位于收尾正文下方 20px，后续显式交付区块位于卡片下方 16px，操作页脚位于最后一个文件区块下方 20px。最终文件交付仍需调用 `present`。

### review tab

行在该行的文件上打开本轮的 `changes-review` tab，其地址由当前查看的 Session 和宣告事件的序号组成，以轮号作标题；同一张卡片的另一行会在其文件上显示同一个 tab。头部的文件选择器列出所有记录的文件及其行数，用于切换对比；所选文件的行数跟在后面。头部的工具在单栏视图和左右视图之间切换，后者把每一段删除与紧随其后的新增逐行配对；切换自动换行；在 Sidebar 中打开当前整个文件；Host 有桌面时用默认应用打开它，等待与可重试错误状态与卡片一致。视图与换行的选择按 tab 保留。tab 通过经过认证的路由各读取一次摘要和每个对比。文本对比逐个列出 hunk，每一行带旧侧和新侧的行号，新增与删除分别用成功色和错误色，并在文件是本轮新建或删除、两侧内容相同、Host 的逐行对比超时而按整文件替换显示，或 tab 在 5000 行处停止绘制时给出一行说明。二进制或过大的文件、Host 已不再提供的对比，以及读取失败各显示一行提示；读取失败时提供重试。对比是本轮对该文件的快照，不是它当前的内容。

### 行内代码链接

收尾正文链接产出或已交付的路径：行内代码 token 按精确路径解析，或当它恰好等于其中某条路径的 basename 且该路径唯一时解析——两条路径共享同一 basename 时保持不可点击而不作猜测，因此提及绝不打开错误的文件。产出路径包括成功的根级调用以及 PTC 子调用中的 `write`、`edit` 和有修改作用的 `str_replace_editor`。settled PTC 子调用只通过 Conversation assembler 已解析的 Turn 或 Step Location 归属；`unresolved` 或仅 session 的事件不贡献，失败、读取、查看、未知工具和畸形参数同样不在词表中。解析成功的提及保留代码标签，并采用 Markdown 样式表的链接样式，完整路径作为其 `title`。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

Node 半部注册[模型体验](#model-experience)所述的静态 `ui:deliverable-file-references` 系统提示词段。显式 Markdown 链接使用共享的 [Markdown 渲染器](../ui-primitives/README.zh.md)；行内代码匹配仍仅限产出或交付文件。浏览器半部把组合改动文件卡片与显式交付的包装组件注册进 chat 视图的 `conversation.chat.turnTail` 列表，与其他功能产物并列。`deliverablesDefinition` 把每个轮次最新且通过校验的 `workspace/changes` 宣告的序号折叠进 `DeliverablesTurnData.changes`，卡片按它向 Host 读取摘要并缓存到连接被替换为止，把 `deliverables/presented` 事件折叠为交付，并根据 `write`、`edit` 和有修改作用的 `str_replace_editor` 命令中经过校验的原始参数把成功的第一方修改调用折叠为产出路径；产出路径只供正文提及解析器使用。PTC dispatch settlement 在 Conversation assembler 给出的 Location 为 Turn 或 Step 时加入同一词表；根级与 PTC 路径共用修改参数校验。读取、删除、不受支持的工具、格式错误的调用、格式错误的事件、失败结果，以及 `unresolved` 或仅 session 的 PTC 事件都不贡献条目。每一行通过 `ctx.sidebarRight.openResource` 打开 `dsh-resource://changes-review/session/<sessionId>/<seq>/<turn>`，并以文件下标作为 `changes-review` 的导航参数；本包在 `builtin` 档为该模式注册 `changes-review` tab 类型，把其 body 连同一个按 tab 保存选择的独占 store 注册到按键的 `sidebar.right.pane.tab` 座位下，body 通过经过认证的路由把摘要和对比读进连接更换时清空的 store。本包还提供 chat 视图按收尾消息查询的 `chatFileMentions` 服务；把插件组合出去会移除全部表面，视图的空列表以零成本留下。

原生打开使用经过认证的 POST，通过当前查看的会话、事件序号和原始文件索引定位声明；review tab 对改动文件的原生打开使用同一组坐标。对声明，Host 读取事件及当前查看的会话 header，将其中的 cwd 传给 `workspaceFiles.stat`，未记录 cwd 时使用部署的工作目录；对改动文件，传的是所提供摘要携带的工作目录。它与侧栏预览使用同一组合文件系统，无需启动 Agent，子会话也适用。原生操作要求规范化的进程路径能从 Host 路径映射回同一进程路径。提供方没有这种映射时返回 422，之后 review tab 隐藏原生打开；Host 上存在同名文件并不足够。同一份桌面可用性配置同时约束信息查询和实际执行。编辑会影响后续打开的内容；删除后返回错误。不创建文件内容副本或附件。插件释放时取消并等待进行中的原生打开请求。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当产出物面不够用时阅读以下页面。它们从卡片进入 Host 记录器、turn-tail 洞与词表背后的决策。

- [workspace-changes](../../deliverables/workspace-changes/README.zh.md)——记录并提供卡片所渲染摘要的 Host 插件。
- [ui-chat](../ui-chat/README.zh.md)——声明 `conversation.chat.turnTail` 洞并渲染收尾正文。
- [本轮改动文件卡片](../../../.agents/notes/implemented/feature/2026-09-11-turn-changed-files-card.zh.md)——用 git 记录的摘要取代修改调用行背后的决策。
- [工作区文件链接](../../../.agents/notes/implemented/feature/2026-07-31-web-workspace-file-links.zh.md)——早先产出文件行背后的决策；其 Host 打开路径已被[右侧 Sidebar](../../../.agents/notes/implemented/feature/2026-09-04-right-sidebar-docking-infrastructure.zh.md)取代。
- [行内文件提及](../../../.agents/notes/archived/feature/2026-08-07-web-inline-file-mentions.md)——收尾正文可点击提及背后的决策。
- [客户端包映射](../README.zh.md)——相邻的浏览器 UI 包。

-----

<a id="model-experience"></a>
## 模型体验

### 可点击文件引用指引

#### 模型看到的内容

提示词要求模型在成功创建或修改文件后点名主要产出，并链接命令、配置表达式和代码块以外的每次现有文件提及，包括重复提及和表格。标签默认使用文件名或清楚的别名，仅添加足以区分文件的父目录。精确引用显示为 `filename:24` 或 `filename:24–30`；目标保留完整相对路径或绝对路径，以及 `#L24` 或 `#L24-L30` 锚点。显示后缀不含 `#` 或 `L`。

#### Token 影响

加载本包时增加一段包含产出提醒和文件引用指导的固定提示词。[present 工具](../../deliverables/tool-present/README.zh.md#model-experience)拥有交付 schema 和结果文本。

#### KV Cache 影响

该段落在本包挂载期间始终以 first-party 顺序 9000 保持静态，因此留在可复用的提示词前缀中，不会随轮次改变。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制界定了当前产出物词表。它们是当前包约束，不是通用文件链接对比或任务积压。

- **提及匹配只认精确路径或唯一 basename**——后缀式提及保持惰性；等真实的收尾消息形态产生需求后再放宽匹配规则。
- **终端创建的文件需要显式交付**——git 记录到改动后卡片会列出它们，但交付卡片和行内代码引用需要调用 `present`；显式 Markdown 链接可以直接引用现有文件。
- **声明不保存文件内容**：重新打开或转移 Session 后，源文件仍需能被当前查看的 Session 文件系统访问。文件缺失、为目录或最终路径为符号链接时返回 404。
- **原生打开需要 Host 桌面**——没有桌面时 review tab 不提供原生打开；对比本身只需要记录了该轮的 Host。
- **对比没有语法高亮**——tab 只显示纯文本 hunk，最多绘制 5000 行并给出提示。
- **对比携带整个文件的文本**——对比路由会送出所列文件在 Host 上记录时的完整文本，包括被忽略的文件和 Sidebar 预览所限定的工作区根目录之外的文件。
- **包内的标题字形**——卡片的尖括号标记放在 `src/client/icons.tsx` 中，直到共享图标集收录它；其 props 已与共享图标契约一致。
- **工作区外的文件只按绝对路径打开**——记录的路径是记录时的 Host 路径；工作区移动或换一个查看 Session 都无法重新定位它。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>

**运行时不变式：** 不发布伴生入口。提示词、slot、dictionary、文件操作路由与可选 service 注册归 effect 所有；Session 日志拥有声明，文件系统拥有文件内容。
