# Agent Note: MCP and Skill settings management

Status: implemented

[English](2026-08-14-mcp-and-skill-settings.md) | 中文

## Problem

Harness 已经能通过 `dsh-mcp-client` 连接 MCP 服务器、通过 `dsh-skill-filesystem` 发现技能，但两份目录都没有 Settings 管理页。用户只能手改 `cordis.patch.yml` 或技能文件。桌面端也不该另做一份持久化：这些目录属于 `$DSH_HOME`，CLI 与 Web 必须共用。

## Decision

Settings 增加两个栏目：`skills`（order 16）和 `mcp`（order 18）。两者都不写用户的 `cordis.patch.yml`。桌面端只通过已有的 `openHarnessSettings('mcp'|'skills')` 菜单跳转。

MCP 持久化是 `$DSH_HOME/mcp-servers.yaml`，由挂在 base bundle 上的 `@deepseek-ai/dsh-mcp-servers-file` 拥有。文件插件为每条已启用记录挂载一个 `dsh-mcp-client` 子实例，并在写入或监视时 reconcile。`@deepseek-ai/dsh-host-mcp-servers` 发布 Typert Remote `mcpServers`（`list` / `upsert` / `delete` / `setEnabled` / `retry` / `authorize`）。`list` 合并受管行与 Loader 里存活的 mcp-client 实例。组成配置行只读（`origin: 'composition'`）。`retry` 重新挂载一个受管子实例，不改文件。`authorize` 在系统浏览器里跑 MCP HTTP OAuth，把 `Authorization` 写进该受管记录并重新挂载，使子实例的工具对对话可用。看起来像密钥的 env / header 在 list 时掩码，受管行与组成配置行一视同仁；upsert 里空字符串或 `********` 的值保留已存密钥。省略或空的 env / headers 映射会保留先前的密钥键并丢掉非密钥键；显式新映射不含某键则删除该键。

技能启停仍写已有 SKILL.md frontmatter：`disable-model-invocation` 与 `user-invocable`。`@deepseek-ai/dsh-host-skill-inventory` 发布 Typert Remote `skillInventory`（`list` / `get` / `create` / `update` / `delete` / `setInvocation`）。每个方法都接受可选的 `cwd` 与 `sessionId`；提供 `sessionId` 时只读解析该精确存活 Agent 并读取其分层 `ctx.skills` 视图，不会创建或恢复 Agent，缺少存活 Agent 时抛出类型化的 `session-not-found`。`list` 不过滤 composer 的 `isUserInvocable`。可写根是 `user-dsh`、`user-agents`，以及当前 session 提供 `cwd` 时的 `project-dsh` / `project-agents`。项目技能创建写入 `<project-root>/.dsh/skills/...`，其中 `project-root` 是 `cwd` 最近的 `.git` 祖先。bundled、runtime 与 custom skill 只读。创建会明确选择用户根或当前项目根，并写入调用方给出的初始 invocation 开关。更新正文或只改调用开关都会保留 Settings 不拥有的 frontmatter 字段；删除会移除整个技能目录。目录会跟随当前 session 的 `sessionId`/`cwd` 变化，并拒绝上一个 session 的迟到响应；客户端按 session 记住最近一次 `cwd`，sessions 存储重建的闪烁不会把请求静默改划到无项目视图。composer 的 `skill.list` 不变。`mcpServers/*` 与 `skillInventory/*` 的读写仅限 loopback；`trustedHosts` 仍是 DNS-rebinding 围栏，不是认证。

`@deepseek-ai/dsh-client-ui-settings-mcp` 与 `@deepseek-ai/dsh-client-ui-settings-skills` 注册 Settings 页。两页采用同一套紧凑管理语言：搜索、一个来源或启用筛选、结果计数、发丝行、来源 `Pill`、保留原生语义的共享 `Switch`、就地错误和图标动作。MCP 把受管行与只读组成配置行分开，并把配置启用状态与 Host `fiberPhase` 分开；没有观察到阶段的行采用中性文字，不显示警告色。MCP 编辑弹窗在表单与 JSON 对象之间切换。技能行显示模型调用 `Switch` 并打开现有编辑器；只读行没有删除。

## Alternatives considered

**把 MCP 行写进用户的 `cordis.patch.yml`。** 否决，因为该文件可能含 `!!js` 和其他手写组成，Settings 不能变成 YAML 编辑器。

**在 frontmatter 之外再做一份技能启用清单。** 否决，因为 `dsh-skill-filesystem` 已经拥有调用开关；第二份清单会与监视器已在重载的文件漂移。

**用桌面 `window.shell` API 管这些目录。** 否决，因为持久化属于 `$DSH_HOME`，Settings 已在 Harness Web UI 里。桌面端只需要 About / Plugins 已经在用的栏目跳转。

**v1 导入 Cursor 或 Claude 的 `.mcp.json`。** 否决。受管 YAML 留给后续导入器；v1 只读写自己的文档。

## Consequences

文件插件挂在 base bundle 上，因此 CLI 与 Web 共用同一份 MCP 目录。手写的 mcp-client 行继续连接，并在 Settings 里显示为只读组成配置。技能 create/update/delete/setInvocation 在写入成功后使所视图 `SkillRegistry` 的目录缓存失效，Settings（以及任何读同一注册表的消费者）在下一次 list 即可看到变化；文件系统监视器从此只负责外部编辑。没有市场、没有连接测试按钮：行通过 `mcp-client` 状态注册表上报实时连接健康（`connecting` / `connected` / `reconnecting` / `failed`，附最近一次尝试的错误，在行上可见，以 `connection` 字段同时出现在受管行与组成配置行上），仅当没有 mcp-client 实例上报时才回退显示 `fiberPhase`。任一行处于连接中或重连中时，Settings 轮询 `list`。刷新会重新挂载连接监督器已放弃的受管子实例，然后再次 list。也不改 `$` token 或 composer 选择器。

## Testing

Host 套件覆盖 YAML CRUD、非法 `serverName`、重复 id、组成配置拒绝写入、受管 remount 不改写 YAML、技能 kebab-case、只读根、调用方选择的 invocation 初值、未知 frontmatter 往返、目录删除、存活 Agent 的 `sessionId` 解析与 `session-not-found`。Client 测试覆盖搜索/筛选、扁平行、表单/JSON 编辑器、校验、乐观且防重复的 Switch、操作就地失败、在途健康轮询、刷新重新挂载已放弃的受管行、可见的最近一次尝试错误、用户/项目创建作用域、响应式 session/`cwd` 变化与迟到响应抑制。Connection 测试通过 trusted-host 与 loopback 请求逐项验证全部 MCP/Skill 斜杠端点。组装后的 Web e2e 会在存活的 standard-preset session 与临时 bundled fixture 上打开两个 Settings 页；它不保存、切换或删除 MCP 行，也不启动 stdio 进程。

## Related

[MCP Settings 轮询健康并重新挂载已放弃的子实例](../bug-fix/2026-08-20-mcp-settings-stale-health.zh.md)。
[MCP Settings 为 HTTP 服务器登录](2026-08-20-mcp-settings-oauth.zh.md)。
