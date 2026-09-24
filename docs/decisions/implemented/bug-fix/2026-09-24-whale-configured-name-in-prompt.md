# Decision: 助理配置名必须进入实际提示词

Status: implemented

中文 | [English](2026-09-24-whale-configured-name-in-prompt.en.md)

## Problem

用户把助理改名后，侧栏和会话标题显示新名字，但她回答「你叫什么」时仍自称鲸鱼娘。配置读取与标题同步正常；`whale-girl` 预设却把空白 persona prefix 标为 `complete:true`。Harness 的提示词组装器遇到 complete section 后只保留该节，因此运行时 `dsh-whale:persona` 被丢弃。旧对话和家目录中保留的「鲸鱼娘」进一步诱导了旧自称。

## Decision

预设的空白 prefix 只用于遮蔽部署默认人格，不再标记为 complete。运行时 `dsh-whale:persona` 继续从 catalog 读取当前名字、性格、称呼与用户追加人设，并明确要求自我介绍及被问名字时使用配置名；旧对话中的自称和「鲸鱼娘」角色类型不覆盖名字。不改写用户的会话历史或家目录 AGENTS.md、MEMORY.md。

## Alternatives considered

- **只加强动态人格文案** — rejected：complete 空白节仍会丢弃整段文案，无法改变实际模型输入。
- **重建会话或清除旧消息** — rejected：配置已经持久化且动态注入原本支持下轮生效；重建会话会损失用户历史。

## Consequences

改名从下一轮提示词组装起生效。已有旧回答保留原样；测试使用真实提示词组装器验证配置名随 catalog 变化进入组装结果，并钉住预设不得以空白 complete 节覆盖它。
