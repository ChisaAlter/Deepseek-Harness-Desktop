# Feature: Whale Assistant (dsh-whale 内置鲸鱼娘助理)

| Field | Value |
| --- | --- |
| **id** | `whale-assistant` |
| **status** | `active` |
| **last verified** | 2026-09-16 — 统筹面扩展为全量编排（用户明示授权）：新增 `lib/observe.js` 脉冲（全局 session/event 环形缓冲 + `watches.json` 盯梢 + `schedules.json` 定时，唤醒=经 `controller.prompt` queue 进她自己的会话）、`lib/session-tools.js`（search/read/queue/cancel/rename/fork/delete/select_model/update_queue/watch/schedule）、`lib/desktop-tools.js`（desktop state/marketplace/config/plugin 经 `/desktop/*` 回环）；`src/main/profile-ops.js` 把插件启停+renderer 配置写抽成 IPC 与回环共用的序列化实现，`desktop-install-control.js` 在同端口扩 `/desktop/state|marketplace|config|plugin` 路由；隐私不变式从「不读正文」改为「可读正文（用户授予统筹权）但不得外泄到 IM/通知/其他会话」。早前 2026-09-16 — `pet/look` 改走真实会话回合：会话模型声明 image 输入或已配 visionFallback 时截图经 `controller.prompt` 入队成真 turn——用户行=截图+「看一眼我的屏幕」指令、她的点评=真 turn 结算的 assistant 行（不再是塞括注的用户记录，伪造 assistant/message 会被重放校验拒绝、伪造 turn 外壳会让活 Agent 的 lastTurn 过期）；文本会话路由回退独立 `llm.stream` 视觉调用（look 模型兜底），交换落 `kind:'plugin'`+`form:'notice'` 折叠 context 行、图片不入历史防毒化。早前 2026-09-16 — `whale-girl` preset 增 `hidden: true`：preset 选择器与设置名单不再展示它（hidden 为上游 preset.yml 新字段，远程 roster 在健康时省略、损坏时仍列出供删目录）；按 id 挂载与 dsh-im `/preset` 宿主侧名单不受影响。早前 2026-09-16 — 新增 `pet/look` 端点：桌宠「看看」的截图+所选 provider/model 经此一次性 `ctx.llm.stream` 调用派发（attachment ref 载图、`buildPersonaText` 作 system、45s deadline、`purpose:'vision-describe'`），修复桌面侧只看 model 字符串、永远打通用 baseUrl 的断链；模型/adapter 错误带 code+status+detail 如实回报。早前 — 合并设置重设计为紧凑信息架构：主页面收束为扁平行（桌宠侧体型+不透明度并一行、自语+乱逛并入「自主行为」行、锁定/Shift 两开关折叠为「拖拽方式」三档单选；助理侧「名字与称呼」双输入一行、「默认模型+推理强度」双下拉一行、IM 默认行内开关），长文本与不定长列表收进 `ui-primitives` Modal 弹窗（额外人设/长期记忆显式保存·取消，技能弹窗列开关、行 desc 显示「已启用 n/m」摘要）；助理控件改逐个 write-through（`settings/update` 部分补丁逐字段合并，文本 blur/Enter 提交、下拉开关即改即存），整表「保存」按钮取消。性格去重：桌宠「性格」为双人格唯一控件，主进程 `applySettings` 把变更经 loopback `/dsh-whale` `settings/update {personality}` 镜像进助理 catalog（启动一次性重断言愈合旧分歧；仅 transport 失败排队 30s 重试，被应答的拒绝记 dbg 不重发）。早前 — 设置并入桌宠分区：插件不再注册 `settings.section`（独立「{名字}」导航分区取消），改投 `settings.pet.item`（`pet` 分区「助理」组、总开关正下方）——同一角色一页设置；`settingsNavigation.open('whale')` 全改 `open('pet')`（会话头 ⚙ 齿轮、面板页回退钮）；子槽型登记于 `ui-settings` `contract/slots.ts`、随 pet 分区声明/卸载；pet-section/apply-desktop 用例 + 包 vitest 87 pass、包 tsc 干净。早前 — persona 增「说话方式（个人助理，不是客服）」块：朋友式短消息、空行拆多条（对话卡逐条渲染）、先反应后办法、禁助手腔、主动 `whale_remember` 记用户的事再自然提起。早前 — 新增 `userTitle` 字段（她对你的称呼）：schema + `settings/update` sanitize + catalog 直通 + `buildPersonaText` 注入「你称呼用户为「X」。」；留空不落该行。设置页改 DSHD 规范 Setting-Cell 扁平行（`ui-settings-general` 同款：左 title/desc 右控件、0.5px `border-l2` 行底发丝线、`max-width:880px`）：称呼/名字行右对齐 `Input`、性格/模型/推理行 inline `SettingsSelect`、IM `Switch`、人设与记忆行「编辑」展开 textarea；`dsh-whale-card` 撞名问题消除（设置行不再复用助理页会话卡类名）。行内输入 focus-within 覆盖为 `border-l4`（原 brand-primary 橘框）。早前 — `dsh-whale-desktop.test.js` 9/9 + skip-compose 契约（mock 8/8 + 真 CLI 两轮通过）+ vendored 依赖完整性门禁绿 + `lib/index.js`/`lib/tools.js` 真 ESM import 冒烟通过 + 全套 1656 pass / 0 fail。2026-09-15 追加：去掉 `composer:'managed'`（恢复模型/推理强度/权限 dock + header actions；旧 managed 帧经 ensure 迁移）+ 会话头部 ⚙ 齿轮（`conversation.session.header.actions`，owner 门控）直达设置分区——CDP 实机验证（modelSeat 出现、齿轮点击开分区）。**实机验收已过**（CDP 驱动真桌面）：侧栏「新会话」下「{名字}」面板行（默认鲸鱼娘，跟随配置）+ 点击直达常驻会话 + 设置分区全字段渲染；`/dsh-whale` RPC（catalog/settings/update/pet/say）200 + 未认证 401；改名/换性格经真 UI 保存落盘（settings.yaml）并实时联动侧栏标题/会话 presentation；常驻会话复用 sessionId 跨重启；`pet/say` → outbox → watcher → 桌宠气泡截图确认。真实模型轮次已验（deepseek-official/deepseek-flash 真实回合，桌宠卡片 DOM 发送→回复落卡→whale_pet_say 气泡闭环）；IM 默认绑定未验（无 IM 账号）。 |

