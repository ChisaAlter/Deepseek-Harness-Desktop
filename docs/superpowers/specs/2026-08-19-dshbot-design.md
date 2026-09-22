# dshbot：侧栏 Bot 列表与群聊

> **状态（2026-08-25）：** 产品已改为**独立可发布 dsh 插件**（feature 卡 `dshbot` status=`standalone`）。桌面**默认不预置**；市场第一方行 / `dsh plugin add` 可选安装。下文「决定」中与现行实现冲突的段落以 **Grok-aligned 本地协议（2026-08-24）** 与 feature 卡为准。

桌面壳不再强制把插件 `dshbot` 装进 web profile；可选安装后官方侧栏多一个 Tab 插槽；不装时侧栏与现在一致。视觉语言仍是 `ui-primitives` + `--dsw-alias-*`，编辑走居中 `Modal`，不占用右侧 Files/Browser。

## 决定

1. **每个 Bot 是持久联系人。** 目录在 settings 命名空间 `dshbot`。点列表项 `sessions.open` 打开已有对话。会话打 `origin: 'dshbot'`，工作区浏览器的 `sessionVisible` 把它们藏起来。
2. **~~群聊是 WhatsApp 群…（含 `NEXT:` 脚注调度、`maxSpeaks` 默认 12 / `maxRounds` 默认 4）~~ — Deprecated 2026-08-24。** 仍成立的部分：只从侧栏「机器人」加号创建、至少两名成员、房间 preset `dshbot-room`、父会话不调聊天模型、可见气泡仅用户与成员。调度与上限以下方「Grok-aligned」为准（无 `NEXT:` 决定下一说话人；`maxSpeaks=10` / `maxRounds=3` / 成员上限 6）。完整旧文保留在 git 历史；勿再按 `NEXT:` / 12/4 实现。
3. **Bot 私有模型不改全局默认。** 只在编辑资料里选模型；保存和打开联系人时 `session.selectModel({ persistDefault: false })`。composer 不渲染 `conversation.input.model`。
4. **人设按会话注入。** Host `systemPrompt` section 仅当组装中的 session 在目录里且不是房间时写入 `description`。
5. **有消息的 1:1 会话与已建立群不能改 cwd。** 空白 1:1 会话可以在编辑里换工作区并重建绑定；群只在创建时选择工作区，建立后选择器锁定。
6. **头像在编辑弹层里选。** 目录项带 `avatar`：八种机器人形状加关闭色板，或上传后裁成圆/方的小 JPEG。没有记录时按 id/名字哈希落到一种形体。侧栏在 `session.running` 时、群聊气泡在工具还没有 result 时，形体像软泥一样连续压扁、鼓边、拉长并侧倾，眼睛转动并眨眼。编辑弹层表单可滚动。不做 Generate。

## 官方钩子

- `ui-sidebar`：`sidebar.nav.tab`（list）+ `sidebar.page`（keyed）。零贡献不画 Tab。插件 Tab 下隐藏 New Session。
- `SessionHeader.origin`：`'subagent' | 'dshbot'`。`session.create` 只接受 `origin: 'dshbot'`。空白 `origin: 'dshbot'` 会话跳过新对话 Hero；`connectWorkspace` / `connectNoDirectory` 不复用它们。
- `conversation.chat.empty`：ChatView 在无 Node 时渲染的可选 list；dshbot 填成员头像空态。
- `conversation.input.model`：InputBar 在 `origin === 'dshbot'`（一对一与群聊）或 `agentPreset === 'dshbot-room'` 时不渲染该座位。模型只在机器人编辑资料里改。房间再藏 `+`、plan、ContextMeter、`$`；`@` 菜单只留 dshbot 成员。
- `selectModel.persistDefault` 默认 `true`。

## 非目标

- 把 Bot 设置塞进右侧 surfaces。
- 改 `agent-loop` 或让多个模型写同一条 agent-loop。
- 头像商店、分区、未读。编辑资料里的头像选择不是商店。
- 普通 `dsh web` 自动带此插件。
- 做成 `packages/client` 官方包。
- 本史诗不做 Routines / 云电脑 / 跨用户 Shared Room。

## Grok-aligned 本地协议（2026-08-24）

产品定位为**编码协作花名册**（评审/反对/补全/落地等角色），协议对齐公开 Grok Bot 本地群语义，自研实现、不搬逆向源码。

1. **可见性闸门：** 成员子会话可跑 `send_room_message`；只有投递正文进群 transcript；`(pass)` / 空不画气泡。裸助手文本不进房。
2. **调度：** Host 从最近用户消息解析 `@名` / `@everyone|@all`；否则全员。`orderRoundSpeakers` 按轮旋转；成员为 2–6 个，硬顶 `maxSpeaks=10`、`maxRounds=3`、每成员每回合最多 2 条投递。一轮全 pass 则停。`maxSpeaks` 按 Grok 语义**只计可见投递**（2026-08-27 修正，此前短暂按尝试计）：pass 与成员失败推进轮转但不耗额度；重启重放的无结果调用不占位、下次重新点名同一成员；总尝试由全 pass 停轮 + `maxRounds` 封顶。同 turn 两条投递是两条独立可见消息。不再用 `NEXT:` 脚注决定下一说话人（旧日志仍可剥离显示）。
3. **取消：** 用户新消息抬高房间 turn epoch（与现有串行 `ask_participant` 流配合）；成员失败视为 pass。
4. **A2A：** `send_to_agent` 异步入队；优先尝试 `agent.followup` 唤醒；失败则 inbox 在下次 1:1 systemPrompt 注入消化（离线 inbox 仅 1:1）。群投递仅限成员；群无离线 inbox，闲置房间返回 `ok: false` 明说未投递。Priority 对群成员回合不打断。
5. **记忆：** `$DSH_HOME/dshbot-memory/<botId>.md`；只由 `remember` 工具显式写入，编辑器不提供文本框；1:1 persona 注入。
6. **名单：** Pin / Hide；Duplicate 不拷会话历史与 inbox。
