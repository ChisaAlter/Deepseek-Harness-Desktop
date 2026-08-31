# Feature: 最新用户消息「撤回重编辑」（composer 编辑会话 + fork 重发）

| Field | Value |
| --- | --- |
| **id** | `message-edit` |
| **status** | `active` |
| **last verified** | 2026-08-31 — pin `dsh-v0.1.2-alpha.2`；确认汇调用 `sessions.fork({ sessionId, beforeSeq: seq, increaseTitle: true })`。首轮编辑打开空子会话（`beforeSeq` 前无更早 turn/end → cut 0）。官方 `atSeq` 仍给其他调用方，二者不得同传。 |

## User paths

1. 会话空闲时，最新一条用户消息的操作条出现铅笔（历史消息没有）；点击**不 fork**，而是把**底部常驻 composer** 晋升为编辑会话：composer 收起当前草稿与图片、播种原文、聚焦且光标在末尾、卡片上出现「正在重新编辑此消息」横幅（带取消）；该气泡就地换成编辑态标记（原文变暗 +「正在下方输入框中重新编辑」+ 取消）。
2. 编辑面就是真 composer：装饰／引用、图片附件、词表、Enter/Shift+Enter/IME 策略、提示通道、尺寸调整全部原生可用。编辑期间斜杠不触发命令裁决（修订就是普通消息），命令认领被拒绝，草稿持久化镜像被抑制。
3. 取消有方向：composer 横幅取消或 IME 安全的 Escape 结束会话、焦点留在 composer；气泡侧取消结束会话并把焦点交还铅笔。两侧都恢复收起的草稿与图片。
4. composer 发送即确认：确认时刻复查「仍是最新 + 源会话空闲」，通过后 `sessions.fork({ sessionId, beforeSeq: seq, increaseTitle: true })` → 打开子会话 → `addImages`／`setDraft` → `submit`；源会话日志不变，子会话切在被编辑消息之前。
5. fork 失败／子作用域缺失／守卫不再成立：composer 出本地化错误提示，编辑会话带草稿继续待命，可重试或取消。
6. 会话运行中或消息含非文本块：铅笔可见但禁用，tooltip 说明原因。

## Invariants

- 铅笔只出现在**最新**已定稿用户消息上；点击铅笔不产生任何 Host 写入（首次写入是确认时的 fork）。
- 编辑面必须是 `conversation.composer.bar` 路径上的真 composer（`SessionInput.beginEdit` 编辑会话）；**禁止**在气泡里再造第二个简化编辑器。
- 源会话日志不可变；子会话切点在被编辑轮次之前，模型不会重复看到旧提示词。
- 失败路径不丢草稿、不留 pending 锁死；「仅限最新 + 空闲」在确认时刻仍然成立（stale/running 守卫）。
- 编辑会话存续期间：submit 改道到编辑汇、斜杠裁决跳过、命令认领拒绝、持久化镜像抑制；结束（成功或取消）恢复收起的草稿与图片。
- 底部 composer 不经 `conversation.blocks` 禁用；一切 UI 仅官方 tokens（`--dsw-alias-*`／`--dsw-specific-*`）。
- 文案中英齐备（`messageEdit` 命名空间 + ui-conversation 的 `input.editCancel`）；产品文案中文、代码注释英文。

## Allowed touch

- `vendor/deepseek-harness/packages/client/ui-message-edit/` — 插件本体（铅笔、编辑态气泡、store、文案、样式、测试）
- `vendor/deepseek-harness/packages/client/ui-conversation/src/client/input/`（contract/facade 的编辑会话）、`skeleton/InputBar.tsx|.module.css`（编辑横幅）、`locales.ts`、`src/client/index.ts` 导出与相应测试
- `vendor/deepseek-harness/packages/client/ui-conversation/src/client/chat/MessageItem.tsx` 与 `contract/slots.ts` 中 `user-actions`/`user-editor` 座位 — 仅在座位契约确需扩展时
- `vendor/deepseek-harness/apps/web/tests/message-edit.e2e.ts` 与其 aria 预期
- `vendor/deepseek-harness/.agents/notes/implemented/feature/2026-08-15-inline-user-message-edit*`、`2026-08-25-message-edit-production-polish*`、`2026-08-25-message-edit-composer-edit-session*` — 事实保鲜

## Do not touch

- 不发明改写已定稿 `user/message` 的 Host API；不改会话日志格式。
- 不改 fork-beforeSeq 语义（撤回重编辑 = 子会话分支，不是原地改写）。
- 不回退到气泡内 textarea／独立编辑器（产品明令否决）。
- 历史消息编辑、多模态（图片入口）编辑、trajectory/waterfall 视图 — 除非用户明确扩权。
- `MessageIconActions` 内不得出现编辑存根（已被 2026-07-31 简化记录移除）。

## Gates

| Kind | What |
| --- | --- |
| Automated | `pnpm vitest run packages/client/ui-message-edit`；`packages/client/ui-conversation/tests/input-edit-session.client.spec.ts` 与 `input-bar.client.spec.tsx`；`pnpm run test:gui`；`DSH_SNAPSHOT=replay pnpm run test:web` 中的 `apps/web/tests/message-edit.e2e.ts`（keyless 端到端：铅笔晋升 composer 不 fork、Escape 留焦、气泡取消归还焦点、composer 发送 fork-重发、源会话不变）；触碰文件受 `test:coverage` per-file 100% 门槛 |
| Manual / QA | 发消息→等空闲→点铅笔→底部 composer 出横幅并回填→改字→发送：子会话出现并从新文本继续；Escape/横幅取消恢复原气泡且草稿复原；运行中铅笔禁用 |

## Sources

- Agent Note: [2026-08-25-message-edit-composer-edit-session](../../vendor/deepseek-harness/.agents/notes/implemented/feature/2026-08-25-message-edit-composer-edit-session.md)（现行）、[2026-08-15-inline-user-message-edit](../../vendor/deepseek-harness/.agents/notes/implemented/feature/2026-08-15-inline-user-message-edit.md)、[2026-08-25-message-edit-production-polish](../../vendor/deepseek-harness/.agents/notes/implemented/feature/2026-08-25-message-edit-production-polish.md)
- Implementation entry: `vendor/deepseek-harness/packages/client/ui-message-edit/src/client/` 与 `vendor/deepseek-harness/packages/client/ui-conversation/src/client/input/`
- Package README: [ui-message-edit README](../../vendor/deepseek-harness/packages/client/ui-message-edit/README.md)
