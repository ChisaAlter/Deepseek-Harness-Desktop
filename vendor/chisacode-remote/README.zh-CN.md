# ChisaCode

**本地优先的编程代理控制面。**

> 语言：[English](README.md) | **简体中文**

<p align="center">
  <a href="https://github.com/ChisaAlter/ChisaCode/releases">发布版本</a>
  ·
  <a href="docs/cli.md">CLI</a>
  ·
  <a href="docs/custom-providers.md">Providers</a>
  ·
  <a href="SECURITY.md">安全</a>
  ·
  <a href="LICENSE">AGPL-3.0-or-later</a>
</p>

ChisaCode 在你的机器上运行本地 daemon，启动你已经安装并登录的 agent CLI，然后让桌面端、Android、网页端和 CLI 连接并控制同一批会话。

它不托管模型，也不是云端 coding agent。底层 provider CLI 由你自己安装和登录；ChisaCode 负责启动、托管、流式展示和编排。

GitHub Release 的默认产物是 **Windows 桌面端** 和 **Android APK**。源码里仍有 Electron、Expo 和 CLI，供本地开发使用。

## 当前 Provider 支持

Provider ID 以 `packages/protocol/src/provider-manifest.ts` 为准：

| Provider ID | 显示名称         | ChisaCode 期望的运行时                                                                |
| ----------- | ---------------- | ------------------------------------------------------------------------------------- |
| `claude`    | Claude           | `claude` CLI                                                                          |
| `codex`     | Codex            | `codex` CLI                                                                           |
| `opencode`  | OpenCode         | `opencode` CLI / server                                                               |
| `pi`        | Pi               | `pi` CLI                                                                              |
| `kimi`      | Kimi Code        | `kimi acp` CLI                                                                        |
| `grokbuild` | Grok Build       | `grok agent stdio`                                                                    |
| `dsh`       | DeepSeek Harness | `dsh-acp-demo` ACP 传输(`@deepseek-ai/dsh` + `@deepseek-ai/dsh-acp-demo`,rc 频道 pin) |

自定义 provider 写在 `$CHISACODE_HOME/config.json` 的 `agents.providers` 下。必须继承上面某个内置 ID，或 `extends: "acp"` 来跑通用 Agent Client Protocol 命令。见 [自定义 provider](docs/custom-providers.md)。

## ChisaCode 做什么

- 通过本地 Node.js daemon 启动和托管 agent 进程
- 向已连接客户端流式同步输出、工具调用、权限请求和状态
- 允许多个客户端连接同一个 daemon
- 在你选中的目录打开 git 项目；隔离 worktree 是可选项，不是默认发送路径
- 提供 CLI 管理 agent、provider、worktree、schedule、terminal、loop、chat、permission、speech 和 daemon
- 暴露 MCP 工具，让 agent 自己创建或控制 ChisaCode agent
- 支持不可信的端到端加密 relay 做远程连接；元数据仍可见，选中的 provider 仍会收到 prompt

## 安装

