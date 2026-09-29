# Decision: Android 聊天主界面改为原生 Compose

Status: implemented

中文 | [English](2026-09-29-mobile-native-chat.en.md)

## Problem

Android 的连接／扫码虽是 Compose，配对后仍显示 WebView 内的手机 SPA。用户明确要求 Android 聊天原生，且输入框比 Web 复刻更精致；浏览器 Web 端保持现状。此前共享 UI 的禁令已经不符合产品意图，但现有 Kotlin `:protocol` 仅处理配对链接，完整 ChisaCode E2EE、sticky 和 host RPC 在内置 JS 客户端中。

## Decision

- Android 已配对主界面以 Kotlin + Compose 绘制会话列表、时间线、审批和输入卡；浏览器仍使用 `mobile/web`。
- APK 内置同源 Web 客户端暂在后台承担现有 E2EE／host RPC，保留配对密钥和 origin。只从可信 asset 主文档投影最小文本视图，原生向 JS 发送白名单动作；任何外部主文档、迟到的会话回调和未知动作均不获权限。
- 首轮原生链路聚焦连接、列表、历史／增量回复、发送／停止和审批；高级 Git／文件／工作区仍通过标明的旧版工作页过渡，不画假功能。输入卡按 [手机设计语言](../../../design-language-mobile.md#android-原生聊天迁移) 统一语义 token、尺寸和 IME 行为。

## Alternatives considered

- **从 Kotlin 重写 ChisaCode 加密与所有 host RPC**：可移除后台 WebView，但密钥迁移、线协议和中继兼容风险会与 UI 改造叠加，现有 `:protocol` 也不具备这些能力；待原生主路径验证后单独评估。
- **只细修 WebView CSS**：不能满足 Android 原生界面与原生输入体验的明确要求。
- **Web 与 Android 同步改成 Compose**：浏览器不能运行 Compose，且用户明确要求 Web 端继续保持 Web。

## Consequences

- Compose 与 Web UI 各自维护呈现层，但共用现有通信协议和语义 token；JS 桥接与 Kotlin 投影需要双方的契约测试和真机端到端验收。
- 后台 WebView 仍占用进程与内存，不能把这一阶段宣传为全 Kotlin 网络栈。旧版工作页的过渡入口仍为 WebView，需逐项迁移后才能删除。
- [此前手机结构决定](2026-09-24-mobile-remote-claude-structure.md)的移动几何继续有效；其中 Android 聊天保留 WebView 的实现限制被本决定替代。
