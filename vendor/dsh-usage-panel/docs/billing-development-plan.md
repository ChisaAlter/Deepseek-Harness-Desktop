# v0.3.0 计费功能开发流程(讨论稿)

> 范围:会话累计费用 / 峰谷提示(输入框下方实时条)、价格表、价格解析、费用计算、用户价格持久化。
> 前置:与用户讨论后的已定方案;本文档为开发流程(阶段、产出、验证、门禁),非迭代策略。
> 结论性事实来源:DeepSeek 官方定价页(2026-08-17 生效峰谷计价)、vendored harness 源码。

## 0. 需求映射(用户原话 → 方案)

| 需求 | 方案 |
|---|---|
| 输入框下方:当前高峰/空闲 + 距下次切换倒计时 | 客户端纯函数(北京 UTC+8,周一至五 09:00–12:00、14:00–18:00 高峰),注册到 `conversation.composer.dock` 槽 |
| 悬浮提示:检查是 deepseek 官方模型,显示价目表 | 条上 hover 显示**当前模型一行**价目(命中/未命中/输出 × 高峰/空闲 + 来源徽标);非 DeepSeek 显示"该模型未定价" |
| 当前会话费用(未设定价格的模型提示"设置价格") | host RPC 读活会话 `usagePanel` 投影(峰谷桶)→ client 乘价;无价模型行显示"设置价格",**点击跳转到用量统计设置面板**(见 §7-SPIKE) |
| 用量统计页导出左边"设置"按钮 | **模态弹层**(官方 ui-primitives `Modal`):模型多选 + 价格编辑 + 峰谷价开关 + 界面开关 |
| 模型同步 dsh 提供商 + 自定义提供商;多选框 | `llm.listProviders()`(含自定义路由)+ 用量日志见过的模型,合并去重出勾选列表 |
| 峰谷价开关,开启后显示峰谷价设置 | 全局开关;关 = 单一价(两时段同价),开 = 每模型高峰/空闲两列 |
| 界面开关:关闭/显示输入框下方条 | 持久化布尔偏好(仿官方 StatsLine 设置行模式),条上注入同名 hook |

## 1. 已核实技术事实(不可推翻,改动需重新验证)

1. **槽位**:`conversation.composer.dock` 是官方公开槽(ui-conversation `contract/slots.ts` 声明,官方 StatsLine 挂载于此,"sticks with the composer")。第三方插件经 `ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register(...))` 注册,无需 DOM 探测(满足 P2 悬浮窗 no-go 的官方前提)。
2. **实时数据**:`SessionProjectionRegistry.stateOf(session, key)` 同步返回某会话一单元的**活状态**(注释:live,禁止 mutate);`registry.snapshot(session)` 是全部 client-visible 单元一致性切面。注册表对活会话的冷折是惰性的(in-memory log),读即得。
3. **官方 tokenUsage 无峰谷分相**:vendored `TokenUsageProjection` 仅四字段(`uncachedInputTokens/cacheReadTokens/cacheWriteTokens/outputTokens`),当前 harness 快照未做计费化。**当前会话费用只能来自我们自己的 `usagePanel` 投影的峰谷桶**(因此投影必须加峰谷桶,见 §3)。
4. **订单 API**:`llm.listProviders()` 已在本插件使用(providerNames);设置面板模型列表以其为源 + 日志中见过的模型合并。
5. **持久化**:host 端 `ctx.storageDomain`(KvTable 域,JSON 后端落 workspace.json 旁)可用(投影缓存即用它);域用 `defineDomain` 声明(名称/表名须匹配 `UNIT_NAME_RE`,版本整数,global 不得为 null)。
6. **插件装载**:桌面经 junction 将 `vendor/dsh-usage-panel` 链入 profile `node_modules/dsh-usage-panel`,`npm run build` 后重启 dsh web 生效;宿主进程重启会中断当前会话,需用户操作(见 §8)。

## 2. 已定口径(用户拍板)

