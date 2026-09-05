# @deepseek-ai/dsh-llm-vision-fallback
[English](README.md) | 中文

由用户指定的视觉模型为图片附件生成描述，使纯文本主模型（例如 DeepSeek）也能处理这些图片。

模型设置页把指定路由保存在 `vision-fallback` 设置命名空间（`provider` + `model`；两者皆缺省即关闭该功能）。session-controller 和本地 subagent 准入门在 `ctx.visionFallback.configured()` 为真时，为纯文本主模型放行带图请求；agent 循环在每次派发请求前调用 `ctx.visionFallback.rewriteMessages()`：目的地模型的 `inputModalities` 不含 `'image'` 时，图片块会被替换为由指定视觉模型一次性生成的描述文本。`read_image` 工具的路由门（[`@deepseek-ai/dsh-tool-fs`](../../fs/tool-fs)）同样在服务已配置时为纯文本路由放行，工具读入的图片因此走同一套替换。

每条生成的描述都会在主请求派发前以 `vision/describe` 事件追加进会话日志，因此改写后的请求可从日志完整重建，后续步骤会复用已记录的描述而不是重复描述。请求不变量调用 `replayMessages()`，缺少描述时拒绝重建而不调用模型。生成的持久事件词汇包含该事件，支持历史重新加载。

## 配置

- `maxOutputTokens` — 视觉调用的输出 token 上限。
- `timeoutMs` — 视觉调用的端到端超时（毫秒）。

## 模型体验

### 视觉描述替换

#### 模型看到的内容

纯文本主模型收到以 `【图片…】…【图片描述结束】` 包裹的描述文本，代替每个图片块。指定视觉模型对每张新图片收到一次辅助请求，系统提示为固定中文，要求忠实转录与版面描述。

#### Token 影响

每张新附件每个会话一次辅助视觉调用，加上此后每次主请求携带的描述文本。后续步骤回放已记录的 `vision/describe` 事件，不再重复描述。

#### KV Cache 影响

替换后的描述文本进入组装前缀；新描述或被改写图片集合的变化会从该 token 起打断缓存复用。

## 已知限制与后续工作

- 描述是整体替换的；除 `maxOutputTokens` 外没有按图片的大小上限。
- 视觉调用失败会让主请求以 `LlmError`（提供方错误码，或 `INVALID_REQUEST`）显式失败，而不是压成 `UNKNOWN` 或降级为占位文本。
- 模型页下拉框只列出 `inputModalities` 含 `'image'` 的目录行。不在该列表中的已存指定仍保持选中。手写 `settings.yaml` 仍可点名纯文本路由，且无论该路由宣称何种模态，`configured()` 都为真。
