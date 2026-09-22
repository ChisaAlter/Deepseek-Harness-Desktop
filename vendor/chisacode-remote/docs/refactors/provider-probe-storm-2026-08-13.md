# Provider 探测风暴与 error 可见性（2026-08-13）

阶段一与阶段二 2a 均已完成并通过打包桌面实机验证。本文是契约说明，不是调研笔记。路线图条目见 `docs/refactors/comprehensive-improvement-roadmap.md`。

## 用户可见行为

- 打开模型选择器不再触发全量 provider 重探。选择器只做 stale snapshot 读取；daemon 已有的 warm-up 和 `providers_snapshot_update` PUSH 负责把 loading 推到终态。
- provider 进入 `error` 后，上次成功拿到的模型列表仍显示、仍可选。composer 不得把已选 provider 清成「请选择模型」。
- `unavailable` / disabled 仍然不可选。
- 用户点某个 provider 的「重试」才对该 provider 做定向 force。Settings 的显式刷新仍是全量重探。
- 对仍处于 error 的 provider 发送/创建会在 daemon `getReadyProvider` 失败，错误必须暴露，不得静默。

## 实现契约

### App

- `useProvidersSnapshot().refetchIfStale()` 只调用 `refetchProvidersSnapshotIfStale`（active + stale query refetch）。禁止再引入 `refresh-now` / `refreshSnapshot(undefined)` 作为选择器打开路径。
- `RESOLVABLE_PROVIDER_STATUSES` 与 `SELECTABLE_PROVIDER_STATUSES` 包含 `error`。
- 选择器对 error + last-good models 显示琥珀色「缓存」徽标和钻取警告头；从未有缓存的 error 保持空态 + 重试。
- composer 触发器在选中 error provider 时显示琥珀色点，不增加 cbar 高度。

### Server

- `loadProvider` 在已有 in-flight load 时复用该 promise，包括 force 路径。`refreshSettingsSnapshot` 先清缓存再 force，所以 Settings 刷新仍是新探测。
- 未指定 provider 列表的全量 force 跳过 `status === "ready"` 且 `fetchedAt` 新于 60s 的条目。定向 force 不受此限。
- `DEFAULT_REFRESH_TIMEOUT_MS` 保持 30s。不要把默认改成 10s：Windows 冷 spawn + MCP venv 会误报 error。

## 已验证

- 聚焦 vitest：`use-providers-snapshot.test.ts`、`provider-snapshot-manager.test.ts` 守卫、`provider-selection.test.ts`、`resolve-agent-form.test.ts`。
- app / server typecheck、改动文件 lint/format。
- 打包 win-unpacked 实机：`npx tsx packages/app/e2e/desktop-provider-probe-gate.script.ts`。隔离 `CHISACODE_HOME` + 仅 mock / mock-slow。开选择器 unscoped refresh = 0；Mock 模型可选；Mock Slow 超时后 error 空态 + 重试，点重试回到 loading。证据 `.omo/evidence/desktop-provider-probe-gate-2026-08-13T02-48-23.md`。

原型：`prototypes/provider-error-visibility.html`。

## 阶段二（2026-08-13 起拆分实施）

### 2a 已落地：冷启动限流 + ACP 单 spawn

- **全局探测并发槽 = 2**（`provider-snapshot-manager.ts` `MAX_PROVIDER_PROBE_CONCURRENCY`，`withProbeSlot`）。`warmUp`、cwd refresh、Settings 多 scope 共用同一把锁；定向 Retry 最多排队。冷启动不再 12 路并行抢 PATH/`--version`/npx/venv——这是「点重试才可用」的主因（第一轮互抢，单测被拖到 30s error）。
- 排队前先查 in-flight，force 仍复用进行中的探测（阶段一契约保留）。
- **ACP `listModels` + `listModes` 合并为一次 probe**（`acp-agent.ts` `resolveDiscovery`/`runDiscovery`），按 cwd 缓存 5 分钟；`force` 绕过已完成缓存但合并进行中的探测。Kimi/Grok/generic-ACP 冷启动进程数减半。
- **probe initialize 上限 12s**（`ACP_PROBE_INITIALIZE_TIMEOUT_MS`），只打探测路径，真会话不受限。

### 2b 未做：native Grok MCP 隔离（机器证据否决）

原计划给 native grok 探测隔离 `GROK_HOME`。实机核对用户 `~/.grok/config.toml`（38 行）只有一个**远程** MCP（`ardot-remote`，URL 直连，不 spawn 不阻塞）——不存在「5 个机器级 MCP spawn 挂起」的本地场景，隔离反而有丢模型/auth 风险。grok CLI 1.0.3 也无 `--skip-mcp` 官方标志。此路径关闭；若未来用户配置出现本地 stdio MCP，再按隔离方案评估。

### 2c 已验证/已知边界

- **打包桌面实机 PASS**（`desktop-provider-first-round.script.ts`，用户真实配置复制进隔离 home，未剥离 provider）：第一轮全部收敛（0 loading 残留、0 次 `Failed to check provider availability`）、5 家直接有模型（无需点重试）、开选择器零 unscoped refresh。1 家 error 为 kimi `Authentication required`——隔离 home 无 CLI 侧凭据的环境 artifact，真故障稳定报错（重试不掩盖）符合预期。证据 `.omo/evidence/desktop-provider-first-round-2026-08-13/`。
- **实机发现的既有缺陷已修复**：探测失败（如 `Authentication required`）若经 ACP discovery 路径传播，`void promise.finally(...)` 清理链会把 rejection 变成 unhandled rejection → daemon worker 自杀重启循环。已在 `resolveDiscovery` 用 `.catch(() => undefined)` 消费 rejection 并加回归测试。**任何探测失败都必须只影响该 provider 条目，不得杀死 daemon。**
- Settings 全量 refresh 串行后接近 client 60s timeout 的可能性——未实测撞线，若出现再改 fire-and-forget ack + PUSH，单独开刀。
- Codex `listModels` 的 app-server initialize 未加独立超时（不塞 MCP；若真机仍慢再单独加）。

## 已验证
