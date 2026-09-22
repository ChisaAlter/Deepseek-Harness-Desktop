# 模型网关转换层参考（参数映射表 + 流式支持矩阵）

> 对应实现：`packages/server/src/server/model-gateway/model-gateway.ts`
> 维护规则：修改任一转换函数时必须同步本表；新增已知丢弃项时必须在此登记。

## 1. 请求参数透传决策表

转换函数：`anthropicToChat` / `chatToAnthropic` / `responsesToChat` / `chatToResponses`（链式组合 `anthropicToResponses` / `responsesToAnthropic`）。

| 参数                          | Anthropic 目标                                                                            | Chat 目标                                                                                                                                      | Responses 目标                                                                                           |
| ----------------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `temperature` / `top_p`       | 存在即转发                                                                                | 存在即转发                                                                                                                                     | 存在即转发                                                                                               |
| `max_tokens`                  | 转发（chat/responses 源）                                                                 | `max_output_tokens` → `max_tokens`                                                                                                             | `max_tokens` → `max_output_tokens`                                                                       |
| `stop_sequences`（Anthropic） | —                                                                                         | → `stop`（string[]）                                                                                                                           | 经 chat 链 → 丢弃                                                                                        |
| `stop`（chat/responses）      | → `stop_sequences`（string[]；string 包为单元素数组）                                     | 转发                                                                                                                                           | **丢弃**（已知丢弃项，见下）                                                                             |
| `tool_choice`                 | `{type:"tool",name}`（来自 chat `{type:"function",function:{name}}`）；`auto`/`none` 直通 | `{type:"function",function:{name}}`（来自 anthropic `{type:"tool",name}` / responses `{type:"function",name}`）；`auto`/`none`/`required` 直通 | `{type:"function",name}`（来自 chat `{type:"function",function:{name}}`）；`auto`/`none`/`required` 直通 |
| `stream`                      | 转发                                                                                      | 转发                                                                                                                                           | 转发                                                                                                     |
| `tools`                       | 转换为 `{name,description,input_schema}`                                                  | 转换为 `{type:"function",function:{name,description,parameters}}`                                                                              | Responses 接受 chat 形状，直通                                                                           |

### 已知丢弃项（写死契约，改动需登记）

| 参数                                      | 行为                                                            | 原因 / 备注                                                                           |
| ----------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `stop` → Responses 目标                   | 显式丢弃（含经 anthropic→chat→responses 链的 `stop_sequences`） | Responses `stop` 形状不与 chat/anthropic 的语义一一对应；保持网关行为可预测           |
| `thinking` / `thinking_options`           | 不跨格式转换                                                    | 各协议 thinking 形状差异大；由网关配置的 `thinkingOptions` 模型定义驱动，不在请求透传 |
| `parallel_tool_calls`（chat）             | 不跨格式转换                                                    | anthropic/responses 无等价的强制并行语义                                              |
| `tool_choice` `{type:"any"}`（Anthropic） | 丢弃                                                            | chat/responses 无直接等价物（`required` 语义不同）；需要时用 `{type:"auto"}`          |

## 2. 流式转换支持矩阵（`createStreamingTextTransform`）

| 上游格式        | 目标格式              | 文本 delta                                                                              | tool-call 累积                                                                                    | 说明                                                      |
| --------------- | --------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| chatCompletions | anthropic / responses | ✓ 实时                                                                                  | ✓ `tool_calls[].index` 键控；缺 index 时：无名无新 id 的片段归并到在飞调用，否则分配新 index      | finish 时一次性输出完整工具调用                           |
| anthropic       | chat / responses      | ✓ 实时（`content_block_delta.text`）                                                    | ✓ `content_block_start(tool_use)` + `input_json_delta` 按 block index 累积                        | `server_tool_use` / `mcp_tool_use` 与 `tool_use` 同等转换 |
| responses       | chat / anthropic      | ✓ 实时（仅 `response.output_text.delta`；`function_call_arguments.delta` 不泄漏为文本） | ✓ `output_item.added(function_call)` 分配序号 + `function_call_arguments.delta` 按 `item_id` 追加 | item_id → 序号映射跨 SSE 块保持                           |

### 流式输出格式要点

- **目标 chatCompletions**：tool-call 以 `choices[0].delta.tool_calls[{index,id,type:"function",function:{name,arguments}}]` 单块输出完整参数；`finish_reason` 为 `tool_calls` 当且仅当有工具调用。
- **目标 anthropic**：tool-call 以 `content_block_start(tool_use)` + 单条 `input_json_delta`（全量参数）+ `content_block_stop` 输出；`message_delta.stop_reason` 为 `tool_use` 当且仅当有工具调用。
- **目标 responses**：`response.output_item.added/done` 携带完整 `function_call` item，`id` 与 `call_id` 同源（缺 id 时由 `newToolCallId()` 生成，跨 item 稳定）。
- 所有方向的工具调用都在 finish 事件前输出，文本保持实时流式。

### HTTP 出口与取消语义

- 请求体 `stream: true` 时，daemon HTTP route 以背压感知的管道逐块转发 `Response.body`；同格式、跨格式转换和非 2xx 响应都不做整响应缓冲。
- route 保留响应状态码与 `content-type`，不复制可能失效的 `content-length`；`stream: false` 保持完整响应发送语义。
- 客户端在响应自然结束前断开时，route 会取消上游 fetch；该信号也贯穿 synthetic/MoA 节点和聚合请求，取消不会被吞成普通节点错误或继续启动聚合器。
- synthetic/MoA 当前仍先完成节点与聚合计算，再生成 SSE 形状的响应；上述 HTTP 转发不会把它变成增量生成。

## 3. 工具参数清洗

- `sanitizeToolCallArguments`：JSON 解析成功后树遍历（任意深度）截断 `timeout_ms` / `timeoutMs` / `timeout` / `command_timeout_ms` 为整数（`Math.trunc`，负数归 0）；无变化时返回原始文本（不重序列化）；解析失败回退原文本。
- 工具调用 id 兜底：chat→anthropic / anthropic→chat / chat→responses 方向的空 id 统一由 `newToolCallId()`（`call_<uuid>`）填充，保证 `function_call_output`/`tool_result` 配对稳定。

## 4. Responses→Chat 输入白名单

`appendResponsesInputAsChatMessages` 只转换 `message` / `function_call` / `function_call_output` 三类 item；`reasoning` / `web_search_call` / `computer_call` 等其余类型一律跳过且**不 flush** pending assistant，避免噪音 item 打断 `assistant.tool_calls → role=tool` 邻接配对。
