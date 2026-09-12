# Feature: dshbot 内置 Bots

| Field | Value |
| --- | --- |
| **id** | `dshbot` |
| **status** | `shipped` |
| **last verified** | 2026-09-12 — 界面设置新增「机器人（Bots）」开关（`dshbotEnabled`，默认关闭，带「测试中」徽标）：关闭时 `ensureDesktopDshbot` 只剥离旧受管块并删除 overlay，不做 vendor 校验、不 fail start；切换经 `shell:save-config` 异步重启 Harness。此前 2026-09-12 — 存量 blob 头像一次性迁移：catalog 增 `avatarShapeMigration` 标记，`apply()` 内经 `projectCatalog` 把旧随机形状统一写回 `circle`（新建默认已为 circle；图片头像不动；迁移后形状选择器的显式选择仍被保留）。实测 `settings.yaml` 落盘 `avatarShapeMigration: 1` 且 新机器人2 为 `blob/circle/blue`。此前 2026-09-12 — 机器人资料三修（vendor 与 standalone `C:\Ai\dshbot` 同步）：1:1 会话 `dshbot:persona` 段补身份行 `You are {displayName}.` 与 `Your persona:` 标签（原先只注入裸 description、机器人名字不进 prompt，"你是谁" 答成通用介绍；与群成员 `buildGroupMemberSystemPrompt` 措辞对齐）；默认 blob 头像形状固定 `circle`（原按 seed 随机 8 形，颜色仍随 seed）；上传头像改为圆形取景裁剪（220px 取景台、拖动平移 + 缩放滑杆、bakeCroppedAvatar 输出 192² JPEG），替代上传即自动中心裁。桌面 dshbot 16/16 测试通过。此前 2026-09-12 — vendor 快照已与 standalone 仓 `C:\Ai\dshbot` 最新工作树同步（`45464ab` 提交 + 未提交改动：联系人/任务/定时页签、结构化任务交接、`/dshbot` 控制面、cron 例程等）。`/dshbot` 通道挂载经实测修复：上游用 `connection.rpc.handle`，其内部经 un-shadow 后的插件 ctx 重解析 `webServer`，桌面 scope 布局下抛 `cannot get property "webServer" without inject`；改为在 `ctx.inject(['connection','webServer'])` 注入子 ctx 上直接 `webServer.register` 前缀路由 + 自带 `bridgeRpc` 信封桥（沿用 client-request/server-response 载体语义 + `requestRejection` 鉴权）。真实实例实测：`/dshbot/describe` 200 + 完整名单（新机器人/新群聊等），无凭据 401、GET 404、坏信封 bad-request、未知端点 `dshbot/rejected`。另修 `presets/dshbot-room/agent.cordis.yml`：persona schema 在 `061e8eb`（v0.1.5-rc.1）把必填字段 `text` 改名 `prefix`，preset 未跟上导致 room preset 挂载报 `$.prefix missing required value`（vendor 与 standalone 源同步修复）。早前 2026-09-12 — 客户端 Bots tab 修复：`spec()` 同步探测在 fiber 重 apply（服务 re-provide）窗口内误报未声明，改为 `slots.inject` 声明生命周期登记；CDP 实测页签渲染、BotPage 拉起、历史机器人/群聊名单完好。早前 2026-09-12 — 剥离决策反转：dshbot 重新作为桌面内置随包发布并每次启动挂载。实现沿用 dsh-im 模式：恢复 `20f7f766^` 剥离前仓内快照作 `vendor/dshbot`，`ensureDesktopDshbot` 每次启动（全量 + skip 恢复）写 `profiles/web/desktop-plugins/dshbot/desktop-dshbot.patch.yml` overlay 并经 `--patch` 传入，profile `node_modules/dshbot` junction 指向 vendor 源，包名 `dshbot` 装载（insert id `dsh-bot`）；overlay 顺序 install → usage → session-search（仅全量）→ dsh-im → market → dshbot。用户层 `cordis.patch.yml` 只 strip 旧受管块（空文件归一化 `[]`），绝不写回；disable 名单对 dshbot 别名免疫（config 归一化剔除 + `shell:disable-plugin(s)` 返回 `desktop-builtin`），forensics `IN_BOX_PACKAGE_NAMES`/`PRESET_PLUGINS` 收录 dshbot 别名，孤儿 suspect 命中即 `desktopRuntimeDamage`。vendor 源或声明入口缺失 fail start（桌面运行时损坏，skip 修不了）。桌面单测含 overlay 写入/幂等、junction、旧块迁移、缺源/缺依赖 fail-closed、disable 免疫；`npm test` 1481 项全绿，skip compose 契约断言 dsh-bot 行两轮各恰好一次。此前 2026-09-10 — Hermes 式受管会话收口（历史记录保留于 git）。 |

