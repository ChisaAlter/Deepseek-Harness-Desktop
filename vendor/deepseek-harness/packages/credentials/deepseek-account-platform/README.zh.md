---
description: "通过系统浏览器登录，并将账号凭证保存在现有本地凭证存储中。本地取消会阻止迟到的回调和兑换响应使用户登录。"
kind: "package-reference"
---

# @deepseek-ai/dsh-deepseek-account-platform

[English](README.md) | 中文

新申请将调用方的界面语言映射为平台的 en_US 或 zh_CN；进行中的申请保留发起时的语言。

getPlatformSession 仅在已存授权的 issuer 与 platformOrigin 一致时导出该授权。这个仅限 Host 的操作支持原生 Platform 内嵌，不扩大 resolveToken 配置的模型及文件请求来源。

`desktopPlatform` 默认为 `null`。此时所有 profile 的 Host 授权、资料、余额和退登请求都携带 `x-client-platform: web`；Desktop profile 提供 `darwin` 或 `win32`，改为携带 `x-client-platform: desktop-mac` 或 `desktop-win`。该请求头由 provider 拥有，部署配置无法覆盖。内嵌 Platform 的文档与 API 请求仅向配置来源发送相同的平台请求头，同时保留其他部署请求头。

## 概述

通过系统浏览器登录，并将账号凭证保存在现有本地凭证存储中。本地取消会阻止迟到的回调和兑换响应使用户登录。

## 目录

