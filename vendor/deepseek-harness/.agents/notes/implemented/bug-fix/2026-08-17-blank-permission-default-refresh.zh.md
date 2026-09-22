# Agent Note: Refresh blank session permission defaults

Status: implemented

[English](2026-08-17-blank-permission-default-refresh.md) | 中文

## Problem

Web 新会话流程会复用工作区中的空白会话，而不是不断创建隐藏占位会话。权限默认值在会话创建时被固定到该会话中，因此当某个空白占位会话已经存在后，用户再修改「通用设置」里的权限默认值，这个占位会话仍会保留旧预设。下一次“新”对话复用它时，权限 chip 就会和刚保存的默认设置不一致。

## Decision

Web workspace runtime 负责选择候选会话：可复用会话必须保持空白、属于所选 Workspace、匹配其规范 cwd，并且未归档。`WorkspaceRuntime.connectWorkspace` 不再直接返回该 id，而是通过带 `reuseWorkspaceBlank: true` 的 `session.create` 显式接纳它。host 会在通知前重新检查空白状态、Workspace 成员关系、cwd 与归档状态，并且可以先恢复冷存储中的持久占位会话，再向可选的默认值所有者通知确实符合资格的会话。

`dsh-permission-presets` 会把每条 `permission/preset` 的来源记录为 `default`、`selection` 或 `inferred`。复用确认后，只有在会话尚未开始轮次、最近选择来自默认值，并且有效沙箱与审批旋钮仍匹配该选择时，服务才会将它推进到当前 `defaultPreset`。显式选择、由旧旋钮推断或没有来源标记的旧选择，以及独立变更的旋钮都会保持固定。更新仍走常规 preset writer，因此持久的 `permission/preset`、`sandbox/mode` 与 `approval/policy` 事实继续作为投影和执行的来源。

这项修复部分细化了较早的[新会话权限默认值](../../archived/feature/2026-07-31-permission-default-for-new-sessions.md)决策：单独写入设置不会改变既有会话，而 Web 之后确认复用、且权限来自默认值的 Workspace 空白会话可以在 live 或冷接纳后推进。

## Alternatives considered

**权限设置变化后禁用空白会话复用。** 拒绝，因为这会留下额外的隐藏占位会话，并让新会话行为更不确定。既有复用策略有价值；错误只在于权限默认值过期。

**让客户端比较空白会话的权限投影和 Settings 行。** 拒绝，因为 workspace runtime 需要理解 permission settings namespace。客户端只报告自己的复用决定；权限服务拥有默认来源检查和更新。

**Settings 变化时扫描所有 live 空白会话。** 拒绝，因为 live store 会漏掉冷存储中的持久占位会话，同时包含 Web 无法复用的空白会话，例如已归档或不属于 Workspace 的会话；重启后若没有持久来源，也无法区分旧默认值与显式选择。

## Consequences

Settings 变更不会改写既有会话。确认的新会话复用可能向 live 或冷存储中、权限来自默认值的占位会话追加权限事实；该会话仍保持 blank，因为 blankness 由是否缺少 `turn/start` 定义。已经开始的对话、普通 seed 恢复、显式选择，以及不在 Web 复用决定中的会话都会保留原权限。
