# Feature: 会话累计费用显示与按峰谷分桶计价

| Field | Value |
| --- | --- |
| **id** | `session-cost-display` |
| **status** | `active` |
| **last verified** | 2026-08-29 — `vendor/deepseek-harness` 定向 vitest（token-meter billed-usage 13 例、price-calculator 16 例、session-cost 行 16 例、session-cost 设置 6 例、ui-conversation 全包 608 例、ui-model-selection 全绿）+ `pnpm run test:gui` 全量 5478 例全绿；价格数学与触发矩阵均以固定 UTC 时刻钉死。修复「自定义提供方 DeepSeek 模型不能显示」「添加提供方的模型未进入价格设置模型表」「同模型 id 未按提供方分别显示/定价」后复跑：ui-conversation 全包 621 例、ui-model-selection 22 例全绿（新增「同 id 不同提供方分别显示并按 provider/model 保存」「遗留裸键迁移到各提供方」「composite 键优先于遗留裸键」等用例）。 |

## User paths

1. 设置 → 界面设置：「会话累计费用」开关位于「会话统计」开关正下方（order 72）。打开后，当 `billedUsage` 投影在线时（任何路线、任何模型状态）峰谷状态行同一行显示费用段：已定价模型或官方列显示「当前会话费用：¥X.XX」；未知或未定价的模型显示「没有设置当前模型价格」（提醒 + 入口）；悬停费用段展示当前模型的价格（官方列或峰谷价模型为高峰/空闲两行，单一价格模型为「价格」单行；未设置显示「没有设置价格」）。「设置价格」入口保持其旁；关闭开关或投影缺席任一成立即隐藏，绝不显示编造的 ¥0.00。
2. 峰谷行文案「空闲时段 距离切换剩余时间：HH:MM:SS」悬停出现内容相同的 tooltip；时段圆点仅在「官方峰谷时」开关开启时着色（空闲绿/高峰红），仅检测路线时为中性色——时段色只是视觉提示，绝不参与计价。
3. 「设置价格」（峰谷行）或界面设置「会话累计费用」行的「设置模型价格」按钮打开价格面板（560px 宽、内容可滚动），模型按渠道区分：**官方 DeepSeek 模型只读**——三个禁用输入框展示公布的高峰价、旁注空闲数字，不可编辑、不写入记录（保存时遗留的官方改价被过滤）；**其他渠道模型**仅来自 dsh 模型目录通告的模型（`conversation.modelCatalog` 推送、目录增删自动跟随；设置行聚合由 Host 作用域 `llm.models` 目录在启动与每次拓扑/设置失效时播种，因此「设置→模型」刚添加的提供方即使尚无会话目录发布也会出现在下拉；每个 (provider, model) 对为独立条目，同一模型 id 被多个提供方服务时分别显示在各自提供方之下并可分别定价；非官方 deepseek-v4 模型在下拉中以 Provider ID 作前缀区分，无手填添加行）自由编辑「价格」三输入框（无高峰标注、无空闲提示）；目录模型 id 与官方列同名时，官方只读列保持列出，目录条目作为独立可编辑条目以提供方前缀并列显示——自定义网关转发的 DeepSeek 模型可被定价，官方公布列仍可见；id 含 deepseek-v4 关键词的非官方模型另有「峰谷价」开关——开启后高峰/空闲两组分别编辑并持久化显式空闲列，关闭则编辑单一价格；「清空价格」按钮删除选中模型的自定义条目；正数校验、保存/取消。保存立即重算并持久化；取消丢弃。
4. 新用量产生时 Host 增量重折 `billedUsage` 投影，费用在推送延迟内（<1s）更新，翻页与压缩不改变总额。

## Invariants

