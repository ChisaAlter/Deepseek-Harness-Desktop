---
description: "dsh Web 客户端的「内置插件」设置分区，以及注册进插件页的官方插件配置页。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-plugins

[English](README.md) | 中文

## 概述

使用**内置插件**设置分区查看本部署随附的插件；使用侧栏插件页的**官方**分组配置开放了设置的宿主平面插件。每个配置页标明用户覆盖过哪些值，允许把它们重置为部署默认值，在本地保留修改直到保存，离开页面即丢弃。如果配置在页面加载后发生变化，保存会被拒绝，而不会覆盖较新的值。

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

打开设置中的**内置插件**查看只读的插件列表；它由 [ui-settings-plugin-inventory](../ui-settings-plugin-inventory/README.zh.md) 作为分区唯一的标签页贡献，直接显示为页面本身。要配置宿主平面插件，在侧栏选择**插件**：官方分组为本部署组装的每个插件列出一张卡片，顺序依次为 shell 执行器（`shell`）、agent loop 的工具调用并行度（`agent-loop`）、Subagent 委派限制和模型选择（`subagent` 与 `subagent-model-selection`）以及 DeepSeek 搜索提供方（`web-search-deepseek`），点开卡片就是该插件带表单的页面。

### 这里会出现什么

每个页面在 Host 服务其 settings 命名空间期间注册进插件页的 `plugins.item` slot，因此没有组装该插件的部署不会留下它的任何痕迹；Host 开始或停止服务某个命名空间时，其页面会在下一次 settings 文档提交或重连时加入或撤下。卡片上的一句话简介与页面上的表单是同一个条目按插件页索取的两种视图渲染出来的。

### 编辑与保存

页面暂存用户输入，只有用户保存时才写入。每个控件渲染的都是暂存文本，因此屏幕上所见即保存后所存。离开页面即丢弃草稿，没有放弃控件。保存失败时页面保持原样、报告失败并保留草稿供用户修改。重置暂存的是组装默认值而非立即写入；字段不接受的草稿会阻塞保存，而不是被丢弃。值是否被接受，唯一的裁判是 Host。

**Subagent** 卡片将委派限制与模型选择放在同一个页面中，共用一个保存按钮。**最大递归深度**和 **Subagent 并行数量上限**并排呈现，窄屏时上下排列。信息按钮按需展开两行深度示例表和共享计数规则；校验错误仍直接显示在输入框下。深度保留工具显式覆盖。总数统计所有递归层级中存活的可续接 Subagent，包含等待中的 Subagent，不计入主 Agent、一次性运行和外部提供方。保存后用于后续委派；调低上限不会停止已有 Subagent。

模型选择分区会同时暂存其权限开关与精确模型复选框。启用时必须至少选择一条适配器路由。保存会在一次 mutation 中提交 `enabled` 与 `allowedModels`，并以草稿开始时的 revision 设栅；Host revision 更新后，草稿会标记为失败，而不会恢复已撤销的路由。关闭时会保留已选路由供以后重新使用。可用模型按提供方分组；当前目录中缺失的已存路由排在末尾，且仍可移除。适配器名称与模型描述仍属于实时目录元数据，不会存储；适配器变化、设置提交和重连后，卡片会刷新这些元数据。

保存 Subagent 卡片时会校验两个分区，并通过各自原有命名空间写入草稿。这些写入相互独立：若其中一项失败，页面保持打开并保留该草稿，重试仅写入剩余草稿。只要部署提供任一命名空间，页面就会出现，且仅显示可用分区。

### secret 角色字段

密钥控件初始为空、只报告是否已配置，并经由 credentials 领域而非 settings 分节写入；空草稿不写入任何东西，保留已存密钥。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

本包是一条注册规则加一条写入路径：每个页面在其命名空间被服务期间注册；保存经由客户端 settings scope。

### 注册规则

本分区声明根级列表 slot `settings.plugins.tab`，其标签会成为有序标签页；只有一个贡献时它直接显示为页面本身，某个标签页首次被选择后会保持挂载，因此搜索与清单快照在切换时不会丢失。配置页是 `plugins.item` 注册项，每个命名空间一个：共享的 settings 镜像表明 Host 服务该命名空间时通过 `ctx.slots.inject` 注册，停止服务时销毁；注册顺序就是页面顺序，而不是 Host 的描述顺序——后者跟随插件激活，可能在两次启动之间变化。页面拥有自己的控件与文案；插件页负责画标题、图标与面包屑。

### 写入路径

保存时，暂存字段通过客户端 settings scope 写入；每次单字段写入或有序 mutation 都以草稿读取时的命名空间 revision 设栅，因此已与文档脱节的表单会被拒绝，而不是覆盖并发变更。字段是否被覆盖，取决于它是否出现在原始用户层中，而非取决于它的值；重置会清除该字段，使其重新继承组装层。secret 角色的字段绝不搭乘响应；页面会在转发来的 `credentials/reference-updated` 事件到来时重读它所关注的引用。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

以下页面覆盖插件页、设置底座、清单标签页与表单背后的持久化 seam。

- [ui-plugin-manager](../ui-plugin-manager/README.zh.md)——侧栏插件页，其 `plugins.item`、`plugins.bundle.config` 与 `plugins.row.config` slot 承载配置页。
- [ui-settings](../ui-settings/README.zh.md)——声明 `settings.section` 与 settings scope 的领域底座。
- [ui-settings-plugin-inventory](../ui-settings-plugin-inventory/README.zh.md)——分区显示的只读插件列表。
- [settings](../../settings/README.zh.md)——持久化用户设置 seam 及其文件提供方。
- [credentials](../../credentials/README.zh.md)——secret 字段写入所经的凭据引用 seam。
- [ui-settings-general](../ui-settings-general/README.zh.md)——承载本分区的设置外壳。

-----

<a id="model-experience"></a>
## 模型体验

无。该包是浏览器端设置界面，不注册任何面向模型的接口。

#### KV Cache 影响

无；该包既不组装也不发送提供方请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制定义哪些插件会有页面、分组有多新鲜；它们是当前包约束。

- **只有宿主平面的插件有页面**：由 agent preset 挂载的插件把配置内联在该 preset 的 `agent.cordis.yml` 中，且根本无法注册 settings 命名空间，因此本包不会为它注册任何东西。编辑那些值仍是 preset 编辑器的职责。
- **页面仍然需要一份浏览器 bundle**：浏览器半侧必须是按客户端模块系统的 lazy-CJS factory 格式构建的 `dsh.client` 包，而产出它的 `clientBundle` 预设位于 `../../../packages/client/tsdown.client.ts`，并非已发布的包，因此本仓库之外的插件得自行复刻该构建。
- **被服务的命名空间只在两种信号上重读**：协议通告的是 settings 文档提交与连接重置，而非注册行为，因此在镜像读取之后才被其拥有方注册的命名空间，要等下一次文档提交或重连才会加入官方分组。
- **shell 页面跟随被组装的执行器**：POSIX 与 PowerShell 两个执行器家族共用 `shell` 命名空间，因为一个宿主只组装其中之一，所以被服务的 schema 随平台不同（PowerShell 多出 `pwshPath`），尽管页面在两者下编辑的都是同样两个字段。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>

**运行时不变式：** 不发布伴生入口。这是浏览器端设置界面，node half 不持有事件流或可变运行时数据；分层与写入拒绝是 Host 约定，由相应插件和 api-proxy 覆盖。
