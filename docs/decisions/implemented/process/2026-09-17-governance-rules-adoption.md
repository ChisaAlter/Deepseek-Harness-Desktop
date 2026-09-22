# Decision: 移植上游 DSH 治理机制为 DSHD 规则

Status: implemented

中文 | [English](2026-09-17-governance-rules-adoption.en.md)

## Problem

DSHD 已有 feature 卡（现行契约）与 `.cursor/rules`（短不变量），但决策的动机与被否方案散落在 `docs/superpowers/` 工作稿里随时间腐烂；规则没有可机检的格式约束；文档无双语一致性机制；外部贡献者入口（PR/issue 模板、CONTRIBUTING、label 分类）缺失。

## Decision

按 [计划](../../../superpowers/plans/2026-09-16-dshd-governance-rules.md) 移植上游 `vendor/deepseek-harness`（dsh-v0.1.5-rc.2）治理机制：`docs/decisions/` 决策记录树（本目录，生命周期+分类编码进路径）、feature 卡 `status` 枚举化、`scripts/verify-*` 门禁族 + `run-gates.mjs` 聚合（`npm run doc-sync` / `npm run check:governance`）、卡 `## Sources` 必含 `Decision:` 字段（`none` 或链接到决策记录）、`scripts/archive-decision.mjs` 归档一键流、全量双语配对（zh 正本 + `.en.md` + `.i18n.yaml` + merge driver，范围见 [2026-09-17-bilingual-pairing-contract](2026-09-17-bilingual-pairing-contract.md)）、零依赖 git hooks（`core.hooksPath` + `prepare` 安装）、贡献者协作面（CONTRIBUTING / PR/issue 模板 / dependabot）、`docs/postmortem/`。

## Alternatives considered

- **继续只用 feature 卡** — rejected：卡只写「是什么」，被否方案无处可放，注定反复重提。
- **全量照抄上游 `.agents/notes` 命名与英文正本** — rejected：DSHD 文档惯例是中文正本 + `.en.md` 副本，沿用之。
- **引入 lefthook / vitest / pnpm** — rejected：零新依赖，`node:test` + npm `prepare` + 自写脚本够用。
- **加权审批与 issue Projects 状态机 bot** — deferred：单人+agent 维护阶段不需要；将来贡献者量上来再评。
- **门禁只靠 review 自觉** — rejected：上游的结论是「convention without a gate」等于没有约定；凡可机检的条款都进 `verify-*`。

## Consequences

每个非琐碎改动多一份记录成本；换来可机检格式、防重提的 rejected 区、外部贡献者可读明的规则，以及门禁脚本自身的维护义务（每个 verify-* 带 spec）。
