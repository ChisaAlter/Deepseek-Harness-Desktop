---
description: "在 Web 中选择 Agent preset 和新任务默认值，并查看各模式的说明。创建与修改引导至创造模式。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-agent-preset

[English](README.md) | 中文

## 概述

在 Web 中选择 Agent preset 和新任务默认值，并查看各模式的说明。创建与修改引导至创造模式。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与待办](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

设置页显示内置与自定义卡片分组、默认项高亮和点击卡片选择；没有 preset 的分组不显示，但自定义分组会保留其创造入口。本页不编辑任何内容：该入口启动一个创造模式任务，以 bundle 形式创建或覆盖 preset；当 `cordis` preset 在列表中且存在会话流程时提供。

「新任务可选择模式」开关控制保存的用户默认值是否生效。关闭时使用部署默认值，重新开启则恢复用户偏好。选择健康定义作为默认值也会同步当前新任务页面的空白会话。Creator 入口开启一个使用 `cordis` preset 的新任务。新会话选择器还要求通用设置开启开发者工具。

已知的内置预设提供只读的模式说明与使用示例对话框。各页签保留各自的滚动位置；关闭后焦点回到打开它的操作。帮助不会改变新任务默认值。默认徽标取代卡片的分组徽标，预设 id 显示在标题旁。指南文案与示例归本包所有。

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节 — 点击展开</summary>

`agentPresets/list` 提供列表和选择器策略；默认值与可见性的修改写入 `agent-presets` settings 命名空间。选择器、空白会话同步和只读会话标签使用记录的 preset 标识。连接重置和设置更新会刷新列表。

</details>

<a id="further-exploration"></a>
## 延伸阅读

- [Scope](../../core/scope/README.zh.md) — 注册隔离。
- [Agent](../../core/agent/README.zh.md) — 会话运行时。
- [Cordis](../../../docs/cordis-primer.zh.md) — 插件配置与生命周期。

<a id="model-experience"></a>
## 模型体验

通过选定的 preset 间接影响模型，其插件拥有模型可见能力。

#### KV Cache effect

选择变更只影响之后的任务，已有插件与提示词保持不变。

## 已知限制与待办

<a id="known-limitations-and-deferred-work"></a>

- Web 不创建也不编辑 preset：通过创造模式安装的 bundle 声明新 preset，或按行 id 覆盖内置 preset，覆盖会替换整个子插件列表。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>

**运行时不变量：** 不发布 companion；状态由 Host 注册表拥有，客户端展示与选择行为由组件测试验证。
