# DSH(DeepSeek Harness)上游契约 —— ChisaCode 集成参考

> 验证日期:2026-08-21 · 验证版本:`@deepseek-ai/dsh@0.1.1-rc.1` + `@deepseek-ai/dsh-acp-demo@0.1.1-rc.1`(npm 全局,Windows 11,Node v24.15.0)
> 验证方式:ChisaCode 本地实机 —— 全局安装、`dsh --version`、直接 boot、以及基于 `@agentclientprotocol/sdk@0.17.1`(仓库自带版本)的字节级 ACP 探针(`tmp/dsh-contract/probe.mjs`,不入仓)。
> 本文档是「DSH 完全支持」计划的模块 0 硬门禁产物。实现参数以此为准;上游发新版后须复验并更新版本横幅。

## 1. 身份与分发

| 项         | 事实                                                                                        |
| ---------- | ------------------------------------------------------------------------------------------- |
| 官方仓库   | `github.com/deepseek-ai/deepseek-harness`(MIT;Cordis 插件架构,"Everything is a Plugin")     |
| 主包       | `@deepseek-ai/dsh`(bin `dsh`:profile 启动 / plugin 管理 / `web` 别名)                       |
| ACP 传输包 | `@deepseek-ai/dsh-acp-demo`(bin `dsh-acp-demo`,agent spine + JSONL 持久化 + ACP 桥的组合体) |
| **无**     | 独立可执行文件、PyPI/cargo 包(npm `dsh`@1.0.1 与 `deepseek-harness` 占位包均**非官方**)     |
| 当前版本   | 0.1.1 处于 rc(约 2 天一个 rc;README 明确声明会发生 breaking changes)                        |
| Node 要求  | 上游仓库 `engines`: `^22.19.0 \|\| >=24.0.0`(npm 包未带 engines 字段)                       |

**dist-tag 陷阱(必须 pin 精确版本)**:`@deepseek-ai/dsh` 的 `latest`=`next`=0.1.1-rc.1;但 `@deepseek-ai/dsh-acp-demo` 的 `latest`=**0.0.1-rc.1**(陈旧),`next`=0.1.1-rc.1。装 ACP 传输必须写 `@deepseek-ai/dsh-acp-demo@next` 或精确版本,裸 `@latest` 会装到过期版本。

**Windows shim(实机已验证)**:`%APPDATA%\npm\` 下生成 `dsh.cmd/ps1`、`dsh-acp-demo.cmd/ps1`。`dsh --version` 输出裸 semver 一行(实测 `0.1.1-rc.1`);源码为 commander `-V/--version`。

## 2. ACP 入口(与旧假设不同)

**没有 `dsh acp` 子命令。** ACP stdio 服务为:

```
dsh-acp-demo --config <cordis.yml>    # 默认 ./cordis.yml
```

- stdout 只载 JSON-RPC 帧(组合体禁一切 stdout logger/HMR);诊断只走 stderr;stdin EOF → dispose 退出(bin 内置,实机验证 EXIT=0)。
- `dsh-acp-demo` 的 cordis `Config` 必填:`provider`(路由名,如 `deepseek-official`)、`model`(精确模型 id)、`workspaceContext`(`false` 或对象)。**模型/路由钉死在配置里 → ChisaCode 的模型注入 = 每次 spawn 前写受管 cordis.yml(kimi 式受管 home 的同款职责)**。
- `loadEnv(NAME)` 会读 cwd 的 `.env`;`DSH_SNAPSHOT` 环境变量有 rewind 语义,ChisaCode 不得透传。

### 2.1 插件解析坑(实机踩出,最高风险项)

cordis-plugin-loader 对裸包名(`@deepseek-ai/...`)做 **Node ESM 自身链解析**(从 loader 文件所在包向上找 `node_modules`)。而 `dsh-llm-deepseek` / `dsh-sandbox-local` / `dsh-bash-sandbox` / `dsh-subprocess-local` / `dsh-token-meter` / `dsh-compaction-basic` 等实现插件**只 vendored 在 `@deepseek-ai/dsh` 包自己的 node_modules 里**,`dsh-acp-demo` 树只有 spine 泛型件。裸名引用即报 `ERR_MODULE_NOT_FOUND`(带完整链,实机日志已留证)。

**已验证可用的解法**:cordis.yml 的 `name` 用绝对 `file:///...` URL 直指 `@deepseek-ai/dsh` 包内嵌树(同属一棵 vendored 树,天然同单例);`@deepseek-ai/dsh-acp-demo` 保持裸名(全局顶层可解析)。boot 实机 EXIT=0、无 stderr。

