---
description: "实验组地图：默认私有的预稳定原型，以及显式公开发布的 Agent Teams 包。"
kind: "package-group"
---

# packages/experimental

[English](README.md) | 中文

## 概述

实验组包含约定可能变更且不提供支持承诺的原型能力。包默认私有；五个 Agent Teams 包是显式公开发布的例外，并保留现有 `@deepseek-ai/dsh-experimental-*` 名称。本组还包含私有的跨 realm Inspector、CPython 子进程后端与浏览器 worker 预览包。组外已发布产品不得依赖实验性包。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

| 包 | 职责 | ctx 键 |
|---|---|---|
| [`agent-team-profile`](agent-team-profile/README.zh.md) | Agent Teams 的公开 opt-in profile 层 | — |
| [`agent-team`](agent-team/README.zh.md) | 具名 teammate，成员之间持久消息与共享任务板 | `ctx.agentTeams` |
| [`agent-team-web-profile`](agent-team-web-profile/README.zh.md) | Agent Teams 的公开 opt-in Web 层 | — |
| [`client-ui-agent-team`](client-ui-agent-team/README.zh.md) | Web Team roster、任务板与 teammate 导航 | — |
| [`code-runtime-python`](code-runtime-python/README.zh.md) | 代码执行 seam 的 CPython 子进程后端 | `ctx.codeRuntime` |
| [`inspector`](inspector/README.zh.md) | 用于 Host 调试、Client Runtime 检查、网络采集与 Cordis 树的跨 realm CDP hub | `ctx.inspector` |
| [`tool-agent-team`](tool-agent-team/README.zh.md) | 让模型创建、发消息与协调 teammate 的九个工具 | 按作用域注册工具到 `ctx.tools` |
| [`webworker-packer`](webworker-packer/README.zh.md) | 构建浏览器 worker 预览所消费的 gzip 压缩 VFS 镜像 | 库与 CLI，不使用 ctx key |
| [`webworker-runtime`](webworker-runtime/README.zh.md) | 在专用浏览器 worker 中运行 harness 插件树 | 库与 worker 入口，不使用 ctx key |

-----

<a id="related-documentation"></a>
## 相关文档

- [实验包决策](../../.agents/notes/implemented/architecture/2026-08-18-experimental-agent-teams-packages.zh.md)——默认私有、Agent Teams 公开例外与依赖隔离。
- [Agent Teams 子系统](../../docs/subsystems/agent-team.zh.md)——持久 Team 类型与 `ctx.agentTeams` 服务 API。
- [实验子树规则](AGENTS.md)——实验状态放宽了什么、不放宽什么。

-----

<a id="dev-note"></a>
## 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
