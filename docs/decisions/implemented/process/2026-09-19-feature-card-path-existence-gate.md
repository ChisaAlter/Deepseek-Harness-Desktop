# Decision: Feature 卡 Allowed touch 路径存在性门禁

Status: implemented

中文 | [English](2026-09-19-feature-card-path-existence-gate.en.md)

## Problem

`verify-feature-cards` 只校验卡的字段结构（id/status/last verified/必需小节），**从不校验 `## Allowed touch` 里列出的路径是否真实存在**。这造成一个结构性盲区：卡可以引用已被删除或改名的文件而门禁全绿，卡↔代码漂移只能人工撞见。全代码库审查实际发现 3 处此类漂移：`desktop-live2d-pet` 卡列了不存在的 `src/main/pet-dsh-mux.js`、`message-edit` 卡引用了已被上游拆分的 `MessageItem.tsx`、`dsh-tools` 卡引用了已重命名拆分的 `session-persistence-sqlite/src/codec.ts`。

## Decision

在 `verify-feature-cards.mjs` 的 `collect()` 中新增 Allowed touch 路径存在性校验，范围刻意收窄：

- **只校验桌面自有文件**（`src/`、`scripts/`、`mobile/`、`tools/`、`assets/`、`build/`、`.github/` 下的具体文件）。vendor 路径已由 `harness-desktop-forks` 的 marker 机制以更强的方式守护，不重复校验。
- **跳过包相对续写**（`src/client/...`、`src/styles/...` 等在 vendored 包目录锚点之后出现的相对片段），它们无法从仓库根解析。
- **跳过 glob / 模板**（含 `*`、`{}`、`${}`）。
- **只校验具体文件**（带扩展名），裸目录视为续写锚点。
- **`(planned)` 标记**：紧跟在路径后的 `(planned)` 表示「有意未落地」，仅在 `status: proposed` 的卡上豁免；`active` 卡出现 `(planned)` 或缺失路径即报卡↔代码漂移违规。

## Alternatives considered

- **校验所有反引号 token** — rejected：卡片大量使用包相对续写、RPC 端点（`/api/respond`）、方案（`pet://`）、裸文件名，机械 `existsSync` 产生 145 个误报，信噪比不可用。
- **要求所有 Allowed touch 改写为全限定路径** — rejected：改动面过大，且包相对续写对读者是有效信息。
- **允许 active 卡也用 `(planned)` 豁免** — rejected：会复刻当前盲区，active 卡不该声明未落地路径；未落地项应从 touch 面移除（见 desktop-live2d-pet 的修正）。

## Consequences

门禁现在能在 CI 抓到「卡引用了不存在的桌面文件」这一类漂移，本次即修复了 3 处存量漂移。`check:governance` 同步纳入 `test.yml` CI（此前只有 doc-sync 在 CI 跑，结构治理门本地有、CI 无）。包相对续写与 vendor 路径不在本门禁范围，分别依赖读者约定与 forks marker。