- [使用此包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## 使用此包

账号资料投影将 `id_profile.picture` 映射为 `avatarUrl`，没有配置头像时返回 null。

getProfile / getBalance 将保存的授权 token 通过 x-dsh-auth-token 请求头，向 platformOrigin 上的 GET /auth-api/v0/users/current 和 GET /api/v0/users/get_user_summary 发起请求。授权签发来源必须与该来源一致。Host 只投影账号 UID、资料名称、头像 URL、由 Platform 脱敏的手机号或邮箱（原样保留），以及 normal_wallets / bonus_wallets 的币种和余额字符串，丢弃响应 token 与其他字段。赠送钱包不计入充值余额。凭证变化和销毁会使进行中的查询失效。

在插件行配置 platformOrigin、allowLoopbackHttp、requestTimeoutMs 和 attemptTimeoutMs。HTTP 仅用于显式启用的本机开发。提供者先在现有 Host webServer 注册 /oauth/callback，再调用 auth_init；校验 state、使用 S256 PKCE 授权码兑换一次，并在跳转 auth_exchange.biz_data.authorized_url 前提交授权记录。浏览器地址默认要求匹配配置的平台来源，并始终要求固定的 /dsh/authorize 或 /dsh/authorized 路径。完成页地址将 `login_source` 设为发起登录的客户端类型（`web` 或 `desktop`），并保留平台返回的其他查询参数。设备标识是独立的随机 UUID 记录，由使用同一凭证存储的进程共享；device_model 报告操作系统和架构。

开放平台 URL 统一由 `platformOrigin` 配置管理。授权请求、浏览器地址校验、完成跳转、用量和充值入口都使用该来源。将配置放在私有的 `$DSH_HOME/cordis.patch.yml`，部署地址不进入源码仓库。默认要求 HTTPS；只有本机 HTTP 可通过 `allowLoopbackHttp: true` 显式启用。模型及文件 token 的目标由独立的 `inferenceOrigin` 配置管理。

`requestHeaders` 为 `platformOrigin` 上的授权、资料、余额和退登请求添加仅 Host 使用的请求头。请求头值属于敏感配置，不包含在账号 UI 状态中。Authorization、X-DSH-Auth-Token、Host、Content-Type 及连接和消息分帧请求头由提供者保留。重定向会失败，不会转发请求头。开发环境 Cookie 应保存在私有配置或环境变量中；不会自动收集浏览器 Cookie。

私有 patch 也可通过 Cordis 表达式读取环境变量：

```yaml
- id: deepseek-account
  config:
    platformOrigin: !!js process.env.DSH_PLATFORM_ORIGIN
    allowLoopbackHttp: !!js process.env.DSH_PLATFORM_ALLOW_LOOPBACK_HTTP === '1'
    requestHeaders: !!js |
      process.env.DSH_PLATFORM_COOKIE ? { Cookie: process.env.DSH_PLATFORM_COOKIE } : {}
```

已鉴权客户端提供浏览器可访问的回调来源（含 SSH 本地转发端口）和 UI 类型。提供者固定回调路径，并在初始化与兑换时使用同一个 redirect_uri。回调请求使用 state 和 PKCE 校验，不要求 RPC 鉴权。完成、取消和卸载仅移除本次尝试的路由。兑换失败发布 failed 状态，不自动重试：Web 关闭授权标签页，原标签页显示失败弹窗；回调页尝试自行关闭，并提供手动关闭提示。Desktop 收到 HTTP 204，并通过账号状态流聚焦现有登录界面。

Host 诊断通过标准输出及 Host 调试器 Console 输出，前缀为 `[deepseek-account]`。日志包含接口路径、HTTP 状态、数值响应码、失败阶段、校验失败的字段路径、实际类型和校验码，以及浏览器 URL 拒绝规则，不包含请求头、请求和响应正文、授权 URL 或原始异常。

`rewriteBrowserOrigin` 默认为 `false`，要求浏览器地址同源。私有开发 patch 可设为 `true`，将授权页和完成页地址映射到 `platformOrigin`，保留固定路径和查询字符串。原地址必须使用 HTTPS 或已匹配配置来源；仍拒绝用户名密码、片段和非预期路径。发布的 profile 保持严格同源校验。

inferenceOrigin 默认为 `https://api.deepseek.com`。私有部署 patch 可将其替换为一个精确的 HTTP(S) 来源（含端口），让推理及文件请求通过 x-dsh-auth-token 认证。配置不得包含路径、URL 凭证、查询或片段。其他来源要求授权由配置的 platformOrigin 签发；仍拒绝 Mock token。本机授权不能认证官方生产 API。部署地址保存在私有 patch 中，不随默认配置发布。

提供者初始化时，若有效的已存授权 issuer 与 platformOrigin 不同，会在使用方读取账号状态前删除该本地授权，以未登录态继续启动，不发送远端退登请求；API Key 和设备标识保留。存储错误仍明确报错，账号 HTTP 或响应校验失败不会删除来源匹配的授权。

<a id="understand-the-implementation"></a>
## 理解实现

不发布运行时 invariant：账号是否存在直接读取凭证存储，尝试状态直接投影私有状态；不存在可与另一个独立索引比较的账号索引。异步取消和提交由行为测试验证。

<a id="further-exploration"></a>
## 深入探索

[凭证子系统](../../../docs/subsystems/credentials.zh.md)定义存储接口；[架构](../../../docs/architecture.zh.md)说明应用组合。

attemptTimeoutMs 包含初始化、等待浏览器和兑换的耗时。初始化不会延长绝对截止时间；服务端 TTL 只能缩短剩余时间。在到期前已获准的凭证持久化不再取消。

<a id="model-experience"></a>
## 模型体验

无，因为账号凭证只影响 HTTP 认证，不进入模型提示、Session 日志或工具结果。

#### KV Cache effect

不改变模型请求前缀。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 浏览器登录需要 Host webServer，仅支持通过带显式端口的 HTTP localhost、127.0.0.1 或 [::1] 本机访问及 SSH 本地转发，不支持非本机域名的反向代理。账号 token 没有过期或刷新流程；用户主动在 DSH 退出登录时，先删除本地授权，再在后台调用 POST /auth-api/v0/users/logout。远程失败不会恢复本地登录态。默认仅针对捕获的旧 token 最多额外重试五次，指数退避间隔为 1、2、4、8、16 秒；logoutMaxRetries（0–5）和 logoutRetryDelayMs 可配置该策略。每次请求使用 requestTimeoutMs。提供者关闭时取消请求和等待，不持久化待撤销任务。本地凭证删除失败仍向调用者报错。签发 token 前的授权尝试仍有有效期。初始化后的取消或超时会在后台发送一次 POST /auth-api/v0/dsh/auth_cancel，携带 auth_init.biz_data 中的 authorize_id 和原始 code_verifier，不附带账号授权。本地取消不等待该请求，也不会因失败而恢复；requestTimeoutMs 限制请求时间，提供者关闭时中止请求。TODO(product-error-ui)：产品需定义已给定 biz code 的本地化文案和交互表现。在此之前，业务失败沿用现有“操作失败，请重试”兜底；其他 code 和 HTTP 错误也使用该兜底。开发授权不能认证生产请求。

<a id="dev-note"></a>
### 开发备注

[桌面登录决策](../../../.agents/notes/implemented/architecture/2026-09-14-deepseek-account-login.zh.md)记录取消和存储的职责。

登录后首次读取资料使用 auth_exchange 返回并经筛选的 user。user 为 null 或格式无效时回退到 current；后续刷新及 Host 重启也查询 current。current 请求失败时保留 Host 内存中同一凭证最近一次成功的资料；凭证变更或提供者销毁时清空。exchange 负责登记提交的设备信息。

accountRequestHeaders 覆盖 requestHeaders，供 current、余额以及内嵌 Platform 页面/API 请求使用。Cookie 按名称合并，路由覆盖保留其他部署 Cookie。授权初始化、兑换、取消和退登保持使用 requestHeaders。两组请求头仅供 Host 和 Electron 主进程使用；渲染层 bootstrap 仅接收 origin 和 token。

账号提供者的 `embeddedPageDist` 配置为内嵌用量和充值页面 URL 添加 `dist` 查询参数。默认值为空；私有前端分支选择值应写在本地 profile patch 中。此配置不改变 API 地址或凭证传递方式。
