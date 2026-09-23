# Decision: v3 会话日志参与桌面导入闸门

Status: implemented

中文 | [English](2026-09-23-v3-session-import-gate.en.md)

## Problem

Harness 已将当前会话写成 `session.v3.jsonl` 或 `session.v3.jsonl.zstd`，桌面导入器却只识别旧的 `session.jsonl` 名称。已有 v3 会话的桌面 home 被误判为空；官方来源中的 v3 会话也被漏扫。只要官方 home 有可导入数据，开启「自动启动桌面端」仍会在每次冷启动被导入闸门拦下。

## Decision

导入器在同一组文件名判定中识别旧名与 v3 名称。`probeImportHold`、`scanImport`、冲突检测和会话元数据读取共用该判定；v3 压缩日志仍按现有 zstd 读取路径处理。冷启动探针保持只看文件名，不解压或迁移会话。

## Alternatives considered

- **只在冷启动闸门把 v3 文件视为已有数据** — rejected：导入页仍会把同一目录判为空，也会漏掉官方来源的当前会话，两个入口对同一 home 得出相反结论。
- **看到任意会话目录就放行** — rejected：空目录和未完成的暂存目录也会绕过首次导入判断；现有闸门要求真实会话日志。

## Consequences

已有 v3 会话不再触发错误的首次导入拦截；用户仍需主动勾选并确认导入，官方 home 始终只读。回归用例覆盖 v3 压缩目标目录和 v3 明文来源，且真实桌面 home 的浅探针从 `hold:true` 变为 `hold:false`。