**后果(写进 provider 定义)**:dsh provider 的运行时要求是**两个全局包**:`@deepseek-ai/dsh` + `@deepseek-ai/dsh-acp-demo@next`。daemon 在准备受管配置时以运行时探测定位 npm 全局根与内嵌路径(不用静态假设)。

## 3. ACP 协议面(实机字节级证据)

ChisaCode ACP SDK 0.17.1(protocolVersion 1)与上游 SDK 0.25.1 **互通正常**。

`initialize` 实测返回(verbatim):

```json
{
  "protocolVersion": 1,
  "agentInfo": { "name": "deepseek-harness-acp", "version": "0.0.1" },
  "agentCapabilities": {
    "promptCapabilities": { "image": false, "audio": false, "embeddedContext": false }
  },
  "authMethods": []
}
```

`session/new`(abs `cwd`,空 `mcpServers`)实测返回(verbatim):

```json
{ "sessionId": "80f1bc28-8e73-4898-9db0-f264d8f67ba2" }
```

### 刻意收窄的 automation-only 面(上游设计文档明示)

- **无** `availableModels` / `modes` / `configOptions` / `session/load` / fork / `fs` / `terminal` / ACP 侧 MCP 客户端。
- `session/update` 只发 `agent_message_chunk`,且是**成块提交**(无 token 级增量);推理与工具细节留在其 session log,不进 ACP。
- `session/prompt`:文本 + 光栅图(image 能力需 attachment store + 宣称图像输入的路由,默认 composition 未挂载 → 实测 `image:false`);空 prompt/音频/内嵌资源拒收。
- `session/cancel`:正常→`end_turn`(含 token 满与 hook 中止),显式取消→`cancelled`;unknown id 为 no-op。
- `session/request_permission`:一次性 allow/reject(当组合挂了沙箱+approval 时触发 → 映到 ChisaCode 权限提示)。
- 同连接多并发 session 支持(上游文档宣称;**未实测**,列入模块 5 核验)。
- 单 session 同时仅一个在飞 prompt(重叠即拒)。

### 数字 id shim 关系

`COMPAT(deepseek-tui-acp-id)(ndjson-stream.ts:26)`是为**社区项目 Hmbown/DeepSeek-TUI**(现更名 CodeWhale)写的;官方 dsh 用官方 ACP SDK typed id,**无此 quirk**。shim 与 dsh 无关,维持原 EOL(2026-11-19)不动;dsh 的成功握手(上图即为未归一化条件下的 typed id)即证据。

## 4. 鉴权与上游端点

- **DeepSeek 官方路由 = API key only**:`DEEPSEEK_API_KEY`(env 或 `$DSH_HOME/.credentials.yaml`,后者由 `dsh web` 的 Models 页写入);可选 `DEEPSEEK_BASE_URL` 覆盖(默认 `https://api.deepseek.com`,走 chat completions)。AC`authenticate` 是空 no-op,无账号 OAuth(上游另有 pi-ai 系 OAuth 适配,但与 deepseek-official 路由无关)。
- 缺 key 实测(verbatim):`session/prompt` 返回 JSON-RPC `{"code":-32603,"message":"Internal error: turn failed: llm-deepseek: no API key for provider route \"deepseek-official\"; store DEEPSEEK_API_KEY through the credentials service (the web Models page writes it), or export DEEPSEEK_API_KEY in the launching environment"}` → **daemon 探测应前置检查 `DEEPSEEK_API_KEY` 存在性,按仓库惯例给中文可操作文案**,不依赖跑挂后的英文报错。
- 请求头部还带 `x-deepseek-harness-user-id` / `x-deepseek-harness-session-id` 与 harness UA(网关分析者须知)。

