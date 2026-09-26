# Decision: 鲸鱼娘人格身份绑定预设而非会话快照

Status: implemented

中文 | [English](2026-09-26-whale-persona-identity-root-fix.en.md)

## Problem

「设置没生成在她的灵魂里」多次复发，根因不止一处：

- 人格 section 以 `sessionId === settings.sessionId` 门控：常驻会话 ID 一旦轮换或丢失（9/23 一天内就产生了 10 个孤儿 `session-whale-*`），用户打开旧会话或新会话时她的人格静默归零；首轮组装与 `sessionId` 落盘之间的时序也能产生空人格首轮。
- `scope.get()` 在组装回调里直读 `settings.json`——文件损坏时 `JSON.parse` 抛错会打穿每一轮提示词组装，不只人格，整个 turn 都失败。
- `DSH_HOME` 缺失时 `createWhaleScope('')` 把 `settings.json` 落到 Harness 进程 cwd 下的相对路径：读写静默分裂，人格永远为空且不报错。
- 桌宠「聊聊」的 legacy 直连兜底用硬编码「你是鲸鱼娘」，不含用户配置的名字/称呼/额外人设——助理关闭或传输失败时她天然失忆。
- 性格镜像只重试 transport 失败；被应答的拒绝（如快照冲突）记 dbg 后永不重发，一次拒绝丢到下次启动。
- 人格文本把配置名放在 8KB 提示词开头一行，而历史里她多次自称「鲸鱼娘」、AGENTS.md 又叫「鲸鱼娘的家」——模型顺着历史自称回答，配置名形同虚设。

## Decision

- 人格门控改为「鲸鱼娘会话身份」：`session.header.agentPreset === 'whale-girl'`（持久 header 元数据，创建即存在、跨重启稳定）为主信号；存量的 `sessionId` 命中与 whale 家目录 `cwd` 命中作为旧会话的兼容匹配。非鲸鱼会话仍返回空。
- `scope.get()` 读路径全部经 `readSettings` 容错；`read()` 对损坏 JSON/YAML 回退默认值，下一次写自愈文件。
- `createWhaleScope('')` 返回惰性 scope：读给默认值，写抛错——缺失 `DSH_HOME` 不再产生相对路径分裂写。
- 桌宠 fallback 经 `getWhaleSettings` 读同一份 `data/whale/settings.json`（只读）：离线回复仍带配置名、称呼与额外人设；性格以桌宠自身选择器为准（单一控件），catalog 值仅在其无效时兜底。
- 性格镜像对被应答的拒绝改为有界重试（最多 3 次、30s 间隔），新值入队重置计数；transport 失败仍无限排队到可达。
- 人格文本末尾追加身份锚点：复读配置名与称呼并声明旧自称作废，再加一条问答示例（`问「你叫什么」→ 答「配置名」`）——弱模型吃示例胜过吃规则。

## Alternatives considered

- **保留 sessionId 门控、加强文案** — rejected：sessionId 轮换/丢失/首轮时序仍会让人格归零，文案救不了结构性缺席。
- **会话 ID 丢失时清空或重建旧会话** — rejected：违反既有契约（不动历史会话）；预设门控让旧会话自然恢复人格，无需删除。
- **镜像拒绝无限重试** — rejected：真正的拒绝（非法值）不会因重试收敛；三次上限在「快照冲突这类可收敛拒绝」与「永久失败」之间取折中。
- **桌宠走 loopback RPC 补读设置** — rejected：fallback 的存在前提是 harness 不可达，RPC 无意义；设置文件是本机同盘数据，直读是唯一可行路径。
- **改写家目录 AGENTS.md/MEMORY.md 的「鲸鱼娘」标题行** — rejected：两文件是用户可编辑的种子文件，标题是角色描述而非自称断言；为压回声而动用户文件违背契约，收益边际。
- **每轮向 user message 注入 system-reminder 改名提醒** — rejected：需要给会话面加新的贡献缝（vendored harness 侧改动），远超本 bug 修复半径；锚点+示例已覆盖同等位置收益。

## Verification

- `src/main/dsh-whale-orchestration.test.js`：常驻会话人格注入、异 id whale-girl 会话仍注入（预设门控）、外来会话隔离、锚点+示例断言、`complete:true` 禁令回归、损坏 settings.json 容错、空 home 惰性 scope——20/20 绿（含真实组合用例：真 `Context`+真 `SystemPrompt`+真 `apply()` 组装）。
- `src/main/pet-chat.test.js`：fallback 兜底人格携带配置名/称呼/额外人设；桌宠性格选择器优先于 catalog——43/43 绿。
- `src/main/desktop-live2d.test.js`：镜像被拒有界重试 ≤3 次、最新值覆盖、transport 失败照旧无限排队——38/38 绿。
- 鲸鱼 feature 卡门禁（8 个文件）：197/197 绿。`npm run check:governance` 6/6、`npm run doc-sync` 8/8。
- **活体验证（2026-09-26，kimi-k3，经 CDP 真实回合）**：会话日志 `system/message` 确认配置名/称呼/锚点/示例全部注入；裸问「你叫什么」kimi-k3 推理中主动弃用系统文本、采信历史自称（答「鲸鱼娘」）；用户口吻纠正一次后再问即答「吃白饭的」并称「爸爸」。结论：管线已完整；弱模型需要一轮用户侧纠正覆盖历史回声，或换更强模型立即服从。

## Consequences

- 旧鲸鱼会话、重建会话、首轮提示词均获得人格；配置改动照旧下一轮生效。
- `settings.json` 损坏不再让她的会话整体瘫痪——人格退回默认值，下次写入自愈。
- `DSH_HOME` 缺失时写路径显式报错（客户端显示保存失败），不再静默写进错误位置。
- 桌宠离线兜底与共享会话共享同一份灵魂描述；代价是桌宠层增加了一个只读文件依赖。
- 镜像一次拒绝最多延迟收敛 90 秒；永久拒绝仍在三次后丢弃并随下次启动重断言。
- 身份锚点增加两行提示词长度，换取历史自称竞争下的名字服从率。
- 关联修复见 [助理配置名必须进入实际提示词](2026-09-24-whale-configured-name-in-prompt.md)（complete 空段吞掉整个提示词的结构性前因）。
