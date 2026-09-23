---
description: "使用并排查实验性 Web Agent Teams roster、共享任务板与 teammate 导航面板。"
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-client-ui-agent-team

[English](README.md) | 中文

## 概述

本包向 Web 会话页头添加 Agent Teams action，让用户检查当前 roster、查看共享任务板并导航到 teammate 会话。它通过生成的 `ctx.remote.agentTeams` contribution 读取权威 Team 状态，并让普通 child history 导航继续使用稳定的 addressed-subagent 路径。通过公开发布的实验性 Agent Teams bundle 选择本包。这个浏览器 projection 不扩展稳定 API Proxy、不存储 Team 状态，也不注册面向模型的输入。

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

通过 [`@deepseek-ai/dsh-experimental-agent-team-profile`](../agent-team-profile/README.zh.md) 启用本包。这个组合包同时提供团队服务、工具与 Web 界面。Web Client loader 挂载 `/client` export；root Host export 不执行行为，本包也没有用户配置字段。

### 检查并导航 roster

打开 panel 会调用 `agentTeams/view`。Roster row 展示持久 name、轮次可用状态、model 与 diagnostics。provisioning 和 running 成员使用共享 ongoing loading，inactive 成员使用 idle 灰点，failed 成员使用 error 红点。选择健康 teammate 时，系统直接根据其 Lead 与 roster 身份打开普通的 `{ parentSessionId, childSessionId, mode: 'continuable' }` address，不刷新或检查 parent catalog。Host 在打开历史时校验 parent、child 与 mode。History 与后续人类提示词继续使用稳定 addressed-subagent 会话路径；本包不会添加 Team 专用 address 字段。

### 查看任务板

可开始的 pending 任务使用 idle 灰点，被依赖阻塞的 pending 任务使用 warning 橙点，in-progress 任务使用 ongoing loading，completed 任务使用 done 绿点。

只读任务板展示任务标识、负责人、依赖、就绪状态、提示性写入范围与重叠警告。Team agent 通过工具创建和更新任务；面板不提供任务修改控件。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

Client export 挂载来自 [`@deepseek-ai/dsh-experimental-agent-team/remote`](../agent-team/README.zh.md) 的生成的 `ctx.remote.agentTeams` contribution，然后通过 Cordis effect 注册 locale dictionary 与一个 conversation-header slot。Dispose plugin fiber 会移除这两项 registration。

面板渲染在会话容器外，并保持在视口范围内。打开时焦点移入面板；按 Escape 或选择关闭按钮时，焦点返回触发按钮。点击外部或将焦点移出面板与触发按钮时，面板关闭，但不会将焦点移回。打开或刷新面板会读取完整 Team view。并行刷新只保留最新响应，属于上一个会话的响应会被忽略。

| 文件 | 职责 |
|---|---|
| [`src/client/mount.ts`](src/client/mount.ts) | 生成的 Remote、locale、导航与 slot registration |
| [`src/client/TeamAction.tsx`](src/client/TeamAction.tsx) | Roster 与任务板交互状态 |
| [`src/client/locales.ts`](src/client/locales.ts) | 中英文 panel 文案 |
| [`src/index.ts`](src/index.ts) | 不执行行为的 Host entry |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [Agent Teams bundle](../agent-team-profile/README.zh.md)——挂载本 Client plugin 的公开 opt-in bundle。
- [Agent Teams service](../agent-team/README.zh.md)——权威 roster、task 与 Remote 行为。
- [会话 UI](../../client/ui-conversation/README.zh.md)——稳定 header slot 与 addressed-subagent 导航表层。
- [实验性包](../README.zh.md)——孵化状态与发布规则。

-----

<a id="model-experience"></a>
## 模型体验

无直接影响，因为该浏览器 projection 不注册面向模型的输入。

#### KV Cache 影响

无直接影响；Team 工具与普通会话提交负责后续任何模型可见用途。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **Snapshot refresh**——panel 会在打开和显式 refresh 时刷新；它没有实时事件订阅或 mailbox timeline。
- **普通 child continuation**——导航后发送的人类消息使用稳定 addressed-subagent 提示词路径，而不是 Team peer mailbox。
- **没有 lifecycle 或 workspace control**——panel 不能 spawn、rename、delete 或 interrupt teammate，write scope 仍只是提示性 metadata。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>

**运行时不变式：** 不发布伴生入口。RPC 是权威来源，本包只持有一个可释放的 slot 注册。