## 5. 模型与思考档(0.1.1-rc.1)

`deepseek-official` 路由默认目录(Adapter 声明式白名单,未列 id 也可透传):

| 模型 id                        | 备注                                                                    |
| ------------------------------ | ----------------------------------------------------------------------- |
| `deepseek-v4-flash`            | 通用                                                                    |
| `deepseek-v4-pro`              | 旗舰(参照组合默认值)                                                    |
| `deepseek-v4-flash-vision-exp` | `inputModalities: [text, image]`(需挂 attachment store 才在 ACP 侧可用) |

- 上下文窗 1M;请求 max_tokens 上限 256K(adapter 默认;API 页面宣称 384K)。
- 思考:默认开;档 `off | low | high | max`(adapter `reasoningEffort`,组合默认 `high`,参照组合样例为 `max`;`off` = `thinking.disabled` 硬锁)。
- 工具调用三模全支持;FIM beta 仅非思考模式下的 flash/pro。
- 旧 id `deepseek-chat` / `deepseek-reasoner` 已不在价目页(上游 API 端点层面另行兼容与否**未核验**)。

## 6. ChisaCode 受管 cordis.yml 设计基线

参照上游 `examples/acp-agent/cordis.yml`,裁剪为 daemon 生成:

```yaml
- id: llm-deepseek
  name: "file:///<npm-global-root>/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-llm-deepseek/lib/index.js"
  config:
    thinking: enabled
    reasoningEffort: <thinkingId 映射> # 由选定模型条目的 thinkingOptions 决定
    models: [{ id: <selectedModel> }]

- id: sandbox
  name: "file:///<nested>/dsh-sandbox-local/lib/index.js"
- id: sandbox-policy
  name: "file:///<nested>/dsh-sandbox-policy/lib/index.js" # workspace-write,cwd 注入
- id: subprocess
  name: "file:///<nested>/dsh-subprocess-local/lib/index.js"
- id: bash
  name: "file:///<nested>/dsh-bash-sandbox/lib/index.js"
- id: approval
  name: "file:///<deepseek-acp-demo tree or dsh nested>/dsh-user-approval/lib/index.js" # ask → ACP 权限提示

- id: fs-sandbox
  name: "file:///<nested>/dsh-fs-sandbox/lib/index.js" # 与 bash 同一沙箱策略的读/写/编辑
- id: fs-observation-policy
  name: "file:///<nested>/dsh-fs-observation-policy/lib/index.js" # read-before-edit
- id: tool-fs
  name: "file:///<nested>/dsh-tool-fs/lib/index.js"

- id: token-meter
  name: "file:///<nested>/dsh-token-meter/lib/index.js" # compaction 的量压前置
- id: compaction-basic
  name: "file:///<nested>/dsh-compaction-basic/lib/index.js" # 0.8/0.08;无它长会话必然顶爆窗口 → 算降级
- id: repeat-tool-reminder
  name: "file:///<nested>/dsh-repeat-tool-reminder/lib/index.js" # 防死循环提示(阈值 [3,5,8],只提示不阻断)

- id: acp-agent
  name: "@deepseek-ai/dsh-acp-demo"
  config:
    provider: deepseek-official
    model: <selectedModel>
    persistenceRoot: <受管 provider-runtime 目录> # 防污染用户仓库(上游默认 ./.sessions)
    workspaceContext: false
    persona: |
      You are a coding assistant powered by the {{model}} model. Your working directory is {{cwd}}.
      Your bash tool runs under a file sandbox; a [sandbox: file access denied] result is policy, not a command bug.
```

