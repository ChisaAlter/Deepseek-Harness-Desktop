---
description: "E2B 远程运行时组映射：把文件与命令工作放进一个远程 Linux 沙箱，供 E2B 家族的用户与维护者浏览。"
kind: "package-group"
---

# packages/e2b

[English](README.md) | 中文

## 概述

E2B 家族让 agent（智能体）在一个远程 Linux 沙箱中读取和编辑文件、运行 shell 命令并使用终端，而不是在主机上执行这些工作。文件系统工作与命令和终端执行保持分离，但两者使用同一个沙箱。现有的 shell、终端与语言服务器功能无需 E2B 专用工具即可继续工作。harness 进程、模型调用与会话状态仍在本地；沙箱是短暂的实验性环境，且已发布的组合默认不会启用它。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

| 包（package） | 职责 | ctx 键 |
|---|---|---|
| [`e2b`](e2b/README.zh.md) | 文件与命令工作运行所在的共享远程 Linux 沙箱 | `ctx.e2b` |
| [`fs-e2b`](fs-e2b/README.zh.md) | 远程沙箱内的文件读取、写入、编辑与列表 | `ctx.fs` |
| [`subprocess-e2b`](subprocess-e2b/README.zh.md) | 远程沙箱内的 shell 命令与交互式终端 | `ctx.subprocess` |

-----

<a id="related-documentation"></a>
## 相关文档

- [可移植执行世界决策](../../.agents/notes/implemented/architecture/2026-07-28-portable-execution-world-consumers.zh.md)——执行世界为何可以在不移动 harness 的情况下迁移，以及哪些内容留在本地。
- [子进程子系统](../../docs/subsystems/subprocess.zh.md)——子进程 seam 约定与生成的 Cordis 表面，包括 `ctx.e2b`。
- [文件系统子系统](../../docs/subsystems/filesystem.zh.md)——文件系统 seam 约定与生成的 Cordis 表面。

-----

<a id="dev-note"></a>
## 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
