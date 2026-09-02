# AGENTS.md — dsh-usage-panel

DeepSeek Harness 的 Token 用量统计插件（设置页「消耗统计」）。Host 半只读重扫会话日志 + RPC，Client 半渲染 KPI / 热力图 / 堆叠柱图 / 环形图。本文档是给 AI 与协作者的项目说明书：开发策略 + 踩坑记录。**新坑踩到后必须即时回填本文档。**

## 1. 仓库与迭代规范

- **main 冻结**：每次发布后 main 即"已打包状态"，禁止直接在 main 上开发。新迭代一律：
  ```sh
  cd dsh-usage-panel
  git worktree add -b vX.Y.0 ../dsh-usage-panel-vX.Y main
  ```
  在 worktree 分支上开发 → 合并回 main → `npm version` → 发布 → 打 tag → `git worktree remove` 清理。
- 发布过的版本由 tag 保留（当前 `v0.1.0`）；紧急热修走 `vX.Y.1` 短分支，同样不碰 main 直接改。

## 2. 常用命令（v0.2.0 TS 化后）

```sh
npm install          # devDeps: typescript / esbuild / @types/react / @deepseek-ai/* (rc.6, 带 .d.ts)
npm run build        # esbuild: src/host → lib/index.js (ESM) + src/client → ModuleLoader CJS + 声明
npm run typecheck    # tsc --noEmit (strict, noUncheckedIndexedAccess)
npm test             # node --test（tests/ 纯函数单测，fixture 锁口径）
npm run check-pack   # 打包门禁（见 §3）
npm pack --dry-run   # 发布前人工确认清单
```

## 3. npm 打包与发布硬性规则

1. **禁止把 README 的静态资产打进 tarball**（`assets/` 下任何 gif/png 等）。`package.json` 的 `files` 白名单只含 `lib/`、`cordis.patch.yml`、`README.md`、`README.zh-CN.md`。
2. `assets/` 只存 git（GitHub 页面渲染用）；README 内图片一律引用 GitHub raw 绝对 URL（npm 页面不依赖 tarball 资产也能渲染）。
3. `scripts/check-pack.mjs` 门禁挂在 `prepublishOnly` 与 CI publish：解析 `npm pack --dry-run --json`，出现 `assets/` 前缀或图片扩展名即失败。**任何人不得绕过。**
4. 发布顺序：build → typecheck → test → check-pack → `npm publish`（OIDC Trusted Publishing，无 token）→ tag 推送。
5. 历史教训：v0.1.0 tarball 实测含 5 张图约 766KB（demo.gif 578KB），属于打包污染，v0.2.0 起修复。

## 4. 架构与代码规范

- 分层：`src/shared/`（双端纯函数，无 IO）→ `src/host/`（Cordis 插件，node ESM）→ `src/client/`（浏览器，React TSX）。
- **wire 契约单一来源**：host↔client 的载荷/错误码只定义在 `src/shared/contract.ts`，双端 import，禁止两端各自手写形状。
- 组件拆分：单文件 ≤ ~300 行（竞品 token-usage 的 1453 行 god component 是反面教材）。
- host 错误只返回**机器可读错误码**，client 按码查词典渲染——禁止 host 返回中文文案再由 client 正则匹配翻译（dashboard `i18n.tsx:26-45` 的脆做法）。
- 纯函数先行：聚合/单位换算/四分位/导出防护等逻辑必须先抽成纯函数 + 单测，再进 UI。
- 客户端 bundle 形态是硬契约：`window.__ModuleLoader__.load({ id: 'dsh-usage-panel', factory(require) })`，`exports.apply` + `exports.inject`。改这个形状等于破坏宿主加载。构建 = esbuild + `scripts/wrap-client.mjs`（wrapper 里 `var React = require('react')` 供经典 JSX transform 使用）。
- **数据路径二选一（同一 reducer）**：投影模式（`sessionProjections` + `sessionProjectionCache`，增量落盘）与全量重扫模式（`sessionQuery` 重放）共用 `src/host/projection.ts` 的 `applyEvent`。加记账逻辑只改 reducer + 单测，两路同时生效。模式切换在 `src/host/index.ts` 的 `mode` 判定，fail-soft（注册失败 → scan → none）。
- 测试：`tests/*.test.ts` 用 esbuild 编译后跑 Node 内置 test runner；fixture 锁口径（UTC 日桶、fork 去重、重试替换、压缩归因）。

