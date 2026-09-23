---
description: "账号页面使用经过认证的 Remote 操作和快照流。控制器提供登录状态，不返回 token 或 PKCE 私密数据。"
kind: "package-reference"
---

# @deepseek-ai/dsh-api-account-controller

[English](README.md) | 中文

## 概述

账号页面使用经过认证的 Remote 操作和快照流。控制器提供登录状态，不返回 token 或 PKCE 私密数据。

## 目录

- [使用此包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## 使用此包

account 命名空间提供 getState、getProfile / getBalance、startSignIn、cancelSignIn、signOut 和 watch。watch 先发送完整初始状态，随后发送完整状态变化；断开连接只停止观察，不取消登录。取消操作必须指定尝试 ID，防止旧页面取消新登录。

<a id="understand-the-implementation"></a>
## 理解实现

控制器向账号服务转发操作，不维护独立的账号状态，因此不发布 invariant。

<a id="further-exploration"></a>
## 深入探索

[凭证子系统](../../../docs/subsystems/credentials.zh.md)定义存储接口；[架构](../../../docs/architecture.zh.md)说明应用组合。

<a id="model-experience"></a>
## 模型体验

无，因为账号凭证只影响 HTTP 认证，不进入模型提示、Session 日志或工具结果。

#### KV Cache effect

不改变模型请求前缀。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- UI 断线后可通过 watch 恢复状态，但不能在 Host 退出后恢复登录尝试。凭证和请求 token 解析不对 Remote 暴露。

<a id="dev-note"></a>
### 开发备注

[桌面登录决策](../../../.agents/notes/implemented/architecture/2026-09-14-deepseek-account-login.zh.md)记录取消和存储的职责。