## User paths

1. 默认**不挂载**。主窗 Settings → `pet` 分区 →「鲸鱼娘助理」（`whaleAssistantEnabled`，默认关；宠物右键 ⚙ 格也直达该分区）→ 保存配置触发 Harness 重启 → 侧栏「新会话」下方出现「✨ {名字}」全局面板行（默认鲸鱼娘，跟随配置名），`pet` 分区「助理」组在开关下方出现她的全部字段（无独立导航分区），会话列表出现常驻会话「🐳 {名字}」。
2. 助理会话是真实 DSH session：`whale-girl` agent preset（persona + fs/fs-search/skill + `dsh-whale/tools` 统筹工具面），cwd 固定 `dsh-home/data/whale/`（她的"家"——AGENTS.md/MEMORY.md/skills 都在里面，随会话自动注入）。`sessionId` 持久化于 `dsh-whale` 设置命名空间，重启复用不重建。
3. 设置块（`settings.pet.item` id `whale`，寄于主窗 `pet` 分区「助理」组、总开关正下方——助理与桌宠同页，不再注册 `settings.section`）：紧凑行逐个 write-through（`settings/update` 部分补丁）——「名字与称呼」一行双输入（blur/Enter 提交，名字同时刷新侧栏面板行）、「默认模型 · 推理强度」一行双下拉（provider/model/reasoningEffort 作为一个字段同交，空=跟随会话默认）、IM 默认接待行内开关；「额外人设」「长期记忆」「技能」三行各带「编辑/查看/管理」钮开 `ui-primitives` Modal（人设/记忆 textarea 显式保存·取消、记忆另可清空需确认；技能弹窗每 SKILL.md 一开关即时生效、关闭=移入 `skills-disabled/`，主行 desc 显示「已启用 n/m」或空目录提示）。性格无独立控件——见不变式。
4. 统筹工具面（preset-scoped 注册，仅 whale-girl 会话可见）：
   - 找/读：`whale_list_sessions`（元数据+工作目录+running）/ `whale_search_sessions`（全文搜消息正文）/ `whale_read_session`（follow 快照取最新页 + `page` 按 beforeSeq 翻更早，`[#seq] actor: text` 行）/ `whale_recent_events`（脉冲环形缓冲，最新在前）/ `whale_session_queue`（control baseline 的排队消息 + 后台 job，itemId 供 update_queue 用）。
   - 控：`whale_send_to_session`（跨会话投递，仍以用户名义发话）、`whale_new_session`、`whale_cancel_session`、`whale_update_queue`（edit/remove/steer 排队项）、`whale_select_model`（会话本地选模型，`saveAsDefault:false`）、`whale_rename_session`、`whale_fork_session`（atSeq/beforeSeq 锚点前缀）、`whale_delete_session`（仅已归档会话，永久）。
   - 自身：`whale_watch`（盯某会话 turn/end → 唤醒她自己，once 默认 true）/ `whale_schedule`（inMinutes 一次性 / everyMinutes 间隔 / daily "HH:MM"，到点把 text 作为提示词唤醒；`maxRuns` 封顶）/ `whale_usage_today` / `whale_remember`（追加 MEMORY.md，上限 40k）。
   - 桌面：`whale_desktop_state`（版本/kernel/插件清单/disabled/非密配置）/ `whale_marketplace`（目录浏览）/ `whale_desktop_config`（renderer 白名单键补丁）/ `whale_desktop_plugin`（list/install/remove/enable/disable）——全部经 `/desktop/*` 回环通道。
   - 桌宠：`whale_pet_say` / `whale_notify`（写 `data/whale/pet-outbox.jsonl`）。
