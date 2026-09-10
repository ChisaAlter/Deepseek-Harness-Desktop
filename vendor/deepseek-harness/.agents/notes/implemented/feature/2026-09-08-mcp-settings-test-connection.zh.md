# Agent Note: MCP Settings 连接测试

Status: implemented

[English](2026-09-08-mcp-settings-test-connection.md) | 中文

## Problem

MCP Settings 已显示实时健康状态并提供会重新挂载的 `retry`，但没有一种操作可以在不改变文档或存活 `mcp-client` 子实例的前提下测试已有的受管配置。重新挂载再读取健康状态无法证明新的 initialize 与工具发现真正成功。

## Decision

Host Remote `mcpServers.test({ id })` 从文件服务的原始记录或已有的只读组成配置行解析目标，然后创建私有 MCP SDK client 与 transport。探测完成 initialize 和所有分页的 `tools/list` 后返回服务器名称、传输类型、原始工具名、数量与耗时，并在返回前关闭临时 client/transport。Remote 取消信号与十秒超时组成有界信号，关闭操作另有独立上限。探测绝不调用 `remount`、写受管文档、创建 Loader 子实例、占用存活的 `serverName` 或触碰 `ctx.tools`。

MCP Settings 的受管行与组成配置行都直接调用该 Remote，显示一个防重复的「测试」操作、简短成功摘要或 Remote 错误。现有重试、OAuth、编辑、删除与启用路径保持分离。这部分局部取代早期 MCP Settings 记录中「没有连接测试按钮」的表述；其目录归属和实时健康决策仍然有效。

## Alternatives considered

**重新挂载存活子实例，再读取 `list`。** 否决，因为它会改变生命周期，不提供一次新连接的独立证据，并可能与存活工具注册冲突。

**复用存活的 `mcp-client` supervisor。** 否决，因为它拥有已注册工具世代与 `serverName` 占用；Settings 需要可销毁且无副作用的探测。

## Consequences

Settings 可以在不改变 MCP 配置或模型可见工具的前提下报告真实的 initialize 与工具发现失败。组成配置行也可测试，因为探测只消费其解析后的配置，不接管 Loader 子实例。stdio 子进程与 Streamable HTTP 传输在成功、失败、取消与超时路径都会关闭。

## Testing

聚焦 Host 测试覆盖 stdio 与 HTTP 成功、分页发现、连接失败、超时清理和取消清理。Gateway 测试证明受管与组成配置解析不会重新挂载、修改文档或注册工具。Client 测试覆盖 pending 防重复、成功工具摘要与错误展示，同时保留重试行为。Typert 生成后 Host 与 Client TypeScript 检查均通过。

## Related

[MCP 与 Skill Settings 管理](2026-08-14-mcp-and-skill-settings.zh.md)。
[MCP Settings 为 HTTP 服务器登录](2026-08-20-mcp-settings-oauth.zh.md)。
