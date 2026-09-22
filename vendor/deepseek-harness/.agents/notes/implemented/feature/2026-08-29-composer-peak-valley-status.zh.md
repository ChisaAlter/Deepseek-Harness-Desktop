# Agent Note：会话统计宽度对齐与官方峰谷时状态行

Status: implemented

[English](2026-08-29-composer-peak-valley-status.md) | 中文

## 问题

composer dock 的会话统计条以 `--dsh-chat-content-width` 为上限，而输入卡以 `--dsh-composer-card-max-width`（内容宽 + 32px）为上限，且可被拖拽到任意宽度。因此统计条默认比输入卡窄 32px，也从不跟随宽度拖拽。另一方面，DeepSeek 官方峰谷计费时段（北京时间工作日 09:00–12:00 与 14:00–18:00，其余时刻按各自公布的空闲价格计费）在对话界面不可见：没有任何东西告诉用户当前会话的请求落在哪个窗口、距离下一次切换还有多久。

## 决策

**宽度模型。** 两个 dock 行（`StatsLine` 与新增的 `PeakValleyRow`）统一以 `var(--dsh-composer-resized-width, var(--dsh-composer-card-max-width))` 为上限。宽度拖拽提交期间 seat 恰好发布 `--dsh-composer-resized-width`（`ComposerResizeHandles.applyWidth`），重置时移除；自定义属性可继承，因此两行经窗口缩放与拖拽实时贴合输入卡——纯 CSS、逐帧精确、零测量代码，且因为两盒共享输入栏的 flex 列与 `width: 100%`，两种状态下的边缘都逐像素一致。（卡片边缘对齐的决策后来被回退为消息列轴居中——见[行居中决策](2026-08-29-composer-row-centering.zh.md)，对齐契约由它持有。）

**峰谷状态行。** `PeakValleyRow` 注册在 `conversation.composer.dock` 的 `order: 1`（统计条目保持 0），渲染一枚状态色圆点、时段名称，以及与整秒对齐的倒计时。时段计算在纯模块 `peak-valley.ts`：把时刻平移固定的 UTC+8 偏移（Asia/Shanghai 无夏令时）后用 UTC 访问器读取；高峰为工作日 `09:00–12:00 ∪ 14:00–18:00`；下一次切换是 `{09:00, 12:00, 14:00, 18:00}` 中第一个严格晚于当前的工作日边界（每个候选都是真实切换点；周末不产生边界）。组件每秒在整秒对齐的计时器上重算完整状态，因此边界翻转——颜色、文案与倒计时目标——落在边界后的第一个 tick，无漂移累积。

**触发条件的析取。** Host 持久化的 `ui-conversation.officialPeakValley` 界面设置开启时（新增 `official-peak-valley` 行，order 75，紧邻会话统计开关下方），或当前会话的模型路线为 DeepSeek API 提供方（`deepseek-official`、目录提供方 `deepseek`，按大小写不敏感子串匹配）时显示；两类触发都消失即整行隐藏。provider 事实为 `null`（目录未加载，或未组合模型选择插件）时两个触发都不满足。

**provider 事实推送。** DeepSeek 触发读取 `ctx.conversation.modelFacts`——composer blocks（`blocks.ts` 模式）旁的第二个每会话注册表：ui-model-selection 的 `ModelDirectoryResolver` 在 raise/clear composer block 的同一个目录 store 订阅里发布 `{ provider: current?.provider ?? null }`，并在 scope 释放时清空事实。由于目录的每次变化（加载、选择、adapters-updated、设置更新、重连）都会重新发布，在 composer 模型座位或 /model 弹层里切换模型会立刻刷新状态行——无轮询、无重复 RPC、无陈旧缓存。

## 已考虑的替代方案

**用 ResizeObserver 把卡片宽度镜像进两行。** 否决：seat 已经把提交后的宽度作为可继承的自定义属性发布，CSS 同步解析出同一约束；观察器只会为每次拖拽帧增加一次 JS 往返，并为同一事实引入第二个事实源。

**ui-conversation 自行请求 `session.models`。** 否决：`selectModel` 只通过模型目录自己的 store 发布（没有远端广播），并行拉取方在下一次 adapters/settings 事件或菜单打开前会一直显示旧 provider——违背实时同步要求——还要复制目录的整套刷新触发条件。

**把 provider 做成 Host 投影。** 否决：为唯一一个客户端消费者新增 wire schema、Host 单元与客户端键；模型目录本就是路线的权威、响应式所有方（[先前否决向统计行投递模型事实](../architecture/2026-07-29-projected-token-usage-and-request-context.zh.md)针对的是没有实时消费者的容量数字；峰谷行正是那个消费者，而 blocks 推送正是 ui-model-selection → ui-conversation 事实的既定方向）。

**硬编码 provider 白名单。** 否决：匹配 `deepseek` 子串即可覆盖两个已发布的路线 id 和未来任何 DeepSeek 路线，不必在展示层逐一枚举。

## 后果

两行的对齐契约由[行居中决策](2026-08-29-composer-row-centering.zh.md)持有：统计条与峰谷状态行在所有布局状态下都在共享消息列轴上居中，该行也是唯一标注官方计费窗口的界面。`officialPeakValley` 加入持久的 `ui-conversation` 设置 schema（默认 `false` = 仅检测），与其他界面偏好一样跨端口跟随用户（[界面可见性决策](2026-08-19-interface-settings-chrome-visibility.zh.md)的表格增加一行）。未组合 ui-model-selection 的装配中 DeepSeek 触发永远不满足——设置开关仍然有效。该行只在停靠态 composer 渲染（hero 态没有 dock），与统计条一致。单元 spec 以固定 UTC 时刻钉住时段计算（与宿主时区无关）、假时钟下的触发析取与边界翻转、设置 schema，以及事实推送的完整生命周期。Web 的 a11y goldens 现在会把状态行的时段标签归一为 `{{peakPhase}}`、倒计时归一为既有的 `{{clock}}`，重放链路因此与运行落在哪个北京时段无关、保持稳定。
