# 调用链断接与保护回退审查

日期：2026-09-05。对象：`HEAD 38503276d3758149277125043fd198b0c4c4dc65` 加当前工作树；包含此前本地工作区恢复与插件归因修复。此次只读审查不修改产品代码，不代表 Windows 安装包或真实 API 验收。

## 结论

后续状态：本报告保留修复前证据；确认问题已实施源码修复，结果和未完成的验收边界见 [修复验证记录](request-consumer-fixes.md)。

存在与识图相似的功能回退。除已确认的识图断接外，`dsh-tools` 中已实现过的非法调用校验、历史投影修复及工具注册校验均未保留。客户端测试通过不能证明核心请求链健康；当前根 CI 没有执行这批核心回归测试。

## 确认的问题

### P1：识图设置保留，请求消费和图片准入断接

- `packages/llm/llm-vision-fallback/src/index.ts` 保留 `rewriteMessages`，全树生产 TypeScript 中没有调用者。
- `packages/core/agent-loop/src/agent.ts:537` 直接传递 `boundaryMessages`。
- `packages/api/session-controller/src/commands.ts:342` 拒绝不支持图片的主模型，不检查已配置的识图回退。
- `packages/fs/tool-fs/src/read-image.ts:129` 同样直接拒绝纯文本模型。
- 证据：`read-image.spec.ts` 中 `admits a text-only route when a configured vision fallback is mounted` 失败；本机 0.2.8 runtime 的对应构建产物也已核对。
- 影响：选择识图模型不能使纯文本主模型处理上传图片或工具读取的图片。重新填写密钥不能恢复缺失的调用。

### P1：非法工具调用保护整体回退

产品契约：[dsh-tools](../../../features/dsh-tools.md)。历史实现参照提交 `cac4f790439`；该提交中的 `requireValidToolCallIdentity`、历史投影归一化、`TOOL_NAME_PATTERN` 注册校验在当前路径中均已消失。

1. **入站解析和消息组装不拒绝非法已完成调用。** `packages/llm/llm-deepseek/src/translate.ts:76` 把缺少的 ID/名称补成空字符串；`packages/llm/llm/src/assembler.ts:112` 也允许空名称。现有 translator 测试有 6 条确定失败，覆盖空名称、空 ID、带空格名称、超过 64 字符名称、缺少 function 等情况。源代码探针直接组装出 `[{"type":"tool-call","id":"","name":"","arguments":"{}"}]`。
2. **历史投影修复缺失。** `packages/core/session/src/index.ts:809` 原样返回已派生消息；`packages/llm/llm-deepseek/src/serialize.ts:214` 把工具名原样写进请求。内存探针创建含空 ID/名称的会话，再从其事件快照重建；`live` 和 `reloaded` 投影均仍携带空 ID/名称。该探针没有改写用户会话。
3. **插件工具注册也失去名称限制。** `packages/core/tools/src/index.ts:1028` 不再执行名称语法校验。真实 `Context + SystemPrompt + ToolRuntime` 探针注册 `bad name` 成功，且 `tools.schemas()` 返回该名称；探针随后解除注册并释放所创建的服务。

影响：坏调用可能被执行为未知工具并写入历史；后续请求可能被模型服务拒绝。插件声明非法名称也可能使发给模型的工具列表不合法。未用真实服务请求验证具体 HTTP 错误，不能把这项直接等同于用户反馈的所有插件崩溃。

### P1：发布检查没有覆盖上述核心保护

- 根 `.github/workflows/test.yml:29` 运行桌面 `npm test`；`:51` 运行 vendor `test:gui`。
- vendor 的 `test:gui` 仅匹配 `packages/client` 与 `packages/host`，不执行 `packages/core`、`packages/llm`、`packages/fs` 或 `packages/api` 的相关回归。
- `src/shared/harness-desktop-forks.js` 检查识图包、composition 行及文件片段，未检查识图的主循环调用和准入行为，也未守住 `dsh-tools` 的行为测试。
- 本轮 GUI 测试全绿，但核心测试同时出现确定回归。因此上述检查不能作为这些功能正常的证据。

## 执行记录

| 检查 | 结果 | 解释 |
| --- | --- | --- |
| 根 `npm test` | 1492 通过、1 失败、2 跳过 | 唯一失败是本机无法解析 `electron-builder/package.json`，属依赖安装/解析环境问题，不据此判定已发布安装包损坏 |
| `vitest run packages/client packages/host --maxWorkers 4` | 411 文件；5335 通过、1 跳过 | 含模型/MCP/技能设置、市场、文件/Diff/预览、终端、消息编辑、工作区与渲染组件；没有真实桌面端到端验收 |
| 核心链定向集合，见下方命令 | 147 文件；3020 通过、12 失败、1 跳过 | 6 个非法工具调用失败、1 个识图失败、4 个冷历史测试初始化失败、1 个旧缓存超时 |
| 失败相关套件单 worker 复核 | 55 通过、10 失败 | 6 个非法调用和4个冷历史初始化失败保持；旧缓存 fixture 6 项均通过 |
| 内存源代码探针 | 已确认三项行为 | 非法调用组装成功、非法调用在重载投影保留、非法工具名注册成功 |

核心集合命令（在 `vendor/deepseek-harness` 执行）：

```powershell
pnpm exec vitest run packages/core/agent-loop packages/core/session packages/core/tools packages/llm packages/api/session-controller packages/api/workspace-controller packages/fs/tool-fs packages/workspace packages/session/session-projection-cache --maxWorkers 4
pnpm exec vitest run packages/session/session-projection-cache/tests/fixtures.spec.ts packages/llm/llm-deepseek/tests/translate.spec.ts packages/api/session-controller/tests/session-cold.host.spec.ts --maxWorkers 1
```

本机完整输出保存在 `%TEMP%/dshd-audit-desktop-tests-20260905.log`、`dshd-audit-gui-tests-20260905.log`、`dshd-audit-core-tests-20260905.log`、`dshd-audit-recheck-20260905.log`。

## 不应误报为产品故障的结果

- 冷历史 `session-cold.host.spec.ts` 的 4 条失败均停在 `SessionLifecycle` 读取未提供的 `ctx.agents.create`；测试没有进入其声称覆盖的历史列表/恢复行为。生产控制器声明了 Agent 服务依赖。这是需要修复的测试有效性缺口，不能据此宣称用户历史一定无法读取。
- 旧缓存 v3 fixture 在并行首轮超过 5 秒，单 worker 重跑通过。本轮没有确认该用例存在新的功能回归。
- GUI 输出里的 `inject boom`、缺失 scope 等部分错误来自故意造障用例；最终结果全绿，不能把这些输出直接当产品错误。
- 远程功能停放、dshbot 取消桌面预置属于明确产品决策/现有用户改动，不列为断接回归。

## 范围与未验证项

已对照特性卡、关键桌面 fork 注册、调用者和历史实现，并运行跨客户端、Host、桌面壳、会话、模型与工具的测试。此审查不是全仓每条代码路径的证明。

未执行：真实模型/识图 API、第三方插件逐个安装、用户实际历史数据包、Windows 候选安装包升级、完整浏览器/Electron 交互验收。既有只测 mock 的组件测试仍可能遗漏生产组装问题。

修复顺序建议：恢复识图端到端准入与调用；恢复工具完整性三层保护和对应失败测试；修复冷历史夹具并把关键核心集合纳入 CI；最后对同一构建产物做升级与真实 API 验收。不能仅以 GUI 或包存在性检查宣告这些问题修复。
