# Agent Note: 非加宽沙箱升权按生效模式放行

Status: implemented

[English](2026-09-14-non-widening-escalation-noop.md) | 中文

## Problem

`approveEscalation` 对一切非加宽请求抛出 `sandbox escalation to "<mode>" is not strictly wider than this call's current "<effective>" mode`——包括 `danger-full-access` 会话再申请 `danger-full-access` 这种 `WIDER_MODES` 天花板必然不覆盖的形态。工具注册表把抛错变成 isError 结果：命令没有执行，模型按原参数重试，循环往复。全程没有任何权限被扩大，报错只是纯摩擦。

## Decision

指明真实升权目标（`ESCALATION_TARGETS`）且有效模式可识别、但并不严格加宽的请求不算升权：`approveEscalation` 返回 `effectiveMode`，调用方加盖的策略保持不变，也不询问任何人。目标落在封闭词表之外（`read-only` 或任意字符串）、或有效模式本身不可识别时仍失败关闭——损坏的会话状态保持响铃失败。真正加宽请求的审批链一字未动。这收窄了 [sandbox 笔记](../feature/2026-07-06-sandbox.zh.md)中的原失败关闭规则，其中过时的事实行已就地更新。

## Alternatives considered

**保留抛错、只改文案。** 模型仍可能对着修正后的报错循环，且这个错误仍是纯摩擦——不带该参数调用会以完全相同的方式运行。

**对更窄请求返回所请求的模式**（例如在 `danger-full-access` 会话下请求 `workspace-write`）。那是该参数从未设计过的逐调用收窄功能；按无操作处理与不传 `sandbox_permissions` 的行为一致。

**对任何非加宽请求失败关闭。** 那正是本次要移除的修复前行为。

## Consequences

`dsh-tool-bash`、`dsh-tool-pwsh` 与 `dsh-tool-fs` 携带冗余或已被覆盖的 `sandbox_permissions` 的调用，现在按其常驻策略执行而不再报错。词表外目标与不可识别有效模式仍产生逐字固定的 `not strictly wider` 失败且不提示。加宽请求仍经 `ctx.approval` 按原四态映射解析。