- **峰谷判定**:step 按 **step/start 时刻**整步归类(跨时段不拆账;找不到 step/start 的日志回退到事件自身时间)。
- **持久化**:插件自有 JSON(host 写入,storageDomain 域)。
- **未知模型**:严格显示"未定价",绝不猜测;非 DeepSeek 供应商无费用数字。
- **价格编辑**:官方行只读展示(来源徽标:官方/自定义/默认列);用户覆盖式编辑(命中/未命中/输出 = 高峰列;空闲列默认=高峰一半,可显式覆盖;"峰谷计价关闭"= 两时段同价)。
- **费用展示**:¥ 两位小数;整数分;估算≠账单声明;价格以 CNY/百万 tokens 为单位。
- **费用计算**:整数微元 → 单次舍入到分;缓存命中走命中价,缓存未命中输入+写入走未命中价,输出走输出价;compaction 不入费用桶(仍在 token 总量);retry 不计费。

## 3. 架构与文件改动

```
src/shared/pricing.ts      [新] 官方价目表数据文件(asOf + 官方来源链接 + 单测锁值)
                               + 峰谷窗口常量 + isPeakBillingTime/peakValleyState/...
                               + resolveModelPrice(provider/model/custom) + 来源判定
                               + parseSessionCostPrices(zod 解析/清洗) + priceText
src/shared/cost.ts         [新] computeBilledCost(微元整数) + billedBuckets + costCentsFor
src/shared/billing-summary.ts[新] 条上展示所需纯函数:时段格式、倒计时格式、费用格式
src/host/projection.ts     [改] state 增 costTotals/costByModel/costByDay/costByProvider
                               (每项 {peak: 四桶, offPeak: 四桶});step 记 peak 判定;
                               step/start 事件处理(state.stepStart);compaction 不入费
src/host/projection-unit.ts[改] PROJECTION_STATE_VERSION 1→2(旧投影缓存自动失效重折)
src/host/pricing-store.ts  [新] storageDomain 域(global 槽,zod 校验,原子写);
                               服务缺失 fail-soft 内存态 + 日志
src/host/index.ts          [改] RPC 增 session-cost(活会话 read via stateOf/冷会话 coldSnapshot)、
                               prices.get / prices.set;overview 载荷带峰谷桶
src/host/aggregate.ts      [改] merge 峰谷桶(镜像四桶逻辑);SessionSummary 带 models 费用行
src/shared/contract.ts     [改] PhaseBuckets 类型、SessionSummary.cost/models、Overview 扩展、
                               RPC 端点常量、OVERVIEW_VERSION 4
src/client/  CostStrip.tsx(composer.dock 注册)  设置面板 ModelPicker + PriceEditor + 开关行
            KpiCards 费用合计 / SessionsCard 费用列 / export 费用列 / api.ts / hooks / locales
tests/       pricing.test.ts / billing.test.ts / cost.test.ts / projection-cost.test.ts /
             store.test.ts / contract-version.test.ts
```

## 4. 阶段流程(每个阶段:产出 → 验证 → 才可进入下一阶段)

### P1 纯函数地基(shared + tests)
1. 写 `src/shared/pricing.ts`(官方价目 flash/pro/vision-exp,峰值列=官方公布值、空闲列=公布值;asOf `2026-08-17`;来源链接)与 `billing.ts`(峰谷窗口)。
2. 写 `tests/pricing.test.ts`(官方值逐字段锁死;大小写不敏感;composite 键按首个 `/` 拆分;用户价优先于官方列,provider 作用域优先于裸模型;未知模型 null;flat 语义;`resolveModelPrice` 来源判定 official/custom/default)、`tests/billing.test.ts`(峰谷边界网格:9:00/12:00/14:00/18:00 边界、周末全天空闲、午休空闲、+8h 偏移跨时区、nextSwitch 严格大于 now、周末跳到周一 9:00)、`tests/cost.test.ts`(微元整数精确舍入:1e6 miss × ¥3 = ¥3.00 = 300 分;半精度;0 桶;缓存读写与输出分桶)。
3. **门禁**:`npm test` 全绿 → 才动 host。