## User paths

1. 全新桌面默认附带但不挂载 dshbot：在 设置 → 界面设置 打开「机器人（Bots）」（默认关闭、带「测试中」徽标）后自动重启 Harness，侧栏出现 Bots tab，无需任何安装步骤。
2. 旧桌面升级：受管 patch 块与指向旧预置副本的链接被迁移清理，由内置 overlay 接管；机器人设置、记忆、房间 preset、会话全部保留。
3. dshbot 作为桌面内置不可经插件禁用名单/卸载（Recovery Board 不提供该行的禁用入口）；是否挂载只由界面设置「机器人（Bots）」开关控制。源码缺损归为内置组件损坏，走重装 / `setup:harness`。
4. 独立插件仓 `ChisaAlter/dshbot` 继续存在，但桌面运行时不依赖它；`dshbot` 已入 `DROPPED`/`DROPPED_BASENAMES`（与 dsh-im 同例）——市场目录隐藏、安装与 in-chat `install_dsh_plugin` 均拒绝，`stripDroppedPlugins` 每次启动剥离 profile manifest 中的同名依赖/bundle 行（仅清单行，机器人设置/记忆/会话等用户数据不动）。

## Invariants

- `vendor/dshbot` 是随包发布的实现源（已与 standalone 仓 `C:\Ai\dshbot` 工作树同步，`45464ab` + 未提交改动），`build.extraResources` 含 `dshbot/**`；after-pack 校验包内完整性。
- `/dshbot` 控制面必须在 `ctx.inject(['connection','webServer'])` 的注入子 ctx 上经 `webServer.register` 挂前缀路由 + 本地 `bridgeRpc` 信封桥——不得用 `connection.rpc.handle`：它把注册归属 un-shadow 的调用方 ctx，经其重解析 `webServer` 时插件 inject 清单未声明该服务即抛（Cordis 属性代理的 scope 可见性规则）。
- 挂载只经桌面自有 overlay `desktop-plugins/dshbot/desktop-dshbot.patch.yml`，仅 `dshbotEnabled`（默认 false）为 true 时随**每次**启动（全量 + skip）经 `--patch` 传入；为 false 时 ensure 删除 overlay 且不校验 vendor、不阻断启动。绝不写用户层 `cordis.patch.yml`，受管块残留每次启动 strip（CLI insert 不按 id 去重，残块+overlay=双挂载）。
- 包名解析走 `profiles/web/node_modules/dshbot` junction → vendor 源；junction 指向旧预置副本或非 vendor 目标时重建，真实用户安装数据（设置、记忆、房间 preset、会话、manifest 依赖与 bundles）一律不删。
- disable 名单对 `dshbot`/`dsh-bot` 别名无效；forensics 把缺席 profile 清单的 dshbot suspect 标 `inBox`/`desktopRuntimeDamage`。
- ensure 失败（源缺失、声明入口/运行时依赖不全）在 `dshbotEnabled` 为 true 时阻断启动；skip 恢复不能绕过。
- 普通会话行为不变：Bots tab、群聊、managed composer 只由 dshbot 注册的槽位驱动，宿主通用契约（`session/presentation`、`conversation.session.body`、`conversation.input.managed`）保持不识别包名。
- 客户端 Bots 入口注册必须走 `slots.inject` 声明生命周期（`sidebar.nav.tab` 座下同时登记 `sidebar.page`；`sidebar.footer.action` 回调内核对 region 座 spec 后让位），不得用 apply 时一次性 `spec()` 探测——服务在 boot 中途 re-provide 会让 fiber 重跑 apply，彼时兄弟槽位声明正处于坍塌窗口，同步探测为 false 即永久静默缺入口（`src/main/dshbot-client.test.js` 覆盖 apply 先于声明、仅 footer、region 优先、声明先于 apply 四种时序）。