- v1 明确**不挂**:subagent 三件套、workflow、hooks-claude-code/hooks-codex、attachment store(→ ACP image 先保持 false,视觉模型先不进 manifest;记录在案)。
  > 上述取舍若被否,需在模块 2 对抗评审时改;当前基线 = 上游参照组合去代理编排件后的完整工具/沙箱/压实链,12 个插件包均已实测存在于 `@deepseek-ai/dsh` 内嵌树。
- 切模型 = 重写 cordis.yml 后 respawn(上游无运行时切模型通道)。
- 网关面孔(deepseek 等 gateway→dsh face)经 env:`DEEPSEEK_API_KEY=<token>`、`DEEPSEEK_BASE_URL=<chisacode 网关路由>/v1`,受管 cordis.yml 写网关模型清单;ChisaCode 注入 env 优先,上游 `.credentials.yaml` 不读写。

## 7. 已知未核验项(诚实清单)

1. 多 session 并发与同 session 单在飞 prompt 的实机行为(模块 5 核)。
2. 带 `DEEPSEEK_API_KEY` 的完整 prompt 往返 + 权限提示链路终态(本地无 key;模块 5 real e2e 核,届时由用户提供 key 或标注未验证)。
3. `PROTOCOL_VERSION` 常量数值与 sdk@0.25.1 的内部差异(实机握手已通,仅记录)。
4. `dsh-acp-demo` 长期契约:它是 examples 级包(上游亦称 demo)且全域 rc 期 breaking-changes 声明有效;发行说明须带版本钉与复验节奏。
5. Windows ACL 沙箱(`dsh-sandbox-windows-acl`)在本裁剪组合未挂载下的行为与性能(模块 5 桌面实机核)。

## 8. 对原计划的参数修订

| 计划假设                                      | 契约结论                                                                                    | 处置                                                                                                       |
| --------------------------------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| 命令 `dsh acp`(或历史 `deepseek serve --acp`) | `dsh-acp-demo --config <managed cordis.yml>`                                                | 模块 2 `resolveDshCommand` 默认 argv 据此;命令 override 语义照 kimi(replace/append 注入于 `--config` 之前) |
| 受管 TOML(可能)                               | 受管 cordis.yml(确定)+ 文件 URL 插件名 + 双包强依赖                                         | 模块 2 写 yml 生成器(复用 kimi 0600/转义纪律)                                                              |
| provider id `dsh`                             | 维持(agentInfo.name 为 `deepseek-harness-acp`,显示 label 取 "DeepSeek Harness",id 仍 `dsh`) | 不变                                                                                                       |
| manifest modes                                | `defaultModeId: null`(automation-only 无模式概念先行;若 UI 必需再打最小模式桩)              | 模块 1 定稿                                                                                                |
| 思考档                                        | `off/low/high/max`,默认 `high`                                                              | ProviderProfileModel thinkingOptions 在网关面与 manifest 模型目录共用                                      |

## 9. 模块 5 实机踩坑实录(2026-08-22)

- **persistence 单写者锁(已修)**:ChisaCode 会并发拉起多个 `dsh-acp-demo` 进程(home scope 探测 + per-cwd 探测 + 会话)。上游 `dsh-acp-demo` 组合在 `persistenceRoot` 下写 SQLite 查询索引(`session-query.db`、JSONL 包),`same-path` 并发 boot 直接 `ERR_SQLITE_ERROR code=5 database is locked`,child exit(1),ACP initialize 收不到响应 → 超时。受管 cordis.yml 因此把 `persistenceRoot` 写成 `!!js String.raw`<home>/sessions\p${process.pid}``(pid 隔离;YAML 约束:!!js 值不允许"引号标量 + 尾部操作数"的混形,须以标识符起头)。
- **静默超时无证据(已修)**:原 `process-runtime.ts` 的 initialize 超时不带子进程 stderr 与存活态,排错全靠猜。现错误消息带 `(child exited(1)) | child stderr: …` 尾部证据,诊断价值大(此修复随后进入主分支)。
- **`dsh-acp-demo --version` 不存在**:tooling 的版本探测用 `dsh --version`(dsh-acp-demo 没有 version arg,会抛 ERR_PARSE_ARGS_UNKNOWN_OPTION)。