### P2 host 投影峰谷桶
1. 改 `projection.ts`(字段+reducer+`step/start`+samplePeak 以 stepStart 优先);`projection-unit.ts` stateVersion 2。
2. 写 `tests/projection-cost.test.ts`(step 跨峰谷按 start 归类;provisional 被 authoritative 覆盖后峰谷桶仍以最终桶+首次判定为准;compaction 不入费但入 totals;retry 独立;种子边界后计数;`foldEvents` 两遍预扫与单遍"武装"语义并存)。
3. **门禁**:`npm test` 全绿;旧 stateVersion 行被拒(手动/单测验证 registry 交互不在此阶段,交付时以构建+宿主冷启动验证)。

### P3 契约与聚合
1. `contract.ts` 新增类型 + `aggregate.ts` 合并峰谷桶 + `index.ts` overview 载荷扩展。
2. 更新 `tests/aggregate.test.ts`、`tests/usage.test.ts` 相应断言。
3. **门禁**:`npm test + npm run typecheck` 全绿。

### P4 价格持久化(host JSON)
1. `pricing-store.ts`:`defineDomain({name:'dsh_usage_panel_billing', version:1, global:{schema, initial:{}}})`;zod 校验用户价(有限非负数、≤ 上限、idle/flat 可选);load/save 全走域 API;fail-soft。
2. `index.ts` RPC `prices.get/set`;`set` 先 parse 后写,错误返 `bad-request` + issues;写后返最新值。
3. `tests/store.test.ts`(schema 往返;非法→拒绝;空→{};ASCII 键;`provider/model` 键含 `/` 不歧义)。
4. **门禁**:`npm test + typecheck` 全绿。

### P5 输入框下方实时条
1. 读 `ui-conversation/contract/slots.ts` 锁定 `conversation.composer.dock` 注册形状(props 四 share:`PropsRuntime<'conversation'>`+renderSlots+store+inject hooks;依赖 `dsh-client-ui-slots` 类型已随 vendor node_modules 就位)。
2. `CostStrip.tsx`:时段徽标(高峰/空闲)+ 倒计时(1s tick,页面不可见时停,`visibilitychange` 门控)+ 当前会话费用(轮询 RPC `session-cost`,~2s,仅条可见时;暂停于设置关闭时);hover 出**当前模型行**价目(官方模型)或"未定价/设置价格"提示;点击"设置价格"→ **跳转到设置 → 用量统计并自动展开设置弹层**(跳转 API 见 §7-SPIKE-1,SPIKE 不过不做绕过式 hack)。
3. 界面开关:注册 `ctx.slots.inject('conversation.composer.dock', …)` 时提供持久化 store + hooked `useBillingStrip`;官方模式参照 StatsLine 的 `useStatsLine`(settings 行 + SnapshotStore)。
4. **门禁**:构建产物 `lib/client.js` 加载器模拟测试(现有 wrap-client 验证可能需扩展);typecheck;功能联动留待 P9 宿主联调。

### P6 用量统计页设置弹层
1. 导出按钮左侧加"设置"按钮(host `Button` 组件);点击打开**官方 `Modal`**(ui-primitives 已在 external 名单,本地 `ui-primitives.d.ts` shim 增补 `Modal` 声明)。
2. 弹层内容:① 界面开关(输入条显示/关闭,落持久化);② 模型多选框(源:`llm.listProviders()` + 用量日志模型并集,供应商名分组,勾选 = 参与计费的模型);③ 峰谷价开关(全局)+ **逐模型"峰谷计价关闭"勾选**(保留,中转商单一价场景);④ 价格编辑表(勾选模型逐行:命中/未命中/输出三输入;峰谷开时另显空闲列(默认高峰一半,可改));⑤ 官方参考价目表(只读,asOf + 来源链接);⑥ 保存 → `prices.set` → 提示结果。
3. **门禁**:组件拆分为 ≤300 行;typecheck + 构建。

### P7 费用展示联动(用量统计页)
1. KPI 费用合计(全历史,¥,悬停峰/谷拆分)、Top Sessions 行内费用(非 DeepSeek 显示"—"),导出 CSV/JSON 含费用列(峰、谷、合计)。
2. **门禁**:单测(导出/格式化)+ typecheck。

