# Agent Note: MCP Settings 轮询健康并重新挂载已放弃的子实例

Status: implemented

[English](2026-08-20-mcp-settings-stale-health.md) | 中文

## Problem

Settings 的 MCP 页用一次性 `mcpServers.list` 快照列出服务器。`dsh-mcp-client` 的重连监督器耗尽尝试次数后，`connection.health` 会一直停在 `failed`，直到子 fiber 被 dispose。刷新只是再 list 一次，所以每条已放弃的行都停在「连接失败」。最近一次尝试的错误只在 tooltip 里，HTTP 401 看起来像管理页本身坏了。

## Decision

`mcpServersFile.remount(id)` 会 dispose 并重新挂载一个受管子实例，不改写 `$DSH_HOME/mcp-servers.yaml`。Host Remote `mcpServers.retry` 仅限 loopback，并拒绝组成配置 id。Settings 页在任一行处于 `connecting` 或 `reconnecting` 时每 2 秒轮询 `list`，在行上显示 `connection.lastError`，刷新会先重新挂载健康为 `failed` 的受管行，再 list。

## Alternatives considered

**对已连接的空闲目录也轮询。** 否决：已连接的健康是稳定的；定时器只属于在途行。

**用启用开关当重试。** 否决：那会改写 `enabled`，还要两次操作；监督器写明从耗尽恢复的唯一路径是 disposal，remount 就是这条路径。

**用 SSE 推送连接健康。** 否决：`list` 已经是快照；行在途时 2 秒轮询足够。

**继续把 `lastError` 只放在 tooltip。** 否决：凭证或 spawn 失败会被读成 Settings 的 bug。

## Consequences

刷新可以在不重启 Host 的情况下恢复已放弃的受管子实例。仍然返回 401 的 HTTP 服务器还是显示「连接失败」，但会带上错误文本。组成配置行仍只读，不会被 remount。目录归属仍在 [MCP 与 Skill 设置管理](../feature/2026-08-14-mcp-and-skill-settings.zh.md)。HTTP OAuth 登录见 [MCP Settings 为 HTTP 服务器登录](../feature/2026-08-20-mcp-settings-oauth.zh.md)。

## Testing

`mcp-servers-file` 会在不改写 YAML 的情况下 remount 已启用子实例，并拒绝未知 id。Host gateway 发布 `retry`、remount 受管 id，并拒绝组成配置 id。Client 测试钉住可见的 `lastError`、connecting→connected 轮询，以及刷新对失败受管行只调用一次 `retry`。Connection 允许列表包含 `mcpServers/retry`。