## 5. 正确性红线（本项目的壁垒，任何重构不得破坏）

1. **fork 去重**：`header.seedLength` 之后的 `assistant/message` 才计数（竞品 dashboard 无此逻辑会重复计费）。
2. **双源模型归因**：`request/context.model` 打底，`request/header.config.model` 覆盖。
3. **四桶记账**：input/output/cacheRead/cacheWrite 分开；v0.2.0 起升级为落盘投影后：流式 `assistant/chunk` 的 provisional usage 必须被最终 `assistant/message` 覆盖；`llm/retry` 独立计数；`compaction/summary` 独立归因；reasoning 已含于 output，不重复加。
4. **日期口径 UTC**：dayKey 用 UTC 桶（v0.1.0 用本地时区，跨时区漂移），README 与 UI 必须显式声明口径。
5. **只读承诺**：永不写回原始会话日志；投影机制的落盘是框架对派生缓存的落盘，不触碰原始日志。**唯一例外(用户授权的自动修复)**：仅当框架报告某会话日志损坏(如 seq gap)时，用户从统计页显式点击「自动修复」→ 只重写该损坏工件(解码全部行→0 基连续重编号→重打包→原子替换)，先落 `.bak-<ts>` 备份；解码/序列化任一失败即中止不写；健康日志永不触碰。
6. **安全边界**：RPC `{ authority: 'loopback' }`，不开放裸 HTTP 端口。
7. **入口稳定**：`settings.section` id `usage-stats`、order 25、RPC 通道 `/usage-stats`——这些 id 被宿主配置引用，改名即破坏安装。

## 6. 踩坑记录（本项目真实踩过/分析确认的坑）

### 6.1 v0.1.0 数据正确性缺陷（v0.2.0 修复）

| 坑 | 现象 | 修复 |
|---|---|---|
| 静默吞错 | `catch (err) { continue }` 跳过坏会话，汇总永远像完整账单 | 覆盖度诊断：payload.coverage 计数 + 日志披露 + UI 声明"部分数据" |
| 本地时区 dayKey | "今天"边界随设备时区漂移 | UTC 桶 + 单测锁口径 |
| 重试重复累计 | 同一 step 多条 `assistant/message`（重试）被重复计入 | 落盘投影：authoritative 覆盖 + retry 独立 |
| 压缩混入普通用量 | compaction 产生的 token 计入常规输出 | 投影中 compaction 独立归因 |
| 缓存数据白采集 | cacheRead/cacheWrite 已采集但只并进"输入"展示 | 四桶独立露出 + 缓存命中率 KPI |

### 6.2 代码级边界坑（TS 重构时保留原注释，不得删）

- **React hook 顺序不变量**：KPI 的 `useCountUp` 必须在条件渲染分支之前无条件调用，否则 hook 顺序错乱。
- **环形图不能用 `transform` 属性定位段**：`dsw-ust-donut-spin` 关键帧拥有 rotation，CSS transform 会被覆盖；段定位只能靠 `strokeDashoffset`。
- **SVG circle 的 bbox 是整图**：donut tooltip 不能用 rect 锚定（所有段都会钉到同一位置），必须用 `e.clientX/Y` 跟随指针。
- **日期解析**：`new Date('YYYY-MM-DD')` 会按 UTC 解析导致非 UTC 时区日偏移；必须手动 `new Date(y, m-1, d)` 构造本地午夜。
- **SWR 竞态**：inflight 去重 + `disposed` 检查 + `ctx.effect` 清理定时器，三者缺一就会在卸载后回写缓存或泄漏定时器。
- **样式注入生命周期**：`<style data-plugin-css>` 挂 effect 清理；重复加载时先查现有 tag，否则 HMR/双挂载产生重复样式。