5. IM 默认接待：设置 `imDefault=true` → 插件 `applyImDefault` 把 `agentPreset: 'whale-girl'` 写进 `$DSH_HOME/integrations/dsh-*/config.json` 中**未自选**人格的账号（`undefined`/`''` 才填充）；已有 `/preset` 选择永不覆盖，dsh-im 侧 `ensure` 只对新绑定 bot 生效。关闭时仅移除等于 `whale-girl` 的值。
6. 宠物「找她办事」→ 主窗口聚焦 + 侧栏「新会话」下方的「{名字}」面板行直达她的常驻会话，或会话列表里直接进入。宠物「聊聊」对话卡（助理开启时）即共享此会话：卡内模型/推理下拉写会话本地选择，↗ 钮跳转到同一会话，消息双向互通（卡内发送进会话日志、DSHD 侧消息经 3s 轮询回填进卡）。侧栏入口走 `sidebar.panellist`（list slot，位于新会话按钮与工作区之间，label 跟随配置名——改名后经 ledger 重注册即时换行文字）+ `main` keyed slot 注册一个重定向组件（`assistant/ensure` → `sessions.open` → `selectPanel(null)`，选中即开会话不驻留中间页）——不用 `sidebar.nav.tab`，不与 会话/机器人 抢顶部 tab 位。会话头部标题右侧有 ⚙ 齿轮（`conversation.session.header.actions` 项，按 `presentation.owner` 门控仅她的会话显示）→ `settingsNavigation.open('pet')` 直达 `pet` 分区（她的字段在「助理」组内）。

## Invariants

