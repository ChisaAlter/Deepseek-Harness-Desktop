---
description: "账号使用方可读取本地登录状态、发起或取消浏览器登录，并在保留 API Key 的情况下退出。Host 模型使用方仅能为提供者配置的推理来源解析账号凭证。"
kind: "package-reference"
---

# @deepseek-ai/dsh-deepseek-account

[English](README.md) | 中文

getPlatformSession 为原生 Platform 内嵌提供仅限 Host 的 origin/token 快照，退登时返回 null。账号控制器 RPC 和 Client 状态不包含此方法及快照。账号变化时，使用方销毁持有旧快照的文档。

`desktopClientHeaders` 将原生平台 `darwin` 和 `win32` 映射为 Desktop 账号与更新策略请求共用的请求头；`null` 不添加请求头。

## 概述

账号使用方可读取本地登录状态、发起或取消浏览器登录，并在保留 API Key 的情况下退出。Host 模型使用方仅能为提供者配置的推理来源解析账号凭证。

## 目录

- [使用此包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## 使用此包

`AccountProfile.avatarUrl` 是可选的账号头像 URL；为空或缺失时表示没有头像。

该服务定义账号操作和可重连的状态快照。平台提供者负责协议和授权记录。凭证仅限 Host；API 控制器只导出状态与操作，不导出 resolveToken。

<a id="understand-the-implementation"></a>
## 理解实现

服务只定义账号操作，不维护第二份凭证索引，因此不发布 invariant。提供者负责持久化和登录生命周期检查。

<a id="further-exploration"></a>
## 深入探索

[凭证子系统](../../../docs/subsystems/credentials.zh.md)定义存储接口；[架构](../../../docs/architecture.zh.md)说明应用组合。

AccountDetails.balance 就绪时，value 保存充值钱包，bonusWallets 保存赠送钱包；两个数组均保留十进制金额字符串和币种。查询失败不提供金额。

<a id="model-experience"></a>
## 模型体验

无，因为账号凭证只影响 HTTP 认证，不进入模型提示、Session 日志或工具结果。

#### KV Cache effect

不改变模型请求前缀。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 账号 token 没有过期或刷新流程。退出时先移除本地授权，再由提供者在后台撤销；远程退登失败不会恢复本地登录态。资料和余额查询失败保留已存储授权。getProfile / getBalance 分别报告资料和余额的查询结果。

<a id="dev-note"></a>
### 开发备注

[桌面登录决策](../../../.agents/notes/implemented/architecture/2026-09-14-deepseek-account-login.zh.md)记录取消和存储的职责。

PlatformSession 可将仅限 Host 的 requestHeaders 从 Host 传至 Electron 主进程，其中包含部署请求头和 provider 提供的 x-client-platform。消费者必须从渲染层 bootstrap 排除这些请求头，并将其限定于配置来源。mergePlatformCookies 替换同名 Cookie，同时保留其他 Cookie。
