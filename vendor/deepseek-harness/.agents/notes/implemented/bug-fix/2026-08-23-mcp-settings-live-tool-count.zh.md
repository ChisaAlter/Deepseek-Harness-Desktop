# Agent Note: MCP 设置页无条件轮询服务器实时状态

Status: implemented

[English](2026-08-23-mcp-settings-live-tool-count.md) | 中文

## Problem

MCP 设置页只在某行处于 `connecting`/`reconnecting` 时轮询 `mcpServers.list`。在页面自身操作之外连接的服务器——两次轮询之间完成初始工具同步的组成配置行、或平静期间新出现的连接——永远不会触发再次拉取，其健康状态与「N 个工具」计数会一直陈旧到应用重启。

## Decision

栏目就绪期间，每两秒无条件轮询一次 `list`（`HEALTH_POLL_MS`），仅在有本地变更（开关/登录）进行中时暂停。迟到响应仍由既有的加载序列守卫丢弃。删除了 `inFlightHealth`；轮询不再依赖上一个快照。

## Alternatives considered

**为状态变化新增 Host 推送事件** — 否决。`mcpServers` 目前没有 Remote 事件通道，接通它（mcp-client 状态注册表发事件 + 客户端订阅）的契约改动大于这个新鲜度缺口所需；本地 Remote 的 `list` 很便宜。

**仅在已连接行缺少工具计数时轮询** — 否决。新出现的组成配置行在陈旧快照里不可见，条件轮询永远发现不了它。

## Consequences

- 页面挂载期间每 2 秒拉取一次小型进程内快照；节奏与既有的健康轮询一致。
- 工具计数、健康状态与新出现的直连行在一个轮询周期内即可显示，无需重启桌面应用。

相关：[MCP 与技能设置](../2026-08-14-mcp-and-skill-settings.md)、[MCP 工具注册改用严格读取](2026-08-23-mcp-remount-tools-strict-get.zh.md)。
