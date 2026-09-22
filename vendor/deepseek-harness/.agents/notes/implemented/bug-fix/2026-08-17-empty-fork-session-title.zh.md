# Agent Note: 空 fork 会话获得自动首消息标题

Status: implemented

[English](2026-08-17-empty-fork-session-title.md) | 中文

## Problem

编辑第一条用户消息，或以其他方式在第一个 `turn/start` 之前做 `beforeSeq` fork，会得到空白子会话。client 随后用 `source.kind: 'user'` 把它 `rename` 成 `Parent (1)`。用户钉住会阻止自动标题生成，而首消息调度还拒绝任何带 `parentSession` 的会话。因此子会话的第一条新提示词即使与父会话主题无关，侧边栏仍显示父会话标题。

## Decision

首消息在合格人类消息数为 1、且最新标题不是用户钉住时调度，包括带父会话的会话。延续性 fork 仍跳过该节奏，因为它们至少继承了一条合格人类消息。

`SessionRuntime.fork` 只在 Host 报告 `blank: false` 时应用 `increaseTitle`。空白子会话保持未钉住的继承标题或尚无标题，以便回退和首消息能从新的第一条消息运行。fork 上真正的 `session.rename` 仍然钉住。

由日志支持的标题归属仍见[由日志支持的会话标题](../feature/2026-07-21-log-backed-session-titles.md)。Web fork 操作与 `(N)` 递增仍见[Web 会话 fork 操作](../feature/2026-07-27-web-session-fork-actions.md)。

## Alternatives considered

**把 fork 递增标题做成不钉住的 `fork` 来源种类。** 否决：空白子会话不需要持久的 `(1)` 后缀，而且新来源种类会为一项仅属于 client 的编号策略扩大标题不变量和持久化目录。

**让每个 fork 都从第一条子会话自有提示词重新生成标题。** 否决：延续性 fork 仍是同一主题；首消息要么复述继承的第一条消息，要么忽略后续跟进。`messages.length === 1` 已经能区分空种子。

**保持首消息只服务根会话，仅跳过 client 改名。** 否决：带父会话的空白子会话在回退之后仍然永远不会调度提供方。

## Consequences

编辑首条消息或空的 `beforeSeq` fork 会按新提示词生成标题。延续性 fork 仍显示 `Parent (1)`。在空白子会话上的手动改名继续钉住。

## Testing

`session-title` 钉住：带父会话的空子会话在第一条提示词上运行首消息；对该子会话的用户改名仍会阻止；延续性 fork 仍跳过首消息。Client `sessions-service` 钉住：`increaseTitle` 在 `blank: true` 时跳过 `session.rename`，在 `blank: false` 时仍递增。

## Related

[由日志支持的会话标题](../feature/2026-07-21-log-backed-session-titles.md)。[Web 会话 fork 操作](../feature/2026-07-27-web-session-fork-actions.md)。
