# 调研索引

Bots 持续工作/长期记忆改造的一手调研与设计文档地图。

| 文档 | 内容 |
|---|---|
| [grokbot-research.md](grokbot-research.md) | Grok Bot 官方行为调研（xai-org 无 bot 源码；触发器模型、routine/通知/久离语义） |
| [openbot-review.md](openbot-review.md) | OpenBot（CopilotKit 仿 Grok Bot）逐文件审查：AG-UI 端点 bot、per-bot 容器、CEL 网关、动作审计 |

**本地参照实现**：`C:\Ai\Hermes-Agent-desktop`（Hermes）——dshbot 的既定行为参照，本次直接读源码核对：memory_tool 条目化记忆、background_review 提取回路、/goal 续转裁判、cron watch/notepad/[SILENT]。

**落地产物**：

- 计划（含对抗审查修订）：[`docs/superpowers/plans/2026-09-13-dshbot-continuity-memory.md`](../superpowers/plans/2026-09-13-dshbot-continuity-memory.md)
- 设计与取舍 + 不变量 + 后续工作：`C:\Ai\dshbot\docs\continuity-memory.md`
- 产品契约（invariants/Allowed touch/gates）：[`docs/features/dshbot.md`](../features/dshbot.md)
- 子系统架构与文件地图：[`docs/handbook/modules/dshbot.md`](../handbook/modules/dshbot.md)

**结论摘要**：dshbot 的持续会话骨架强于两个参照（单 transcript 终身制 + durable 邮件 peek/ack + 精确 turn 结算）；本次补齐的四层为 目标续转（宿主 goal 栈惰性桥接）、双轨条目记忆、自主提取回路、routine 续作/监视/本机触发 + 触达。明确不做：心跳自转、per-bot 容器、外部记忆 SaaS、跨设备。
