# Agent Note: 会话费用中的子代理消耗

Status: implemented

[English](2026-09-13-subagent-cost-folding.md) | 中文

## Problem

被委派的子代理运行在自己的 Session 里：它的 Agent、日志与 `billedUsage` 投影都属于子会话。输入框费用条只对当前 Session 的 `useProjection('billedUsage')` 计价，于是子代理花掉的每一个 token 在会话费用里都不可见——委派越多，费用条越低估。逐路由的悬停块有镜像的缺口：它打印路由的价格列，却不打印这条路由花了多少钱、消耗了多少 token，于是按模型的消耗只能在用量统计页上读到。

## Decision

**费用把当前 Session 与全部被委派的后代汇总成一个数字。** 委派关系读自标准 `useSessions` 座位本来就暴露的会话列表：当一行的 `origin` 为 `'subagent'` 且其 `parentId` 已在树中时，该行属于这棵树；从当前选中的 Session 递归下行，因为子代理还可以再委派（`ui-conversation/src/client/chat/subagent-cost.ts`，纯函数）。每个后代用它自己的 `projectionValues.billedUsage` 经同一个 `billedCostCents` 与同一份持久价格记录计价，费用条的金额、priced、partial 三个标志对全部来源聚合。一个总额、一条诚实规则：价格记录叫不出名字的子代理路由与当前会话的未定价路由同样上报，绝不按别的路由的价折算。

**子会话的用量本来就在客户端上。** `SessionListState.byId[row].projectionValues` 携带每个已列出会话的当前全部宿主计算投影值。Session Controller 的 manager 用三个既有来源维护这一列——每条 `session.list` 行的 `projections` 提示、Host 全局 control 基线、以及每会话的 `projection` 帧——因此子代理的 `billedUsage` 无需打开子会话就能到达本客户端。新的子样本经由驱动会话列表的同一个 store 通知移动费用条，延迟与当前会话自己的数字相同：不需要跨会话订阅，组件侧不需要触碰 `ctx.sessions.binding`，也不需要任何 host 改动。

**不引入 subagent 插件依赖。** `origin`、`parentId`、`displayTitle`、`projectionValues` 都是 session-controller 的行词表，所以没装 subagent 插件的程序里根本没有这类行，折叠自然为空；没有这两个座位（手装配、测试）时只对当前 Session 计价。子会话的显示名优先取父会话已加载目录的 label（`subagentsByParent[parent].entries`），否则取该子会话自己的列表显示名；`billedUsage` 尚未到达的后代不贡献任何金额，而不是一个有价的零。

**明细面报告消耗。** 每条已计费路由打印身份、它自己的费用（`费用 ¥X.XX`；价格记录叫不出名字的路由改为无价提示，其 token 照样打印，因为「这个模型跑过且没定价」正是要报告的事实）、高峰与空闲消耗，以及有价时的解析后价格列。token 计数渲染为本地化紧凑数（经 `t` 座位使用 `number.thousand` / `number.million`）；该格式化函数放在 `price-calculator.ts`，因为 `ui-chat` 里那个同款是另一个 feature 插件的值，本包不得导入。承载面是点击打开的会话费用卡片；[会话费用明细卡片](2026-09-13-session-cost-card.zh.md) 拥有它的各行之定义，也拥有本注此前「按来源分块」那套做法的反转。

**费用行自带它的桶。** `ModelCostRow` 增加该路由的 `peak` 与 `offPeak`，于是悬停从同一个值读一条路由的钱与 token，而不是把 `breakdown.rows` 与 `usage.models` 按下标拼起来——两张各自独立构建的列表按下标对齐，任一方顺序一变就会无声出错。

## Alternatives considered

**读父会话的 `subagentCatalog` 投影拿子会话清单。** 否决：它是 subagent 插件的投影键，读它就得建立本包不得建立的类型边；目录只在有 UI 观察时才拉取（`setSubagentCatalogOpen` / `refreshSubagents`），树一关费用条就会漏掉子会话；且那些行只带身份，而它们提供的 id 已经能从会话列表的 `parentId` 加 `origin` 推出来。

**在 Host 侧递归聚合、发布一个整树投影。** 否决：这是多余的工作。每个子会话已完成的 `billedUsage` 本来就为列表投递到了本客户端，加一个宿主单元只会多出一个投影键、一个状态版本和一个缓存代际，去算客户端用手上的值就能折叠出的和。

**通过 `ctx.sessions.binding(childId)` 订阅每个子会话的投影面。** 否决：binding 只对已在作用域内（已列出或已寻址）的 Session 存在，子会话会静默漏掉；且组件为拿数据去触碰对象层，绕开了客户端规则要求的四个 props 分享面。

**只算子会话的第一层。** 否决：委派会嵌套，只算一层的数字会以与「只算单会话」相同的方式低估。

**把所有会话合并成每个 `provider/model` 一行。** 反转：[会话费用明细卡片](2026-09-13-session-cost-card.zh.md) 在计价前把全部来源合并成一张路由表，因为无论多少子代理跑过同一模型，卡片的行与总额都必须对得上；而「哪一笔是哪个子会话花的」由那行折叠行回答，不再由路由行回答。

**悬停只保留价格列。** 否决：悬停的职责是每个模型花了多少、消耗了多少。价格列是费率；费用行与 token 行才是费用条存在的理由的答案。

## Consequences

费用现在为整棵委派树作答，因此把工作委派出去的会话不会再显得比实际便宜。代价是行里多了一个框架座位（会话列表）、每次列表通知都要重新推导，以及一个结构比较（`equalSubagentSources`）来避免无关的列表抖动重绘费用条。折叠对它看不见的部分保持诚实：投影值尚未到达的后代、以及没有会话座位的挂载，都不贡献任何金额——是可见的低估，绝不是编造的数字——而明细面通过那行折叠行点名纳入的子会话，不再靠给路由行加前缀。

验证钉在本包内。`subagent-cost.client.spec.ts` 覆盖直系子会话、孙代、由近及远的顺序、排除兄弟分支与普通 fork、无用量值的子会话、目录 label 优先及其显示名回退、以及血缘环。`session-cost-row.client.spec.tsx` 覆盖父会话与子代理共用同一模型的合并行、折叠行默认折叠的汇总与键盘展开、未定价子路由上报「没有设置价格」且不被折进小计、子会话报告新样本时的实时重算、以及缺座位时的回退。`price-calculator.client.spec.ts` 覆盖费用行自带各自桶、每模型一行的合并、以及紧凑 token 格式化函数。

## Related

[会话费用明细卡片](2026-09-13-session-cost-card.zh.md) 拥有点击打开的面、计价前合并的规则，以及取代本注「按来源分块」的那行折叠行。[按路由的会话费用与唯一价格编辑器](2026-09-13-per-route-session-cost.zh.md) 拥有逐路由折叠、breakdown、价格记录，以及本费用所扩展的状态条。[会话费用数字与 billed-usage 投影](2026-08-29-composer-session-cost.zh.md) 拥有投影单元与状态条的费用半边。session-projection 子系统页（`docs/subsystems/session-projection.md`）拥有列表这一列所镜像的投递机制。
