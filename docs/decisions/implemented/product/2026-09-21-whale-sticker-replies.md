# Decision: 鲸鱼娘会话表情包（whale_sticker 工具 + 内置贴纸库）

Status: implemented

中文 | [English](2026-09-21-whale-sticker-replies.en.md)

## Problem

鲸鱼娘助理在会话里只能发文字，情绪表达单薄；社区已有现成的鲸鱼娘表情包开放档案（蓝色大肥鱼.com，EDMOK/blue-fish-archive，205 张逐张核对过名称/标签），用户希望她在聊天里偶尔甩一张表情包。

## Decision

把表情包做成「她自己挑、自己贴」的能力，而不是宿主注入的图片消息：

- `vendor/dsh-whale/stickers/` 内置贴纸库：fork 仓 `ChisaAlter/blue-fish-archive` 的 `previews/` webp 缩略图（201 张，约 7.6MB）+ `index.json`（`{file,name,tags}`，名称标签取自档案站人工核对数据）；附 README 记录出处与版权归属。
- 新增 preset-scoped 工具 `whale_sticker`（`lib/sticker-tools.js`，经 `dsh-whale/tools` 注册，只有 whale-girl 会话可见）：可选 `query` 按名称/标签子串匹配，无匹配回落全池随机；进程内 12 格最近队列防止连发同一张；用户/她本人丢进 `data/whale/stickers/` 的图片文件并入同一池（文件名即表情名）。
- 工具返回可直接粘贴的 markdown 图片语法 `![名称](/根锚定路径)`，她把该串原样写进回复文本：客户端 `AssistantMarkdown` 的既有 `localPathMediaUrl` 规则把 `/` 开头目标重写为同源 `/api/file?path=`，宿主 `isAbsolute` 校验后由 fs 提供方读文件。win32 下盘符路径写成根锚定形式（`C:\x\y` → `/x/y`），相对进程 cwd 所在盘解析。
- 模型可见的只有 `output.render` 产出的文本：`detail` 必须把 markdown 原样嵌进去（实测首版只渲染名称时，模型拿不到路径、转头去翻文件系统找图）。结构化字段 `markdown` 供 `presentResult` 等宿主侧消费，不进模型视野。
- 人设提示词（`buildPersonaText`）加「偶尔发表情包、别每条都发」的行为约束；「偶尔」交给模型判断，不设硬冷却。
- 桌宠对话卡/回填历史把 markdown 图片剥离成 `[表情包]` 占位，避免卡片里出现原始图片语法。

## Alternatives considered

- **伪造 `assistant/message` image 块**——replay 校验拒绝：结算字段必须指认活 turn/step，`pet/look` 已踩过这颗雷（卡不变式原文在案）。
- **工具结果携带 image 块**——`tool/result` 的 image 内容会进入派生模型历史：文本模型要经 visionFallback 转描述白烧 token，且通用工具卡不渲染 image 块，图根本到不了会话视图。
- **`/dsh-whale` 前缀自建 webServer 路由 + 完整 loopback URL**——markdown 图片只要以 `/` 开头就被一律重写到 `/api/file`，插件路由经此语法不可达；完整 `http://127.0.0.1:port/...` 又要求工具侧拿到端口与鉴权面，复杂度不值。

## Consequences

收益：零新事件类型、零上下文毒化、真 turn 真消息；会话视图里表情就是她的 assistant 气泡内图片。代价：vendor 体积 +7.6MB；「偶尔」的频率由提示词约束而非硬门（模型若过度使用，用户可在额外人设里再压）；win32 根锚定路径依赖 DSH_HOME 与 Harness 进程同盘（默认成立，跨盘场景图片会 404 为破图，不崩）。
