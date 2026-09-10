# @deepseek-ai/dsh-host-mcp-servers

[English](README.md) | 中文

为 Settings 的 MCP 页提供 Host Remote `mcpServers`。`list` 把 [`dsh-mcp-servers-file`](../../mcp/mcp-servers-file/README.zh.md) 中的记录与 Loader 里模块名为 mcp-client 的存活行合并。受管行可写；组成配置行只读。`upsert`、`delete` 与 `setEnabled` 只写受管文档，并拒绝组成配置 id。`retry` 重新挂载一个受管子实例、不改文件，同样拒绝组成配置 id。`authorize` 为受管 HTTP id 跑 OAuth、写入 Bearer、重新挂载，并拒绝组成配置 id。已连接行的 `connection.tools` 列出注册在 `ctx.tools` 上的公开 `mcp__<serverName>__…` 名称。`list` 中的密钥已被文件服务掩码。

`test` 接受已有的受管或组成配置 id，建立一次隔离的 MCP 连接，至少完成 `initialize` 和分页 `tools/list`，返回传输类型、服务器名称、原始工具名、数量与耗时。它不会写受管文档、重新挂载子实例、占用存活的 `serverName` 或注册工具；取消与超时路径都有界，并关闭临时 stdio 或 HTTP 传输。

该服务仅供 Remote 使用，不声明同进程 Cordis `Context` merge。Client 包通过 [`api-remotes`](../../api/remotes/README.zh.md) 消费。

## 模型体验

无，因为这个 Host Remote 不注册提示词、工具、消息或提供方请求。

#### KV Cache 影响

无；本包从不组装模型输入。

## 已知限制与暂缓事项

- **不导入 Cursor/Claude 配置** — Settings 只写 `$DSH_HOME/mcp-servers.yaml`。

不发布运行时 invariant companion；本包不拥有独立的持久事件关系，UI 或服务行为由聚焦的包测试覆盖。