- `vendor/dsh-whale` 是随包发布的实现源，`build.extraResources` 含 `dsh-whale/**`；`vendor/dsh-whale/node_modules` 随仓跟踪（`.gitignore` 例外，与 dshbot/dsh-im 同例）。
- 挂载只经桌面自有 overlay `desktop-plugins/dsh-whale/desktop-dsh-whale.patch.yml`，仅 `whaleAssistantEnabled`（默认 false）为 true 时随每次启动（全量+skip）经 `--patch` 传入；false 时 ensure 删 overlay、不校验 vendor、不阻断启动。绝不写用户层 `cordis.patch.yml`；受管块残留每次启动 strip。
- 包名解析走 `profiles/web/node_modules/dsh-whale` junction → vendor 源；junction 指向错误时重建。
- ensure 失败（源缺失/声明入口或运行时依赖不全）在启用时阻断启动。
- `dsh-whale` 入 `DROPPED`/`DROPPED_BASENAMES`（市场目录隐藏、安装拒绝、manifest 剥离）与 `dshbot` 别名名单同例；disable 名单免疫（`withoutDshWhaleAliases`）。
- 插件服务一律在声明 inject 的**注入子 ctx** 上解析（`ctx.inject?.(['sessionController'], host => …)` 等）。**例外**：`/dsh-whale` RPC 不走 `connection.rpc.handle`——其实现内部 `owner.webServer` 经 traceable shadow 绑到提供方 fiber，消费方调用必抛 "cannot get property webServer without inject"（dshbot `/dshbot` 通道带同款隐患，默认关未暴露）。改为 `ctx.inject(['connection','webServer'])` 子 ctx 上 `host.webServer.register` 直接挂 `/dsh-whale` prefix 路由（dshbot `/dshbot-hook` 同款），复刻 `client-request`/`server-response` envelope + `connection.requestRejection` 认证 + 有界 JSON 体。
- 客户端 `SettingsSelect` 的 options 契约是 `{id, label}`（`options.find(o => o.id === value)`），**不是 `{value, label}`**——传错字段时选中态静默丢失、菜单项 `entry.id` 全为 `undefined`，选择不落 form state。
- `whale-girl` preset 的 `preset.yml` 声明 `hidden: true`：它只为本插件/dsh-im 按 id 挂载的会话存在，不出现在 preset 选择器或设置名单；hidden 是呈现而非能力，`agentPreset:'whale-girl'` 的会话创建与 IM per-bot 选择照常。preset 目录损坏时仍以 broken 行列出（名单是唯一能删它的表面）。
- 统筹工具只经 preset 行 `dsh-whale/tools` 在**会话作用域**注册；不在 host apply 全局注册，不泄漏到其他会话。工具不做 `restrict`——whale 是普通助理会话，全局工具对她本就可用。
- 人格注入走 `ctx.systemPrompt.section`（`dsh-whale:persona`，order 20）：运行时解析 catalog 快照 → 改名字/性格/人设文本**即时生效**，不重建会话、不 rewrite preset 文件。
- `dsh-whale` 设置命名空间 schema 字段：`name` / `personality` / `userTitle` / `personaText` / `modelProvider` / `modelModel` / `modelReasoningEffort` / `imDefault` / `sessionId`。技能开关不落 catalog——目录搬移（`skills/` ↔ `skills-disabled/`）即事实。客户端写经 `/dsh-whale` RPC `settings/update`（host 侧走 revision 化 catalog scope `settings.update`，并发写拒绝丢更新）。`personality` 不由设置页直写：桌宠「性格」是双人格唯一控件，主进程宠物管理器在 `applySettings` 变更时经 loopback `/dsh-whale` `settings/update` 镜像（启动时一次性重断言愈合旧分歧；仅 transport 失败排队 30s 重试，被应答的拒绝记 dbg 日志不重发——同一值不会因重试收敛）。
- `/dsh-whale` 的 `pet/*` 端点服务桌宠：`pet/state`（ensure 会话 + `modelCatalog()` 组表 + `modelSelection` 投影当前选择 + follow 快照尾回填历史）、`pet/select-model`（`controller.selectModel`，`saveAsDefault:false` 会话本地）、`pet/chat`（`controller.prompt` 入会话 + `ctx.on('session/event',{global:true})` 总线等本回合——按 `data.source.rpcId` 认领自身 user/message、只计之后 turn 的 assistant/message，`turn/end` 错误如实回报；**不用 follow 流等回合**——Remote 流的载体随调用方生命周期提前关闭）、`pet/look`（「看看屏幕」双路径——一眼属于她的对话：**会话路由能载图**（所选模型声明 image 输入或 `visionFallback` 已配置——`lookImageAdmissible`）时经 `controller.prompt` queue 跑真实回合：截图 base64 直入 content（host 侧 promote 成 attachment ref），user 行=图片块+「看一眼我的屏幕」指令、她的点评=真 turn 结算的真实 `assistant/message`（复用 `petSessionTurn` watcher 等本回合；prompt 准入被拒才回退，已入队回合的结果如实回报含 timeout/turn-error）；**载不了图时**保持一次性 `ctx.llm.stream` 视觉调用（所选 look provider/model 解析 adapter/凭据——桌面 baseUrl 表达不了目录路由；截图 `saveImages` 落内容寻址附件、`createUserMessage` 载 `ImageBlock`、`system:buildPersonaText`、maxTokens 1024、45s、`purpose:'vision-describe'`；adapter 失败以 finish chunk 到达，`lookFinishError` 映射 `{code,message,status}`；`off` 档时 `reasoningEffort:'off'`），成功后 `logLookNote` 落一条 `kind:'plugin'`+`form:'notice'` 的折叠 context 行（summary「她瞟了一眼屏幕」+括注点评文本——图片不入历史：此路径只在会话路由载不了图时跑，入图会毒化后续每条请求）；记入失败 caller-contained）。Remote 方法第二参必须给真 `AbortSignal`（实现内部 `signal.throwIfAborted()`）。
- `pet-outbox.jsonl` 是插件→桌宠的**单向**桥（append-only jsonl，非 zstd）：`pet-dsh-watch` 追加尾随它并把每行 `{kind,text}` 作为 `dshWhale` 优先级-2 提醒冒泡；watch 透传 `text`（≤512 字符）与 `kind`（≤32 字符）——`kind:'notify'`（`whale_notify` 写入）的气泡在桌宠上钉住并带 ✕，仅用户手动关闭才退场，`say` 等其余 kind 保持限时。
- 助理会话创建：`sessionController` 于 `ctx.inject(['sessionController'])` 子 ctx 上解析；`presentation.owner='dsh-whale:assistant'`、`title='🐳 '+name`，**不带 `composer`**（她是普通会话：composer dock 的模型/思考强度/权限选择器、header actions 全套保留——`managed` 会把这些全部裁掉，且 managed 会话里选模型不写全局默认）。`controller.list()` 行的 presentation 在 `row.projections.values.sessionListMetadata.presentation` 下（不是顶层字段）——ensure 每次启动对比 title+composer，旧版 `managed` 帧经 `setPresentation` 迁掉。
- 权限模型（用户明示授予的统筹权，2026-09 起生效）：`whale_read_session`/`whale_search_sessions`/`whale_recent_events`/`whale_session_queue` 可读其他会话正文与排队消息；`whale_send_to_session` 仍以用户名义发话、不再要求逐条先确认，但人格提示词约束「只传达用户交代的事」；`whale_delete_session` 只作用于已归档会话且不可恢复。读到的私密内容不得外泄到 IM、桌面通知或其他会话——提示词明示，宠物层（pet-growth/watcher 聚合）仍只读用量桶、不读正文。
- 唤醒面：`lib/observe.js` 在 host ctx 常驻——`ctx.on('session/event', {global:true})` 收全局事件进 150 条环形缓冲；`data/whale/watches.json`（盯梢：目标会话 turn/end 时把备注+detail 作为 queue prompt 唤醒她，她自己会话的事件不触发）、`data/whale/schedules.json`（30s tick，到点同样 queue 唤醒），均原子写、重启后重载。
- 桌面统管：`whale_desktop_*` 经 `desktop-install-control` 同端口 `/desktop/*` 路由调主进程（同一随机 Bearer token，仅注入 Harness 子进程 env）——`GET /desktop/state`、`GET /desktop/marketplace`、`POST /desktop/config`（`normalizeRendererConfigPatch` 白名单）、`POST /desktop/plugin`（install=目录 id 或 `github:` 规格/remove/disable/enable）。插件启停与配置写统一走 `src/main/profile-ops.js`——launcher IPC 与回环通道共用同一条序列化 align 链（写与重启不交错）；install 复用 `isValidGithubSpec`/`normalizeAllowBuilds` 与 curated catalog，remove/disable 走 `isPresetPlugin`/`OFFICIAL_TEMPLATE_BUNDLES`/内置别名守卫（她无法卸载或禁用自己所在包）；装/卸/开关插件与 toggling 内置开关都会重启 Harness——她的会话随之重启，工具描述与人格均明示。
- `whaleAssistantEnabled` 开关位于主窗 `pet` 设置分区（桌面自有、始终可达——插件未挂载时插件 client 不加载，开关放插件贡献的块里会无法打开）。挂载后插件经 `settings.pet.item` 贡献在同分区「助理」组内提供完整配置——同一角色一页设置，不分两个导航分区。

