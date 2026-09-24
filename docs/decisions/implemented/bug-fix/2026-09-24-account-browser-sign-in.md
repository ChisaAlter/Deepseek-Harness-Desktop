# Decision: 桌面账户登录自动打开浏览器

Status: implemented

中文 | [English](2026-09-24-account-browser-sign-in.en.md)

## Problem

DSHD 复用 Harness 的账户插件，但没有复用 Harness 原生桌面主进程的账户状态监听器。Host 创建登录尝试后会提供授权链接，弹窗提示等待浏览器登录，却没有窗口负责自动打开该链接。用户只能复制链接手动访问。

## Decision

账户插件在 DSHD 的 `window.shell.openExternal` 存在时，首次收到带授权链接的 `waiting-browser` 状态便打开系统浏览器。链接附带当前桌面生效的明暗主题，与弹窗复制链接一致。按登录尝试 id 去重，避免状态流重复通知时多次弹出。打开失败由现有复制链接入口回退，不取消 Host 登录尝试。Harness 原生桌面仍由自身主进程负责打开浏览器。

## Alternatives considered

- **只保留复制链接**：不满足点击登录自动打开网页的用户路径。
- **在点击处理器里立即打开**：`startSignIn` 先返回 `initializing`，授权链接随后才由状态流提供；此时没有可打开的 URL。
- **在 DSHD 主进程再订阅账户状态**：会复制一套 Host 流连接与生命周期，而账户插件已有这条状态流和桌面外链桥接。

## Consequences

DSHD 自动打开每次登录尝试的授权页一次。浏览器启动异常不改变登录状态，用户仍可复制链接继续。定向测试覆盖首次打开、重复状态、下一次尝试以及浏览器打开失败。