### 6.3 竞品红线（明确不吸收，见 iteration-strategy.md §6）

200 会话静默截断（token-stats）；裸 HTTP 无 authority（token-stats）；不看页面可见性的 10s 轮询（token-stats）；无 fork/seed 去重（dashboard）；硬编码虚构价格表（dashboard）；宿主 DOM 探测做悬浮窗（dashboard）；host 文案正则做 i18n（dashboard）；缓存字段白名单人工维护（dashboard）；1453 行 god component（token-usage）；install.js 字符串改用户 patch（token-stats）；tsdown 硬依赖 monorepo checkout（token-usage）。

### 6.4 v0.2.0 开发期踩坑（TS 化 + 投影期间真实踩过）

- **DSH locale ID 是 `'zh'` / `'en'`，不是 `'zh-CN'/'en-US'`**（真实事故：词典注册到错误 ID 下，页面全部显示原始键 `nav.label` 等）。注册用 `locale.register(NS, { zh: dict, en: dict })`；内部 Locale 类型 `'zh-CN'/'en-US'` 只是我们的归一化表示。
- **locale 运行时的 `translate` 找不到键时"fail loud"返回键本身**：`translated(key) || 本地词典` 这类兜底会被"键本身"这个真值绕过，必须显式 `text === key` 判失败再走本地词典；且 `translated` 调用不要传 params（插值统一由我们做）。
- **`i18n.locale` 必须是 getter**：字段快照在语言切换后保持旧值，格式化函数会一直用初始语言。
- **`ctx.on('locale/change', …)` 直接挂在 ctx 上**（cordis Context 就是 EventEmitter，没有 `ctx.events`）；更稳的是挂 `locale.subscribe(update)`（切换与迟到词典注册都会 bump revision）。
- **投影注册表的冷折叠是单趟**：`buildCell` = `init()` + 逐事件 `apply()`，无回看。种子边界因此用"武装"语义：看到最后一个 `session/end-seed` 之前**一律不计数**；`foldEvents`（自控路径）必须先预扫最后一个标记再折叠；`session/end-seed` 分支必须"last marker wins"（`seq <= seedEnd` 时保持原值），否则预置的 seedEnd 会被更早的标记覆盖。
- **step/start 仅在"计数历史"内武装**：种子里的 step/start 若入 `stepStart`，fork 会话（turn/step 重置）的活 step 会被种子时刻错误归类——`step/start` 分支先过 `isCounted`。`assistant/message` 覆盖时**继承已有 step 的峰谷快照**（消息晚于下一步 start 到达时不得重采样）。
- **storageDomain 域打开是 async，`apply` 不能 await**：BillingStore 先内存态、域打开后 `attachMedium` 升级（升级不清已有缓存，内存期保存不丢）；域/表名必须匹配 `UNIT_NAME_RE`（`/^[a-z][a-z0-9_]*$/`，无连字符）。
- **npm rc.6 类型面缺 `stateOf`/`listModels`**：桌面宿主有；沿用 `register()` 的既有先例——局部结构化断言，不依赖宿主类型包。
- **UI 偏好双面同步**：设置弹层与输入框条共用 bundle 内发布订阅（`billing-bus`），host JSON 是唯一持久源——条自行拉取一次，之后都由总线推送，改价零刷新即时生效。
- **弹层加载禁止"无 catch 的 Promise.all"**（真实事故）：计费弹层一度用 `Promise.all([billing.get, billing.models])` 且无 catch/finally，`billing.get` 一失败 `setLoading(false)` 永不执行 → 弹层永远"正在统计会话日志…"。规则：RPC 组合必须 allSettled / 独立 catch + 错误态/重试；模型目录（可能含死端点的 `listModels`）必须在 host 侧用 `withTimeout` 兜底、client 侧懒加载降级为空 + 手动添加。
- **大语料扫描必须让步**：`coldSnapshot` 版本不匹配时会从 seq 0 全量重折（同步循环）；扫描循环每批让步 `setImmediate` + 进度日志（`scanPacer`），投影/回退两条路径都有。
- **RPC 调用必须显式传 payload 对象**（真实事故）：传输层 `JSON.stringify` 会丢掉值为 `undefined` 的键，而宿主 envelope schema `clientRequestSchema` 的 `payload` 键必填 → 不带 payload 的 `rpc.call(channel, endpoint)` 一律报 `invalid client-request message`。规则：所有 `call*` 封装显式传 `{}`，禁止省略第三参。
- **竞品红线（计费口径）**：不猜价——未定价显示"设置价格"/"—"；非 DeepSeek 模型须自定义价；费用一律"估算,非账单"；高峰期窗口/官方价目是数据文件(asOf+来源+单测锁值)，绝无写死的假表。
- **`mergeSessionValue` 是纯函数**：返回值必须重新赋值（`a = mergeSessionValue(a, …)`），漏掉会静默丢数据——scan.ts 与 index.ts 都踩过。
- **zod v4 的 `z.record` 签名变了**：`z.record(valueSchema)` 在 v4 里被当作 key schema；必须 `z.record(z.string(), valueSchema)`。
- **`SessionId` 是品牌类型**：`readSession/readTitle/coldSnapshot` 拒绝裸 `string`；用 `header.id` 本体，别 `String()`。
- **`@deepseek-ai/cordis` 版本是 `^4.0.1`**（cordis v4 fork），不是 rc.6 号段；所有 dsh 包的 peer 都要求它。
- **投影状态里 `totals` 无 `total` 字段**（四桶即状态，total 是视图层派生）；断言/测试别直接读 `state.totals.total`。
- **TS 经典 JSX transform 需要 `import * as React`**（否则 TS2686 UMD global）；esbuild 产物引用 wrapper 的 `var React`，两者同一模块实例。
- **`node --test` 传目录不识别**：必须传 glob `'tests-dist/**/*.test.js'`（spawnSync 里字符串 glob 由 Node 展开）。
- **`createElement(ClassComp, props, children)` 类型报错时**：把 `children` 声明为可选即可（BoundaryProps）。
- **NODE_AUTH_TOKEN 与 OIDC provenance 互斥**：publish.yml 不设 token，npm 走 OIDC。
- **OIDC Trusted Publishing 必须在 npmjs.com 手动链接 trusted publisher，否则 `npm publish --provenance` 的 PUT 返 404**（真实事故：v0.2.0 tag 推送触发 publish.yml，provenance 签名成功但随后的 `PUT https://registry.npmjs.org/dsh-usage-panel` 报 `404 Not Found — 'is not in this registry'`）。前置条件（manual, once，写在 publish.yml 顶部注释里）：npmjs.com → 包页 → Settings/Publish access → 添加 Trusted Publisher（GitHub Actions，repo=`AlfredChaos/dsh-usage-panel`，workflow=`publish.yml`，environment 留空）。v0.1.0 当时是用 access token 手动发的，OIDC 链接从未真正配过 —— 所以 publish.yml 一直是「绿本地、红 CI」的隐式失效状态，直到 v0.2.0 首次走它才暴露。临时绕过：本地 `npm publish --access public`（**不带 `--provenance`**，provenance 溯源只能在 GitHub Actions 环境生成），但这是偏离 OIDC 架构的一次性手段，且 tarball 不带 provenance。根因修复只能去 npmjs.com 配 trusted publisher。

## 7. 文档同步义务

- 改功能必同步 README.md + README.zh-CN.md（双语等价、口径声明、安装方式不变）。
- 新增依赖/构建步骤 → 更新本文档 §2；新增踩坑 → 更新 §6；发布 → 检查 §3 门禁并核对 iteration-strategy.md 的完成定义。