## Allowed touch

- `vendor/dshbot/**`、`src/main/dshbot-desktop.js` 及测试、`src/main/legacy-dshbot-preset.js` 及测试
- `index.js`、`harness-controller.js` 的 ensure/overlay 接线；`config.js`、`ipc.js`、`plugin-forensics.js` 的内置别名表
- `package.json` extraResources、`scripts/after-pack.js`、`scripts/check-skip-compose-contract.js`、`release-ui-walk.js` 及对应测试；`src/shared/post-merge-ui.test.js`
- 本卡、handbook、Feature 索引、短规则、发版说明与 QA 记录
- 宿主通用 Session presentation、managed composer、pending interaction 与 `conversation.session.body` 扩展；实现不得识别 dshbot 包名，普通会话行为必须保持不变
- `ui-sidebar` 展开态区域切换的通用等分几何及聚焦样式测试；折叠 rail 必须保持既有纵向圆形导航

## Gates

- 含 dshbot 的桌面构建与启动；新 profile 直接出现 Bots tab（release-ui-walk `plugin.dshbot.tab`）。
- overlay 幂等、junction 重建、旧受管块迁移、pnpm/目录用户安装保留均有测试。
- 缺源、缺声明入口、缺运行时依赖均 fail start；skip 恢复轮仍挂载 dshbot。
- `vendor/dshbot/package.json` 把运行时实际 import（`@deepseek-ai/dsh-settings`/`dsh-tools`/`schemastery`/`cron-parser` 等）声明为 `dependencies`，`vendor/dshbot/node_modules` 随仓跟踪（`.gitignore` 例外，与 dsh-im/usage-panel 同例）；junction 按 realpath 解析，peer 依赖不落在 vendor 树内即 `ERR_MODULE_NOT_FOUND`。after-pack 走 `restoreVendoredPluginNodeModules` + `installPluginRuntimeDeps` + `assertVendoredPluginRuntimeDeps`。
- 快照内 `ctx.subagents.registerContinuableSetup` 调用已移除：该 API 在 alpha.4 合并（`2baeb48`）中随 activation-setup-registry 下线，且其贡献只对 continuable 子代理生效，而 dshbot 成员发言走一次性 `subagents.start('spawn', …)`，此路从未经过 registry——属死代码；成员人设实际经 `persona` 请求字段（`deployment:persona-prefix` 节）投递。`memberPersona` AsyncLocalStorage 一并移除。
- disable 名单免疫、forensics in-box 归因、通用插件归因与完整桌面回归通过。

## Sources

- 实现：`src/main/dshbot-desktop.js`、`vendor/dshbot`（同步自 standalone 仓 `C:\Ai\dshbot` 工作树，`45464ab` + 未提交改动；`lib/control-plane.js` 的 `/dshbot` 挂载为桌面 scope 布局下的本地适配）。
- 迁移清理：`src/main/legacy-dshbot-preset.js`。
- 独立仓 `ChisaAlter/dshbot` 仍为历史参照，不是桌面运行时依赖；旧决策与历史验收保留于 `docs/superpowers/`、`docs/qa/`。
