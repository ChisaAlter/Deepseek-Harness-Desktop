# Agent Note: 识图目录模态与火山 ARK 的 developer 角色

Status: implemented

[English](2026-08-18-vision-catalog-modalities-and-ark-developer-role.md) | 中文

## 问题

对着火山 ARK coding 端点的手工 `openai-completions` 路由，会以两种互不依赖的方式失败，而且常常出现在同一份配置里。

**A.** `llm.models` / `session.models` 列出模型时不带 `inputModalities`。识图回退的下拉框把每一行都平铺进去，于是一个 catalog 里没有的视觉 id（或任何纯文本模型）都能被存成指定路由。聊天贴图因为已经配置了回退路由而放行图片，随后 `llm-pi-ai` 在任何网络请求之前就在本地拒绝：`pi-ai model "…" does not support image input`。模型表单已经允许条目声明 `input`；目录与下拉框并没有消费这个事实。

**B.** pi-ai 的 completions 适配器在 `compat.supportsDeveloperRole` 为真时，会把 reasoning 模型的 system prompt 以 `role: "developer"` 发出，而其 URL 探测把未识别主机当成标准 OpenAI。`ark.*.volces.com` 不在那份白名单里，于是 ARK 返回 400：它只接受 `system`、`assistant`、`user`、`tool`。`PiAiCompatProfile` 当时只提供 `thinkingFormat` 与 `supportsReasoningEffort`，因此 YAML 规避写法 `compat.supportsDeveloperRole: false` 过不了 schema。

## 决策

**A.** `buildModelCatalog` 把每个已列出模型的 `inputModalities` 抄到 `ModelCatalogModel` 上。`VisionModelPicker` 只提供列表中含 `'image'` 的行。从该过滤列表中消失的已存路由仍作为陈旧选项保持选中（用 id 而非显示名），这样先前保存的纯文本指定不会被悄悄拨到「不启用」。

**B.** `PiAiCompatProfile` 含有 `supportsDeveloperRole`，海拔与「仅 openai-completions」规则与另外两个分派开关相同（[[2026-08-08-pi-ai-per-model-reasoning-declarations]]）。解析顺序为模型 → 路由 → 已安装 catalog 条目 → 在 `volces.com` / `*.volces.com` 主机上为 `false` → pi-ai 按 URL 得出的猜测。ARK 主机上显式的 `true` 或 `false` 仍然胜出。pi-ai 的 `getCompat` 已经尊重 `model.compat.supportsDeveloperRole`，因此物化出的字段就是协议所读的值。

模型编辑器没有这个开关的 compat 控件：ARK 默认值覆盖常见情形，覆盖仍写在 `settings.yaml`。

## 曾考虑的替代方案

- **把每条手工声明的 completions 路由都默认 `supportsDeveloperRole: false`。** 对第三方网关更安全，但真正指向 `api.openai.com` 的手工路由会停止发送 `developer`，直到 profile 再改回去。在 `*.volces.com` 上按主机探测，能修掉所报告的端点，而不改动其他网关。
- **给 pi-ai 的 `isNonStandard` 白名单打补丁。** 探测逻辑在 `@earendil-works/pi-ai` 里；本仓库钉住该包，并不 vendor 其源码。Harness 侧默认值加上显式 profile 字段，正是本适配器已经为另外两个分派开关所拥有的那一层。
- **从模型 id 推断图像能力（剥日期后缀、catalog 模糊匹配）。** 错判为「能」会在轮次中途让提供方拒绝一张已经持久化的图片。声明的 `input` 加上过滤后的下拉框，与模态链其余部分已经使用的那份声明相同（[[2026-08-12-pi-ai-route-default-input-modalities]]）。
- **除非指定模型宣称支持图像，否则让 `VisionFallback.configured()` 为假。** 这会把仅 YAML 写错的配置推回主模型准入错误（`Model "…" does not support image input`），而那条错误点名的是错误的模型。下拉框过滤与现有的 pi-ai 本地拒绝保留；更友好的回退路由诊断不在本次变更里。

## 后果

从模型页做出的识图回退指定，只能点名目录列为具备图像能力的模型，除非运维人员保留陈旧的已存路由，或手写 `settings.yaml`。ARK 的 reasoning 路由在无需额外 YAML 的情况下发送 `system`。其他未知的 OpenAI 兼容主机仍使用 pi-ai 对 developer 角色的默认值。

## 测试

`packages/host/apiproxy/tests/api-proxy-models.spec.ts` 钉住 `llm.models` 上列出的 `inputModalities`。`packages/client/ui-settings-models/tests/vision-model-picker.client.spec.tsx` 钉住仅图像选项、陈旧纯文本选中、保存/关闭，以及加载/保存失败。`packages/llm/llm-pi-ai/tests/catalog.spec.ts` 钉住 ARK 主机默认值、显式覆盖、无法解析的 URL，以及仅 openai-completions 的拒绝；`adapter.spec.ts` 钉住路由拒绝 developer 角色时协议上 `messages[0].role === "system"`；`config.spec.ts` 钉住 schema 字段。