## Allowed touch

- `vendor/dsh-whale/**`（全部）
- `src/main/dsh-whale-desktop.js`, `src/main/dsh-whale-desktop.test.js`
- `src/main/harness-controller.js`, `src/main/index.js`（ensure/overlay 接线 + `/desktop/*` ops 接线）、`src/main/plugins.js`（DROPPED 表）、`src/main/ipc.js`（`whaleAssistantEnabled` 重启分支 + disable/enable/save-config 委托）、`src/main/config.js`（键已在白名单）
- `src/main/profile-ops.js`（IPC 与回环共用的插件启停/配置写实现）、`src/main/desktop-install-control.js`（`/desktop/*` 路由）及对应测试
- `src/main/pet-dsh-watch.js`（追加 pet-outbox 尾随）、`src/renderer/pet-live2d.js`（`dshWhale` alert 类目 + ⚙ 格跳 `pet` 分区）、`src/renderer/dialogue/whale.json`（`dshWhale` 类目）、`vendor/deepseek-harness/packages/client/ui-settings-general` 的 `pet` 分区（助理开关行 + `settings.pet.item` 子座声明与渲染位）、`vendor/deepseek-harness/packages/client/ui-settings` 的 `contract/slots.ts`（`settings.pet.item` 槽型）
- `package.json` extraResources filter、`.gitignore` vendor node_modules 例外、`scripts/after-pack.js`（如需 vendor 清单）
- 本卡、handbook、Feature 索引、QA 记录

