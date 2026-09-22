# Agent Note: 自定义提供方的 DeepSeek 模型可列出并可定价

Status: implemented

[English](2026-08-29-custom-provider-deepseek-model-price.md) | 中文

## Problem

价格设置面板（设置模型价格 / 价格设置）在自定义提供方的模型 id 恰好与官方 DeepSeek 列同名时，无法显示该模型。两处独立折叠共同造成此症状。

在 `PriceSettingsPanel` 中，下拉按模型 id 大小写不敏感去重，并把官方价格表中的每个 id 一律判为只读。自定义网关（如 `my-gateway` 转发 `deepseek-v4-flash`）的目录模型因此被先推入的官方 `deepseek-v4-flash` 列吞掉，没有自己的可选项；即便被选中，面板也仅按模型 id 调用 `officialPriceFor`，渲染为禁用输入。用户完全无法为自己终端定价。

另一方面，`ModelDirectoryResolver` 的 fiber 级目录并集仅按模型 id 作键。当官方路线分组先通告同一 id 时，自定义提供方的同名条目从 `catalogModelIds()` 中被丢弃，设置行聚合从未把非官方提供方交给面板。

## Decision

两层现在都识别「模型 id」与「提供它的路线」不是一回事。

面板保持官方列只读列出，并把每个目录 (provider, model) 对作为独立可编辑条目，以 `provider/model` 为键——同一模型 id 被两个提供方服务时分别列出并分别定价，不再折叠为先通告的提供方。遗留裸模型 id 价格在打开时迁移到每个服务该模型的可编辑目录条目；`resolveModelPrice(provider, model, prices)` 先读复合键，再读裸遗留键，最后读官方列；dock 把会话的提供方（来自最后一条 assistant 消息的 provenance）一并传入。`isDeepSeekProvider` 从 `chat/peak-valley.ts` 移入共享的 `price-calculator.ts`，面板与峰谷行读取同一事实源；`chat/peak-valley.ts` 为既有导入再导出它。

resolver 把 `catalogUnion` 与 `catalogModelIds()` 的去重改为按 `(provider, id)`，而非仅按 id，因此根作用域设置行会携带自定义提供方的同名模型，而不是折叠为先通告者。并集还以 Host 作用域的 `llm.models` 目录在启动时与每次拓扑/设置失效时播种，因此在「设置→模型」刚添加的提供方即使尚无任何会话目录发布也能进入价格面板。`catalogOf`（composer/dock 目录）的当前所选回退也改为按 `(provider, id)`，因此自定义提供方当前所选模型即使与其它提供方通告同 id 也会被并入。

## Alternatives considered

- **按 `provider/model` 作为计价键。** 采用：提供方 route id 不含 `/`，因此按首个 `/` 拆分无歧义（即使模型 id 本身含 `/`），持久化记录对每个 (provider, model) 保留一个槽位，两个提供方服务同一 id 可分别定价。
- **同时显示官方列与带前缀的目录条目。** 自定义条目携带独立 option 值（`provider/model` 键），草稿与持久化记录使用同一键，官方列保持可选，每个提供方的编辑落在自己的槽位。
- **resolver 仍按 id 去重、面板只并入当前所选模型。** 否决：当前所选回退只覆盖使用中的模型，而非自定义提供方通告的全部模型，且设置行没有会话作用域读取当前选择。

## Consequences

模型 id 不再是一个跨路线价格槽位：记录按 `provider/model` 键控，官方列 id 的自定义条目或两个提供方的同 id 模型各自独立定价，遗留裸键在重新保存前仍对任何提供方生效。官方列保持只读列出，与自定义条目并列。route id 本身含「deepseek」的自定义中继仍被共享谓词视为 DeepSeek 路线，与峰谷行既有约定一致。

## Testing

`session-cost-settings.client.spec.tsx` 新增用例：官方列保持列出，与它同名的目录模型作为独立、带提供方前缀的可编辑条目存在；同一模型 id 在两个提供方下分别列出并按 `provider/model` 键保存；遗留裸键价格迁移到每个服务该模型的提供方。`session-cost-row.client.spec.tsx` 新增用例：会话模型由自定义路线服务时，面板打开即选中可编辑条目。`browser-plugin.client.spec.ts` 新增用例：`catalogModelIds()` 对同一 id 同时保留官方路线与自定义提供方条目；并集可由 `llm.models` 播种，使新添加的提供方无需任何会话目录即可列出。全量套件通过：ui-conversation 621 例、ui-model-selection 22 例（两包 typecheck 干净）。
