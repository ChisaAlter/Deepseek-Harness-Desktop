# Agent Note: 技能与 MCP 管理界面及模型输入类型

Status: implemented

[English](2026-08-16-skill-mcp-settings-and-model-input-types.md) | 中文

## 问题

Harness 拥有完整的技能与 MCP 能力，但两者都没有管理界面。技能只能经输入框 `/` 菜单按会话发现，用户看不到全量目录，也无法新建或编辑自己拥有的技能；MCP 服务器只能以静态组装的 `mcp-client` 行存在，新增服务器意味着改 `cordys.yml` 并重启，且完全没有状态或连通性反馈。另外，模型设置页无法声明模型接受什么输入：pi-ai 路由与模型 profile 在主机侧携带 `input` 模态（[路由默认输入 note](2026-08-12-pi-ai-route-default-input-modalities.md)），但编辑器只暴露 id/名称/容量/推理档位——第三方视觉网关可以配置，却无法在界面上把其模型标记为支持图像。

## 决策

三个已发布的界面，全部位于设置的浏览器侧，全部沿用既有的 slot/设置面模式：

1. **技能页**（`settings.section`，id `skills`，order 12）：新客户端包 `@deepseek-ai/dsh-client-ui-settings-skill`，由新主机服务 `@deepseek-ai/dsh-skill-admin`（ctx key `skillAdmin`）与 `skills` 域新增的四个 RPC（`catalog`、`read`、`save`、`remove`；错误码 `skill-admin-absent`／`skill-invalid-name`／`skill-invalid-input`／`skill-shadowed`／`skill-not-owned`／`skill-not-found`）支撑。`skill-admin` 扫描可写用户根（`$DSH_HOME/skills`）以及只读的 user-agents、项目与 bundled 根，而不依赖会话层注册表。写入后下一次读取立即可见、无需等待 watcher，web profile（其 preset 各自挂载 `skill-filesystem` provider）也能看到磁盘上的全部技能。扫描复用 provider 的 frontmatter 语法；只写出非默认的调用开关；保存拒绝已被其他来源占用的名称；编辑/删除以 `owned` 标记为门槛。非用户技能以来源徽章只读展示。

2. **MCP 服务页**（`settings.section`，id `mcp`，order 13）：新客户端包 `@deepseek-ai/dsh-client-ui-settings-mcp`，由新主机服务 `@deepseek-ai/dsh-mcp-manager`（ctx key `mcpManager`）与两个新 RPC（`mcp.describe`、`mcp.probe`；错误码 `mcp-manager-absent`）支撑。管理器持有 `mcp` 设置命名空间（以 `serverName` 为键的 profile，复用 `mcp-client` 导出的传输字段语法），并在每次设置提交后收敛实时受管连接集合——新增或变更的服务器连接（旧实例先释放）、删除的服务器断开并注销工具，全程无需重启。`mcp-client` 为其连接监督器新增状态观察（`McpConnectionState`：`connecting`／`connected`／`reconnecting`／`error`／`disposed`）与一次性 `probeMcpServer`（列出工具但不挂载任何东西）。管理器在应用根上建立连接，使工具注册落入全局工具层；坏服务器收敛到 `error` 状态，绝不让应用崩溃（`failOnStartupError` 不按服务器单独配置）。页面挂载期间每 3 秒轮询一次 `mcp.describe`。

3. **模型输入类型**（`@deepseek-ai/dsh-client-ui-settings-models`）：每个 pi-ai 模型行的高级折叠区新增「输入类型」复选框（文本/图像，规范顺序；全不选＝删除字段＝继承），pi-ai 路由编辑器新增「默认输入类型」复选框写入 `defaultInput`；显式清空的路由默认值会以内联错误阻止提交，与主机端拒绝一致。DeepSeek 模型不动（纯文本协议）。存为 `['image']` 即声明仅图像模型——界面不强制勾选文本。

web-app 组合新增 `skill-admin` 与 `mcp-manager` 两个主机行及两个客户端行；`mcp` 加入 `PRODUCT_SETTINGS_NAMESPACES`，使设置面可以服务它。仓库本地 surface 包（ui-preview、ui-files、ui-git、ui-agents-panel、ui-surfaces、ui-titlebar、ui-user-terminal、ui-diff）也补齐了每个客户端包都有的手写 `css-modules.d.ts` 声明——缺了它客户端类型检查无法通过；桌面仓根 .gitignore 隐藏 `src/*.d.ts`，因此这些文件被强制跟踪，与上游已跟踪的声明保持一致。

## 后果

设置平面如今覆盖了两个此前没有界面的能力：技能可以从界面创作与管理（遮蔽检查仍读全局注册表层；`list()` 同时扫描 user-agents、项目与 bundled 根并以只读展示），MCP 服务器可以实时管理并带状态与测试连接反馈。管理器直接使用 `startConnection`（而非 `ctx.plugin`）是有意为之：插件形态无法接收状态观察者，而插件 `serverName` 保留提供的重名防护已由管理器按字典键的挂载表保证。状态为拉取式（3 秒轮询）——尚无推送通道。音频等新模态等待 pi-ai 上游支持；`DiscoveredModelView` 仍不回报模态，因此拉取到的候选项不会预先声明输入类型。技能管理仍限于用户根目录；项目与 `~/.agents/skills` 技能在此只读。

## 测试

`skill-admin` 在临时 HOME 上做单元测试（save/read/list/remove、frontmatter 往返、遮蔽与所有权拒绝）；网关映射由 `api-proxy-skill-admin.spec.ts` 钉住；`mcp-client` 状态观察与 probe 针对 fixture 服务器做 e2e 测试；`mcp-manager` 有基于真实设置面的单元套件，外加一个 REAL Loader 组合测试（`loader-composition.spec.ts`）驱动 挂载 → 已连接工具 → 卸载；两个设置页与输入类型控件在 `test:gui` 下都有组件套件；`mcp`/`skills` 的线上契约由 apiproxy 套件覆盖。`pnpm run build`、`pnpm run test:gui` 与 host/client 的 `tsc -b` 均通过。
