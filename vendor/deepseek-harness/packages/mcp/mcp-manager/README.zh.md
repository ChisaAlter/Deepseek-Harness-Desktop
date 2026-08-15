# @deepseek-ai/dsh-mcp-manager

[English](README.md) | 中文

设置驱动的 MCP 服务器管理器：为 `mcp` 设置命名空间中配置的每个服务器保持一条 [`@deepseek-ai/dsh-mcp-client`](../mcp-client) 实时连接，暴露每台服务器的连接状态，并应答一次性探测。

`mcp` 设置段是唯一事实来源。每次写入提交都会在无需重启的情况下收敛实时挂载集合：新增或变更的服务器会连接（旧实例先被释放），删除的服务器会断开并注销其工具。无法启动的服务器绝不会让应用崩溃——其受管连接会收敛到 `error` 状态，由管理界面呈现。

## 服务：`McpManagerService`（ctx key：`mcpManager`）

### 公开 API

- `ctx.mcpManager.describe()` 为每台实时服务器返回一行状态（`serverName`、`transport`，以及最新受管连接状态：`connecting`、`connected`、`reconnecting`、`error` 或 `disposed`）。
- `ctx.mcpManager.probe(input)` 对草稿服务器配置做一次性连接、列出其工具并关闭——不挂载任何东西、不注册任何工具、不占用 `serverName` 命名空间。

### 设置命名空间：`mcp`

| 字段 | 默认 | 含义 |
|---|---|---|
| `servers` | `{}` | 以 `serverName`（`[A-Za-z0-9_-]{1,32}`）为键的服务器配置；每个配置是一个 stdio（`command`/`args`/`env`/`cwd`）或 Streamable HTTP（`url`/`headers`）传输，外加 `toolCallTimeoutMs` 与 `reconnect`。 |

schema 复用 `mcp-client` 的传输字段语法，因此在此受管的服务器与静态配置的 `mcp-client` 实例行为完全一致。非法的 `serverName` 键在写入处即被拒绝。

## 模型体验

受管服务器以与静态 `mcp-client` 实例相同的 `mcp__<serverName>__<rawName>` 名称向全局工具注册表注册工具，会话经普通工具目录使用它们；状态与探测属于配置平面操作，不触达模型。

## 已知限制与延后工作

- 受管服务器位于主机平面（全局工具层），不按会话或 agent preset 划分。
- 每台受管服务器不可单独配置 `failOnStartupError`：失败的服务器总是以 `error` 状态呈现，而不是让启动失败。
