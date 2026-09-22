# Agent Note: 获取可用模型时用 models.dev 补全

Status: parked（dsh-v0.1.1-rc.1 上的桌面 fork；随 wip 停放提交落地，尚未发布）

[English](2026-08-21-models-dev-enrichment-on-fetch.md) | 中文

## Problem

端点询问（`llm.discoverModels`）通常只返回模型 id，几乎不带其它字段。Models 页已经能编辑每模型的 `contextWindow`、`maxTokens` 与 `reasoningEfforts`，但采纳发现结果时，思考强度默认不勾选，容量也常为空（除非列表本身披露）。操作者只能手工再填一遍，或留下未声明强度的模型，导致 composer 没有可用的思考档位。

## Decision

Models 页（`ModelListEditor`）在发现成功后，浏览器尽力加载 `https://models.dev/api.json`（force-cache），并在采纳选择框出现前补全每个候选：缺失容量取自匹配记录的 `limit`，`reasoningEfforts` 取自 `reasoning`／`reasoning_options`，键与 wire 拼写与页面既有写入约定一致。匹配优先官方 provider 猜测，其次唯一命中，再次取容量最小的歧义记录；绝不混用不同 provider 的字段。端点已披露的容量始终优先。无匹配 id，以及目录／网络失败，都保持发现行不变。元数据沉默时，页面不会发明一整套思考强度勾选。

补全留在 client 包（`models-dev-metadata.ts`）。它不扩展 Host `discoverModels`，不新增 settings 桥，也不自动勾选输入模态。表单规格可通过 `setModelsDevEnrichmentDisabledForTests` 关闭网络路径。

## Alternatives considered

- **采纳时盲勾全部思考强度。** 错误声明会进入 composer，并可能拒绝或错配请求；否决。
- **在 Host `discoverModels` 内补全。** 对单一 RPC 更干净，但为 Models 页 UX 缺口引入 Host 网络策略、缓存与适配器面；延后。
- **依赖社区高级配置插件。** 官方 Models 已拥有精选字段；缺口在采纳路径，而不是第二块设置分区。

## Verification

单元规格覆盖匹配、强度映射、容量优先与 best-effort 失败。Provider-form 规格用桩接的 models.dev 元数据验证采纳、保留发现容量，并在补全关闭或不可达时采纳仅含 id 的行。实机端点探针驱动位于 `scripts/live-fetch-enrich-probe.ts`（手工运行；不属于规格门）。

## Consequences

获取可用模型可以在不编辑 `settings.yaml` 的情况下落到可用的上下文窗口与思考强度；models.dev 不可用或网关使用私有 id 时仍可失败软降级。
