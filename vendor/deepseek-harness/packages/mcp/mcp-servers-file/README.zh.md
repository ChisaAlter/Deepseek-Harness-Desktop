# @deepseek-ai/dsh-mcp-servers-file

[English](README.md) | 中文

负责 `$DSH_HOME/mcp-servers.yaml`（或显式 `path`），并为每条已启用记录挂载一个 [`@deepseek-ai/dsh-mcp-client`](../mcp-client/README.zh.md) 子实例。文档是带 `servers` 数组的 YAML 对象；每条记录有唯一的 `id`、`serverName`、`enabled`，以及与 mcp-client Config 对齐的 stdio（`command`、`args`、`env`、`cwd`）或 Streamable HTTP（`url`、`headers`）字段。写入走 atomic-write 锁；监视器在外部编辑后重新挂载子实例。`mcpServersFile` 服务提供 `listManaged`、`upsert`、`remove`、`setEnabled`、`remount` 与 `authorize`。`authorize` 在系统浏览器里跑 MCP HTTP OAuth（PKCE），把 `Authorization: Bearer …` 写进该记录并重新挂载，使子实例的工具对对话可用。`listManaged` 会掩码看起来像密钥的 env / header；upsert 里的空字符串或 `********` 会保留已存值。省略或空的 env/headers 映射会保留这些密钥键；显式新映射里不含某键则删除该键。

## 模型体验

无，因为本包只挂载已定义的 mcp-client 实例，自身不组装提示词、工具或提供方请求。

#### KV Cache 影响

无；本包从不组装模型输入。

## 已知限制与暂缓事项

- **不从 Cursor 或 Claude 的 `.mcp.json` 导入** — 文档格式留给后续导入器；本包只读自己的 YAML。
- **组成配置里的 mcp-client 行不写入此文件** — 手写的 `cordis.patch.yml` 实例不会被改写。
- **OAuth 访问令牌会过期** — 没有 refresh token 续期；服务器再返回 401 时从 Settings 重新登录。

不发布运行时 invariant companion；本包不拥有独立的持久事件关系，UI 或服务行为由聚焦的包测试覆盖。
