# Decision: dsh-whale 会话打开迁移到 uiWorkspace.openSession（0.1.6 客户端契约）

Status: implemented

中文 | [English](2026-09-21-dsh-whale-open-session-016.en.md)

## Problem

`vendor/dsh-whale` 的客户端插件写于 0.1.5 时代，三条「打开她的会话」路径（侧栏面板重定向、底栏兜底入口、桌宠 `__dshWhaleOpen` 跳转桥）都调 `sessions.open()`。运行时升到 0.1.6 后，视图选择职责从 Session Controller 搬走，`sessions` 服务只剩目录/引用管理、不再有 `open()`——面板报 `打开失败：sessions service unavailable`，底栏与桌宠跳转静默无操作。现场已有一份针对安装副本的修复包验证了修法；vendored 源码不跟进的话，每次发包/升级都会把坏代码重新带回去。

## Decision

三处入口统一走 `apply` 里解析出的 `openSession(sessionId)`：优先 `ctx.uiWorkspace.openSession(id)`（0.1.6+，兼清当前选中面板），回退 `sessions.open(id)`（≤0.1.5），两者都没有才抛 `sessions service unavailable`。依赖声明两层补齐：`exports.inject` 加 `"uiWorkspace"`，`package.json` 的 `dsh.client.inject` 加 `@deepseek-ai/dsh-client-ui-workspace`，保证客户端插件图里该服务先就位。新增 `src/main/dsh-whale-client.test.js` 在模块边界上钉契约：三个入口在 0.1.6 / 0.1.5 两种宿主形态下各跑一次，外加无服务时的错误面与 inject 声明。

## Alternatives considered

- **只留 `uiWorkspace.openSession`，删掉回退** — rejected：插件经 junction 进 `profiles/web/node_modules`，运行时降级或旧 profile 复制会让它落在 0.1.5 宿主上；回退只有几行且错误契约不变。
- **只修安装副本（保留现场修复包路径）** — rejected：`vendor/dsh-whale` 是随包发布的实现源，`extraResources` 每次升级都覆盖安装目录，治不了本。
- **在运行时里把 `sessions.open` 加回来** — rejected：视图选择搬出 Session Controller 是上游有意的架构切分；加回等于在上游 API 面上开叉。

## Consequences

鲸鱼娘面板、底栏入口、桌宠「找她办事」跳转在 0.1.6 宿主上恢复工作；0.1.5 宿主行为不变。`sessions` inject 保留（回退路径仍用），但不再是唯一通道。桌宠气泡「这轮没跑成」是另一回事——她的常驻会话挂着未回答的 `ask_user_question` 时气泡消息排队超时，进会话答掉或停止该轮即恢复，不属于本修复范围。
