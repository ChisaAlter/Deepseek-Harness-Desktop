# Decision: 上游 0.1.7 后内置插件契约漂移的统一修复与回归闸门

Status: implemented

中文 | [English](2026-09-25-vendored-plugins-017-contract-drift.en.md)

## Problem

0.1.7-rc.2 上游合并引入两条新契约，vendored 一方插件各自漏迁了不同部分：其一，Loader 新增兼容门，按每个插件 `package.json` 里 `@deepseek-ai/dsh-*` peerDependencies 校验运行时版本，`dsh-whale` 与 `dshbot` 仍钉精确 `0.1.5-rc.2`，可选行被 warn-and-continue 静默禁用（鲸鱼娘设置槽清空、插件路由未挂载的实发故障）；其二，`SettingsForms` 移除了 `register`/`get`，`settings/updated` 改名 `settings/document-updated` 且载荷只剩 `(ns, revision)`，`dsh-usage-panel` 的价格记录通路因此逐次警告且修复/导入路径被锁死，`dshbot` 的 catalog 注册直接抛 `settings.register is not a function` 致整行不激活。上游合并时没有覆盖 vendored 清单与设置 API 用法的回归手段，漂移只能靠用户报障暴露。

## Decision

放宽 `vendor/dsh-whale` 与 `vendor/dshbot` 的 peer 钉为 `^0.1.5-rc.2`（兼容门 `includePrerelease` 下覆盖 0.1.x 后续线），并在桌面测试内用 vendored `app-boot` 的真实 `evaluatePluginCompatibility` 对两份 manifest 建回归。`dsh-usage-panel` 的设置读写移植到新模型：读走 `describe()`（ns 为 profile 条目 id，值为 volatile 字段投影）、写仍走 `update`、事件改 `document-updated` 后以重读取代载荷取值，测试 fake 同步换形。诊断以生产等价 `dsh web` spawn（junction + `--patch` overlay 全量复刻）直接观察激活结果而非静态推断。

`dshbot` catalog 的落地形态：catalog 七个字段作为插件自身 `Config` 的 `.volatile().hidden()` 字段，`describe()` 将其投影为命名空间 `dsh-bot`（Loader insert id），读路径、revision、`document-updated` 失效全部原生工作。写路径不能走 `settings.update`——`configEditor.edit` 的一致性校验只组态 profile 本地层，overlay insert 不可见即拒写（实测 `Configuration for "dsh-bot" is overridden by a home patch or command-line overlay`）。改为：`catalog-scope` 先把 catalog 原子写入 `$DSH_HOME/dshbot-catalog.json`（tmp+rename，文件名带计数器防同毫秒碰撞），再经 `entry.update({config})` 走 Loader 的 volatile-only 原地提交（`equalExceptVolatile` + `_commitVolatile`，不重启、不触 profile patch），随后一次 `describe()` 发布失效事件。激活时 `internal/status` 钩子先 restore 文件再跑 blob-avatar 迁移；restore 遇坏文件（JSON 损坏、schema 拒绝、合法但非对象）隔离为 `dshbot-catalog.rejected-*` 留证后继续以默认目录运行，不反复 warn。客户端写从 `remote.settings.mutate` 改道插件自有 `/dshbot` RPC（`catalog/items`，沿用 `checkRevision` CAS 与 `{view}` 回执，且显式校验 `items` 为数组——schema `.default([])` 会把缺失值落成空数组清表）。

验收实机又抓出三个 0.1.7 契约漂移与一个持久化缺口，同批修复：

- 客户端 `settingsScope` 服务已删（仅余 stale 构建产物）：dshbot 客户端 inject 挂起、模块永不 apply。改 inject `configForms`——`configForms.get('dsh-bot')` 返回 `ConfigForm`（`getSnapshot`/`subscribe`/`mutate`），`configForms.describe().acceptView()` 折叠写回执，与旧面同构。宿主 `describe()` 的 `volatileForm(schema)` 只投影 volatile 祖先下字段，`dsh-bot` 行的 value/schema envelope 与 catalog 七字段一致，`decode()` 校验通过。
- `uiSession.pendingInteractions` 已改名为 `sessionStatus`（`Map<SessionId, SessionStatus>`，`status.pendingInteraction` 持交互）：dshbot 旧回退每次 `getSnapshot` 返回新 `Map`，React `useSyncExternalStore` 无限重渲染（error #185）BotPage 挂载即崩。按源快照引用记忆化投影成交互 Map，引用稳定。
- `connection.rpc.handle` 对插件调用者是断头 API：`get rpc()` 捕获 connection 插件自身 ctx，`handle` 内部经 `owner.webServer.register` 挂路由——owner 的 inject 清单没有 `webServer`，任何外部调用方必抛「cannot get property」。`/api` 拦截器又已被 gateway 独占。改为 `ctx.inject(['connection','webServer'])` 子 ctx 上 `webServer.register` 自挂 `/dshbot` 前缀路由，`connection.admit` 做 Host/Origin 与浏览器认证，本地复刻 `client-request`/`server-response` 信封编解码与 `checkRevision`。
- Loader 每次 `configEditor.edit`（任何设置写）与 patch HMR 先跑 `reconcileProfilePatches` 重套全部层：dsh-bot overlay 行不带 catalog 键，volatile 提交把七字段重置为默认——任何设置写都抹掉 live catalog。修法是 `catalog-scope` 监听 fiber 过滤的 `loader/volatile-update`（`Context.filter` 限定 owner.fiber），用 `committing` 标记区分自有提交与外部重置，外部抹除时从持久化文件异步重播种。曾试过 `internal/config` waterfall 往外部 update 候选补键——该 waterfall 是全局的，回调跑在别的 fiber 上会把 catalog 键泄漏进所有插件的配置解析，已弃用。回归测试覆盖 wipe→reseed。

## Alternatives considered

- 逐版本继续把 peer 钉改到新精确版：下个 rc 又会全灭，且不产生任何回归信号。
- dshbot catalog 走 `settings.update`/`configEditor.edit` 持久化：overlay 行被一致性校验拒写（实机复现），且即便可写，catalog 高频写也会放大成 profile patch 落盘加 Loader 调和，不可用——落地形态保留 Config volatile 字段做投影，写则绕过 ConfigEditor。
- 静态 grep 代替实机激活验证：注入名解析、可选行禁用、旧会话扫描跳过等行为只有真跑 Loader 才暴露，本次 dshbot 的 register 崩溃、`settingsScope` 挂起与 React #185 均是静态扫描漏过、实机复现抓到的。
- `internal/config` waterfall 往外部 update 候选补 catalog 键：该回调是全局派发（`this.fiber` 非 dsh-bot），会把 catalog 键注入所有插件的配置解析——泄漏面大于收益，弃用改走 `loader/volatile-update` 重播种。

## Consequences

内置行在 0.1.7-rc.2 下全部通过兼容门并激活，`dshbot` 的 catalog 读写往返已实机验证（UI 建 bot → `/dshbot` RPC → 原子落盘 → 重启 restore → reconcile 抹除后重播种存活 → UI 删除回写，鲸鱼娘设置字段与用量统计/计费写路径同批实证）；`dshbotEnabled` 默认关仍控制挂载，禁用时 overlay 剥离、catalog 文件与 bot 会话均保留。上游合并后再有 peer 钉漂移会在 `npm test` 立刻红。实机 spawn 诊断成为审计 vendored 漂移的固定手段。关联：扩展 `2026-09-23-harness-017-desktop-adaptation` 的适配面到 vendored 一方插件；鲸鱼娘槽位恢复见 `2026-09-23-whale-pet-settings-recovery`。
