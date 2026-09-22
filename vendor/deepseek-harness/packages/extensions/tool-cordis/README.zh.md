---
description: "为开发和配置已安装 Harness 插件的 agent 提供只读运行时 API 查询。"
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-cordis

[English](README.md) | 中文

## 概述

编写插件代码前查询 Host 和 Client 的运行时 API。创造模式同时提供这些只读工具与 Plugin Manager，后者负责持久化 profile 变更。检查注册表由 Cordis host runner 提供；浏览器查询需要已连接的页面。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与待办](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

创造模式包含这组工具。其他组合需要同时挂载 `@deepseek-ai/dsh-tool-cordis` 和提供 `cordisInspect` 的 host runner。调用 `cordis_inspect_list` 发现 provider，再用 `cordis_inspect_query` 查询其具体方法和类型。通过 [Plugin Manager](../../boot/plugin-manager/README.zh.md) 安装包含插件代码或 MCP 配置的组合包。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节 — 点击展开</summary>

Host provider 结合生成的 Service/Event 目录与请求 agent 的工具注册表。Client provider 通过现有检查注册表同步清单，并从已连接页面回答查询。工具插件通过 Cordis effect 持有注册；释放时移除工具和提示词贡献。检查直接读取 provider，不维护独立运行时投影，因此不发布不变式配套插件。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [Plugin Manager](../../boot/plugin-manager/README.zh.md) — 持久化组合包安装和启停。
- [Cordis host runner](../cordis-host-runner/README.zh.md) — 检查注册表和现有运行时消费者。

<a id="model-experience"></a>
## 模型体验

### 运行时检查

#### 模型所见

[工具目录](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-cordis) 描述两个只读检查工具。[提示词](src/prompt.ts) 指引模型通过 Plugin Manager 进行持久化变更并说明 MCP 设置方式。创造模式的视觉请求默认通过已安装的 UI 插件显示在当前 Web 页面；开发技能说明 Client 打包和 slot 注册方法。查询结果包含所请求的 API 声明或当前工具 schema。

#### Token 影响

插件可见时，两个工具 schema 和指导段落进入模型请求。查询结果追加到转录中；精确查询避免加载无关声明。

#### KV Cache 影响

未改变的 schema 和指导保持前缀稳定。查询结果追加到历史中；启用其他插件可能改变后续工具 schema。

## 已知限制与待办

<a id="known-limitations-and-deferred-work"></a>

- Client 查询等待页面响应或取消。检查不能调用服务方法、配置插件或执行生成代码。

<a id="dev-note"></a>
### 开发备注

无。
