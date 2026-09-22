# Agent Note: MCP 工具注册改用严格读取，子进程重挂后不再丢失

Status: implemented

[English](2026-08-23-mcp-remount-tools-strict-get.md) | 中文

## Problem

受管 MCP 服务器被停用再启用后，重挂的 `mcp-client` 子插件能够连接并发现工具，却一个都注册不上：`syncTools` 通过属性代理读取 `ctx.tools`，Cordis 抛出 `cannot get property "tools" without inject`，注册回滚导致行显示「已连接」但没有工具计数，直到应用重启。启动时的首次挂载正常；只有启动后的重挂会坏。

## Decision

`syncTools` 改用严格 `ctx.get('tools')` 解析注册表——它读取全局服务 store，而不是沿调用方的 fiber 链查找；注册表缺失时抛出明确的专用错误。属性代理路径是拓扑敏感的（fiber 链 + 隔离表遍历）；严格读取在重挂场景下保持稳定，且保留相同的 traceable/shadow 服务语义。插件仍声明 `inject = ['tools']`，Loader 依旧会等注册表就绪后再激活。

## Alternatives considered

**把 mcp-servers-file 的子插件移到 host 平面** — 不适用：host 行本来就在自己的上下文上挂载子插件，断裂点在属性代理对启动后才挂载的 fiber 的解析，而不是服务位置。

**改从 `ctx.root.tools` 解析** — 否决：`ctx.root` 越过隔离拓扑，会破坏 `tools.register()` 按 agent scope 定位的语义。

## Consequences

- 停用/启用与重挂循环现在会重新注册完整工具世代；设置行无需重启应用即可显示实时工具计数。
- 严格读取在注册表缺失时返回 `undefined`，组合错误的运行时会得到明确报错，而不是属性代理的拓扑错误。

相关：[MCP 与技能设置](../2026-08-14-mcp-and-skill-settings.md)。