## Do not touch

- `vendor/deepseek-harness/**`（ui-settings-general 的 `settings.interface.item` 不加 whale 行——开关走主窗 `pet` 设置分区，经通用 `shell:save-config`）
- `vendor/dsh-im` 源码（IM 默认绑定只经 overlay `config.agentPreset`，不改包）
- `vendor/dshbot/**`、dshbot 的 catalog/会话/RPC 面
- 其他会话的行为与宿主通用契约（presentation 不识别 `dsh-whale` 包名）；注意 `composer:'managed'` 会裁掉 composer dock + header actions/utilities + `conversation.input.model` 座——本特性**故意不用** managed（她要模型/推理强度可选；代价是 composer 里选模型会写全局默认，同普通会话）。`conversation.input.managed` 是 single slot 且被 dshbot 占用，不可复用。
- `live2dPet.*` 的宠物层职责——助理不代替桌宠循环，桌宠不直接读写 `dsh-whale` catalog

## Gates

| Kind | What |
| --- | --- |
| Automated | `node --test src/main/dsh-whale-desktop.test.js src/main/dsh-whale-orchestration.test.js src/main/pet-dsh-watch.test.js src/main/harness-controller.test.js src/main/plugins.test.js src/main/ipc.test.js src/main/desktop-install-control.test.js` + 全套 `npm test` |
| Manual / QA | 启用 → 侧栏「新会话」下「{名字}」面板行 + `pet` 分区「助理」组出现她的字段 + 常驻会话出现；改名字/性格即时生效；skills 开关；IM 新绑定默认人格；实机回归 |

## Sources

- Decision: none

- 蓝本：`vendor/dshbot`（catalog scope / systemPrompt section / preset 播种 / sessionController / RPC+webServer 注入模式）、`src/main/dshbot-desktop.js`（overlay 挂载机）、`docs/features/dshbot.md`
- 计划：`C:\Users\48818\.devin\plans\plan-982243d12396a533.md` Part C
- 上游契约：`vendor/deepseek-harness` 的 `settings.pet.item`（`pet` 分区子座）/`sidebar.panellist`/`main`（keyed）/`tools.register`/`skill-filesystem.customSkillDirs`/session presentation/`settingsNavigation` 服务