### P8 文档与契约同步(每阶段随改随更)
- README.md + README.zh-CN.md(峰谷口径、北京时间声明、估算≠账单、价表 asOf 与来源、非 DeepSeek 未定价、价格持久化位置)
- VENDOR.md(本地修改清单追加)、AGENTS.md §6 踩坑(新坑即时回填)
- 父仓库:`docs/features/usage-stats.md`(invariant 删除"不做余额 / CNY / 峰谷价",新增计费 invariant;last verified)、`docs/handbook/modules/usage-stats.md`、`.cursor/rules/usage-stats-product.mdc`(如含计费表述)
- **门禁**:`npm run check-pack` + `npm pack --dry-run` 无资产混入。

### P9 宿主联调(需要重启,由用户执行)
1. `npm run build` 后重启 dsh web(用户操作,会中断会话→**此阶段放置到会话外执行或提前与用户约定**)。
2. 逐项核对:条显示/开关/倒计时/峰谷正确性;设置面板模型列表与 dsh 提供商一致;改价后条与统计页即时更新;重启后价格仍在(文件落盘);无价模型"设置价格";旧投影缓存失效重折后数字正确。
3. **门禁**:上表人工清单全部通过为准。

## 5. 红线与风险

| 红线/风险 | 对策 |
|---|---|
| 只读承诺 | 价格写的是**插件自有域**,不触原始会话日志 |
| 竞品红线:硬编码虚构价格 | 官方价目 asOf+来源+单测锁值;自定义价明确标注;估算≠账单声明 |
| 竞品红线:宿主 DOM 探测 | 只用官方槽 `conversation.composer.dock` |
| 竞品红线:无可见性门控轮询 | 条轮询受 visibility + 开关双重门控,闲置不轮询 |
| 投影 stateVersion 变更 | 1→2,旧缓存自动失效;文档声明冷启动重折一次 |
| step/start 缺失的旧日志 | 回退事件时间判定;单测覆盖 |
| RPC 权威性 | session-cost 读 `stateOf`(活);`coldSnapshot`(冷);失败返错误码,条显示降级文案,不假报 |
| 浮点误差 | 全整数微元,单次舍入;单测锁边界 |
| 多供应商同模型 ID | `provider/model` 复合键,裸键作兼容回退 |
| 宿主重启中断会话 | P9 显式列为用户操作,不在会话内自动执行 |

## 6. 完成定义(DoD)

1. `npm test` + `npm run typecheck` + `npm run build` 全绿(含新单测)。
2. 宿主联调清单通过(§4 P9)。
3. README 双语 / VENDOR.md / feature card / handbook 同步且口径一致。
4. `npm run check-pack` 通过,无打包污染。
5. 五个需求均可在 UI 走通(条、设置、统计页、导出、重启持久化)。

## 7. 决策记录与 SPIKE(2026-08-26 用户确认)

**已决**:① 逐模型保留"峰谷计价关闭"选项(全局开关之外);② 设置界面 = 模态弹层(官方 `Modal`);③ 条上"设置价格"点击跳转到设置 → 用量统计并展开弹层;④ 条上悬浮仅显示当前模型一行价目,完整官方表在设置弹层看。

**SPIKE-1(点击跳转)——结论:无公开 API,回退方案已执行(2026-08-26)**。`openSection(id)` 仅作为设置协调槽 owner prop 存在,全树零调用点;`ctx.settings` 仅持久化;`ctx.layout` 仅面板几何。条上"设置价格"为提示文案(hover 内说明去设置页),不做跨区跳转 hack;如强需,向 DSH 提框架扩展点。

**SPIKE-2(模态弹层)——结论:官方 `Modal` 可用(2026-08-26)**。node_modules 真实类型与插件本地 shim 兼容;shim 增补 `Modal` 声明后 typecheck/build 通过。

**实现记录(2026-08-26,P1–P7 已完成并各自门禁全绿)**:共享纯函数(价目/窗口/微元数学/解析)→ 投影峰谷桶(stateVersion 2)→ 契约/聚合(OVERVIEW_VERSION 4,ModelItem/DayRecord 带 cost+provider)→ BillingStore(storageDomain 域)+ RPC(session.cost/billing.get|set/billing.models)→ composer.dock 费用条 → 官方 Modal 设置弹层 → KPI/会话卡/导出费用列;扫描两条路径接入 `scanPacer` 分批让步。测试 119/119,typecheck 干净。