- 计费时刻表与峰谷行一致：北京时间（UTC+8）工作日 09:00–12:00 ∪ 14:00–18:00 为高峰，其余（含周末）为空闲。Host 折算在 `token-meter/src/billing-window.ts`，浏览器呈现孪生体在 `ui-conversation/src/client/chat/peak-valley.ts`，两处必须一起改。
- 每个用量样本按其步骤 `step/start` 时刻的窗口计价（跨边界请求按开始时刻计）；无匹配步骤开始的样本退回自身事件时间。样本沿用 tokenUsage 的按 (turn, step) 替换规则。
- 桶为 `{missInputTokens, cacheReadTokens, outputTokens}`，缓存写入折入未命中侧；桶不含价格——套价全在客户端 `price-calculator.ts`：官方表同时携带每桶各自公布的空闲/高峰两列，计价直接读所在时段的列，两列互不推导；费率 = 整数「微元/百万 token」，`Σ(峰桶×峰列 + 空闲桶×空闲列) / 1e10` 一次取整为整分。
- 模型列解析：用户改价（按 `provider/model` 精确匹配，描述其高峰列；裸模型 id 的遗留记录按模型 id 对任何服务该模型的提供方生效）→ 官方列（大小写不敏感）→ 官方表首列（默认，费用文案以 title 提示）。模型与提供方来自最新定稿 assistant 节点的持久 `provenance`（消息 source），无节点时模型为 null、提供方取当前路线事实。
- 持久字段：`ui-conversation.sessionCost`（boolean，缺省读作 false，不物化默认）、`ui-conversation.sessionCostPrices`（宽松可选对象，采纳端清洗为纯记录；记录中存在即自定义，缺席即官方/默认）。
- 开关行经 `settings.interface.item`（id `session-cost`，order 72，「会话统计」下方、「官方峰谷时」上方）挂载。
- 峰谷行既有 props 契约不破坏：费用座位（useSession/useSessionCost/useCostPrices/setCostPrices/useProjection）全部为可选 props，生产注入面始终绑定。

## Allowed touch

- `vendor/deepseek-harness/packages/llm/token-meter/`（billed-usage-projection、billing-window、projection 类型、README 双语）
- `vendor/deepseek-harness/packages/client/ui-conversation/`（price-calculator、PeakValleyRow、PriceSettingsPanel、CostSettingsRow、submission-settings、submission-policy、locales、apply、assistant 节点 provenance、README 双语）
- `vendor/deepseek-harness/packages/client/ui-model-selection/src/client/service.ts`（`catalogModelIds`/`catalogUnion`/`catalogOf` 按 (provider, id) 保留同名模型，使自定义提供方模型进入价格面板目录；不动 `modelFacts` 形状）
- `vendor/deepseek-harness/.agents/notes/implemented/feature/2026-08-29-composer-session-cost.*`
- 本卡与 `docs/features/composer-stats-peak-valley.md` 的交叉引用

## Do not touch

- `ui-model-selection` 的事实形状：`{provider}` 精确形状被既有测试钉死，模型 id 不得走 modelFacts
- 峰谷行的既有触发矩阵与倒计时语义（`composer-stats-peak-valley` 卡拥有）
- token-meter 其余三个投影（tokenUsage/contextPressure/contextBreakdown）的状态形状与线视图

## Gates

| Kind | What |
| --- | --- |
| Automated | `vendor/deepseek-harness`：`pnpm exec vitest run packages/llm/token-meter packages/client/ui-conversation packages/client/ui-model-selection`；`pnpm run test:gui` |
| Manual / QA | 开启会话累计费用后向 DeepSeek 会话发送消息，费用在 1s 内更新；跨北京时间边界前后各发一条消息，核对峰/谷单价；面板改价后数字立即变化；关闭开关或切到非 DeepSeek 模型后数字消失 |

## Sources

- Agent Note：[vendor/deepseek-harness/.agents/notes/implemented/feature/2026-08-29-composer-session-cost.md](../../vendor/deepseek-harness/.agents/notes/implemented/feature/2026-08-29-composer-session-cost.md)
- Implementation entry：`ui-conversation/src/client/chat/price-calculator.ts`、`chat/PeakValleyRow.tsx`、`chat/PriceSettingsPanel.tsx`、`settings/CostSettingsRow.tsx`、`token-meter/src/billed-usage-projection.ts`
- 相关决策：[composer peak/valley status](../../vendor/deepseek-harness/.agents/notes/implemented/feature/2026-08-29-composer-peak-valley-status.md)、[projected token usage](../../vendor/deepseek-harness/.agents/notes/implemented/architecture/2026-07-29-projected-token-usage-and-request-context.md)
