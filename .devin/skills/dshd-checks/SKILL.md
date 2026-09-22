---
name: dshd-checks
description: 按改动面选最小检查集：什么时候跑 npm test / doc-sync / check:governance / 单条 verify，hooks 已覆盖什么、还欠什么。改代码、改文档、改决策记录、提交推送前使用。
---

# 选检查（改动面 → 最小证据）

原则：本地轻、CI 重；先窄后宽，红一个先修一个。`DSHD_GATE_FAIL_FAST=1` 可让聚合器红即停。

## 映射表

| 改动面 | 最小检查 |
| --- | --- |
| 只改 `docs/decisions/**` | `npm run check:governance`（树/格式/归档/切换行由 pairing 覆盖则再 `--list`） |
| 改任一双语侧（配对对） | `verify-translation-pairing --write <path>` 重录 → `npm run doc-sync` |
| 改 feature 卡 / `.cursor/rules` | `npm run check:governance`（卡 schema + 同步） |
| 改 `docs/**` 其他文档 | `npm run doc-sync`（死链 + 预算 + 配对） |
| 改 `scripts/verify-*` / `run-gates` | `node --test scripts/*.test.mjs`（门禁自己的 spec） |
| 改产品代码 `src/**` / `mobile/**` | 该 feature 卡 `## Gates` 里的定向测试 → `npm test` → 重启应用实测 |
| 改 vendored `vendor/**` | vendor 自带治理（`vendor/*/AGENTS.md`）+ `npm test`；本地分歧须记 vendor README |
| 归档决策记录 | `verify-archived-decisions --write` → `npm run doc-sync` |

## Hooks 已覆盖的（`npm install` 时装）

- `pre-commit`：`run-gates governance`（结构门禁，~秒级）
- `pre-push`：`run-gates doc-sync`（全量文档门禁）
- `*.i18n.yaml` merge 走 `dshd-translation-pairing` driver；冲突残留用 `node scripts/resolve-pairing-conflicts.mjs`

**没覆盖的**：`npm test`（太重，hooks 不跑）——改代码后自己跑；CI 是全量矩阵。

## 纪律

- 绿了才说绿：报结果贴门禁输出，不贴印象。
- 门禁红 → 修被检出的问题，不改门禁放水；确实要放宽规则 → 走 `docs/decisions/proposed/` 提案。
- 每个 verify 脚本带同名 `.test.mjs`；写新门禁必须带 spec（正反两例起步）。
- 产品代码改动后按用户偏好重启应用验证（见根 AGENTS.md）。
