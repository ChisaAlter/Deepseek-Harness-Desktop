# Agent Note: 模型表单列出全部 pi-ai 思考档位

Status: implemented

[English](2026-08-19-models-form-thinking-levels.md) | 中文

## 问题

模型目录编辑器只能声明 pi-ai 七个思考档位中的五个（`low` 到 `max`），把 `max` 标成 Extreme，并把 `off` / `minimal` 留作只能写 YAML。因此添加第三方推理模型时无法提供关闭或极低，而要找 Max 的用户也看不到这一档。

## 决策

每个 pi-ai 模型行都列出全部规范档位——`off`、`minimal`、`low`、`medium`、`high`、`xhigh`、`max`——做成等宽、可换行的胶囊。勾选 `off` 以外的档位时，协议拼写与键相同（`high: high`）。勾选关闭则写入 `off: null`：提供 Off，分派什么也不发送，对应 [按模型推理声明](2026-08-08-pi-ai-per-model-reasoning-declarations.md) 里无值的 YAML `off:`。只提供 Off 的字典在保存前被拒绝；那既不是思考模型，也不是 `reasoningEfforts: false`。输入框的档位面板里 `xhigh` / `max` 的标签为 Extra High / Max。

## 曾考虑的替代方案

**继续把 Off 留作只能写 YAML，因为勾选是思考强度而不是「不要思考」。** 否决：Off 是用户会配置的命名档位（OpenAI 的 `none`、DeepSeek 的关闭），而表单已经拥有梯子上的其余档位。

**像其他档位的恒等映射那样写入 `off: off`。** 否决：带值的 `off` 会把该拼写发到协议上；常见情况是无值的 Off。OpenAI 的 `none` 改名与其他自定义拼写一样仍只能写 YAML。

**再加 Gemini 的 `thinkingBudget` 或一枚自由文本 Ultra 胶囊。** 否决：那是 token 上限和网关改名，不是新的 pi-ai 思考档位。

**继续用 Extreme 作为 Max 的标签。** 否决：Max 才是用户会去找的 API 名称。

## 后果

手工声明的模型可以提供 OpenAI、Anthropic、DeepSeek、GLM 与 Grok 文档中的同一套命名梯子。自定义协议拼写仍只能写 YAML。同一张卡片上的输入类型勾选复用这套胶囊布局。

## 测试

`provider-form.client.spec.tsx` 钉住七枚胶囊、`off: null` 加恒等拼写，以及只勾选关闭时拒绝保存。`validateDeepSeekModels` 钉住 `effortOffAlone`。`adapter.spec.ts` 与 `declared-reasoning` web 快照钉住 Extra High / Max 选择器名称。`styles.client.spec.ts` 钉住等宽换行胶囊。`models-settings` 的 declared-edit 快照钉住中文胶囊标签。