从 [GitHub Releases](https://github.com/ChisaAlter/ChisaCode/releases) 下载当前 Windows 安装包或 Android APK。

桌面端冷启动会拉起内置 daemon。可在设置里安装捆绑 CLI，使 `chisacode` 与当前应用版本一致。

```bash
chisacode daemon status
chisacode provider ls
chisacode run --provider codex "检查这个仓库"
```

## 从源码开发

**前置：** `PATH` 中的 Node.js 22 或更新版本、npm workspaces、Git。

```bash
git clone https://github.com/ChisaAlter/ChisaCode.git
cd ChisaCode
npm ci

npm run dev:win      # Windows：daemon 绑定 localhost:6767 + Expo
npm run dev          # macOS / Linux：portless 名称 + Expo

npm run dev:server   # 只跑 daemon
npm run dev:app      # 只跑 Expo
npm run dev:desktop  # Electron 桌面端
```

仓库内 CLI（不是全局安装的二进制）：

```bash
npm run cli -- provider ls
npm run cli -- daemon status
npm run cli -- run --provider codex "检查这个仓库"
```

Daemon 日志在 `$CHISACODE_HOME/daemon.log`（桌面/稳定默认 `~/.chisacode`）。需要 provider 和 session 追踪时设 `CHISACODE_LOG_LEVEL=trace`。

工作区包通过编译后的 `dist/` 互相引用。跨包类型问题先重建生产方：

```bash
npm run build:client       # protocol -> client
npm run build:server-deps  # highlight -> relay -> protocol -> client
npm run build:server       # server-deps -> server -> cli
npm run build:app-deps     # highlight -> protocol -> client -> expo-two-way-audio
```

## 常用 CLI

```bash
chisacode ls
chisacode run --provider claude "修复失败的测试"
chisacode attach <agent-id>
chisacode send <agent-id> "顺手更新文档"
chisacode wait <agent-id>

chisacode provider ls
chisacode provider inspect codex
chisacode provider models claude

chisacode worktree ls
chisacode schedule create --every 5m "检查 CI 是否仍然通过"
chisacode terminal create --cwd .
```

完整说明见 [docs/cli.md](docs/cli.md)。

## 仓库结构

这是 npm workspace monorepo。默认分支是 `cn-main`。

| 包                              | 职责                                                     |
| ------------------------------- | -------------------------------------------------------- |
| `@chisacode/protocol`           | WebSocket schema、provider manifest、wire types          |
| `@chisacode/client`             | daemon WebSocket 驱动和 SDK                              |
| `@chisacode/server`             | 本地 daemon、provider 运行时、存储、MCP、relay、schedule |
| `@chisacode/app`                | Expo 客户端，覆盖 Android、iOS、web 和桌面 renderer      |
| `@chisacode/desktop`            | Electron 壳；默认发布产物是 Windows 桌面端               |
| `@chisacode/cli`                | `chisacode` 命令行                                       |
| `@chisacode/relay`              | 端到端加密 relay                                         |
| `@chisacode/highlight`          | 语法高亮                                                 |
| `@chisacode/expo-two-way-audio` | 原生双向音频                                             |

```
客户端（桌面 / Android / web / CLI）
        │  WebSocket（直连或 relay）
        ▼
   本地 daemon（Node.js）
        │
        ├── Claude / Codex / OpenCode / Pi / Kimi Code / Grok Build
        └── 自定义 provider（继承内置或 acp）
```

Agent 状态以 JSON 文件落在 `$CHISACODE_HOME/agents/`。

## 文档

- [产品说明](docs/product.md)
- [架构](docs/architecture.md)
- [开发指南](docs/development.md)
- [CLI](docs/cli.md)
- [Provider 内部说明](docs/providers.md)
- [自定义 Provider](docs/custom-providers.md)
- [测试](docs/testing.md)
- [发布指南](docs/release.md)
- [安全策略](SECURITY.md)
- [贡献指南](CONTRIBUTING.md)

代码里实际执行的约定：

- WebSocket 协议保持向后兼容，不删字段，不把可选改成必填
- 新功能用 `server_info.features.*` 能力开关，不为旧 daemon 写降级路径
- 不要在本地跑全量测试套件，只跑改动文件：`npx vitest run <file> --bail=1`
- 格式化用 `npm run format`（oxfmt），lint 用 `npm run lint`（oxlint），改完跑 typecheck

## 安全

- Relay 应用流量使用 Curve25519 ECDH + XSalsa20-Poly1305。Relay 不可信，元数据仍可见。
- Daemon 默认绑定 `127.0.0.1`。没有密码时绑定 `0.0.0.0` / `::` 会直接拒绝启动，除非显式打开覆盖开关。
- Provider 自己处理登录。Prompt 和代码可能被发到你选中的 provider 或网关。

详见 [SECURITY.md](SECURITY.md)。

## 许可证

ChisaCode 使用 AGPL-3.0-or-later。完整文本见 [LICENSE](LICENSE)。

ChisaCode 是基于 [Paseo](https://github.com/getpaseo/paseo) 修改并独立改名的版本。来源、修改和署名见 [NOTICE](NOTICE)。

当 ChisaCode 以二进制分发，或作为可远程网络交互的服务提供时，应按 AGPL-3.0-or-later 提供该精确版本对应的源代码。
