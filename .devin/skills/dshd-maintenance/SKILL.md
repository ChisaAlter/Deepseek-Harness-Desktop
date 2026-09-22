---
name: dshd-maintenance
description: DSHD 维护系统的决策记录操作流。非平凡改动（行为/架构/跨文件契约/流程工具/测试策略/落盘格式）、技术选型、取代旧决定、写 postmortem 时使用。纯机械改动（排版、重命名、样式、补丁、CRUD、单文件自明修复）不要立记录。
---

# DSHD 维护系统操作流

系统总览与五层分工见 [docs/maintenance/README.md](../../docs/maintenance/README.md)。本 skill 只管一件事：把「为什么、放弃了什么」写进 `docs/decisions/`，并保证它通过门禁。

## 红线：先判要不要写

**纯机械改动严禁立记录，直接改：**

- 排版格式化、错别字、无歧义重命名
- 不改行为的样式调整、依赖补丁、版本打标
- 常规 CRUD、单文件内看 diff 即懂的修复（无跨文件影响）

**命中以下任何一项即非平凡，必须写**：改了行为 / 架构 / 跨文件契约 / 流程与工具链 / 测试策略 / 落盘·网络·配置格式 / 维护者日后可能重访的决定。判不准时从严。

| 借口 | 现实 |
| --- | --- |
| 「只是改默认值/重命名」 | 默认值和命名是决策事实；原地更新只要一分钟 |
| 「先合并以后补」 | 以后 = 永远不会 |
| 「代码即文档」 | 代码说不出为什么和放弃了什么 |
| 「改动太小」 | 规模小 ≠ 不用记 |

## 路径即身份

`docs/decisions/{lifecycle}/{class}/yyyy-mm-dd-slug.md`

- lifecycle：`proposed`（方案未定）→ `implemented`（已落地，现在时）/ `rejected`（被否，Status 行写一句原因）→ `archived`（冻结封存）
- class（封闭集，canonical 在 `scripts/decision-tree.json`）：`product` / `architecture` / `process` / `bug-fix` / `testing`
- 文件名日期 = 首次提出日，状态流转不改名

## 操作流

1. **首选原地同步**：事实变了（路径/符号/默认值）直接改持有该决定的老记录正文；理由翻转才开新篇并互链。禁止把 `## Decision` 改写成反面。
2. **写新篇前当场审计**：按模块名/关键词搜 `proposed + implemented + rejected`（排除 `archived/`），命中逐篇分类：无关 / 部分重叠（互链）/ 完全取代（新篇接管全部 rationale 后删或归档）/ 过时提案（转 rejected 或删）。分类结果随新篇同批落盘。
3. **新想法**：先写 `proposed/`（Problem/Proposal/Alternatives/Acceptance criteria/Risks），评审完再动手。
4. **落地流转（proposed→implemented）同批做完**：移到 `implemented/<class>/`；`Status:` 改 implemented；`## Proposal` 改现在时 `## Decision`；`## Acceptance criteria`/`## Risks` 折进 `## Consequences`；删计划段。
5. **归档**：`node scripts/archive-decision.mjs <记录路径> [--superseded-by <新篇>]` 一键完成（移动三件套 + 插 Archived 行 + 重写入站链接 + 重录 sidecar 与封印清单 + 新篇插 Supersedes 指针）。归档后永不编辑；垃圾不进归档（无防坑价值的直接删）。
6. **Postmortem**：隐蔽+系统性+昂贵的事故写 `docs/postmortem/NNNN-*.md`（见该目录 README）；写完若暴露了值得留档的决定，补一篇决策记录互链。

## 三件套纪律（强制）

每篇记录 = `slug.md` 中文正本 + `slug.en.md` 英文副本 + `slug.i18n.yaml` 确认记录：

- 切换行：zh `中文 | [English](slug.en.md)`、en `[中文](slug.md) | English`，文件头 14 个非空行内。
- 改任一侧后 `node scripts/verify-translation-pairing.mjs --write <任一路径>` 重录；`--list` 查状态。
- 结构签名必须对齐：标题深度、列表条数、表行列、code fence、相对链接序列（措辞自由，骨架一致）。
- 英文写不动时允许只交中文侧 + 在 `scripts/i18n-pending.manifest.json` 登记 pending（PR 里说明），恢复后必须移出。

## 格式契约（verify-decision-format 机检）

头三行固定：`# Decision: <标题>` → 空行 → `Status: <lifecycle>`（须与目录一致）。必备节：`## Problem`、`## Alternatives considered`（真实权衡过的对手，先写最强理由再否）、implemented 加 `## Decision`（现在时）+ `## Consequences`（代价和收益都写）、proposed 加 `## Proposal` + `## Acceptance criteria`。implemented 里禁止 `## Proposal`/`## Plan`/`## Acceptance criteria` 等提案期标题。

模板：`docs/decisions/_template.md`。

## 与 feature 卡的分工

卡 = 「是什么」的现行契约（docs/features/）；决策记录 = 「为什么+被否方案」。卡上 `Sources` 节的 `Decision:` 行链到记录；新卡或改卡契约的非琐碎改动通常欠一篇记录。`.cursor/rules` 由维护者维护，外部 PR 不碰。

## 写完自检

过一遍 [references/quality-gate.md](references/quality-gate.md) 的语义清单；只向用户报缺口和写得好的地方，缺口给具体修法。

## 交互协议

- facts 自己查（rg / 树切片 / 模块文档），只有取舍才问用户
- 待拍板问题编号一轮全抛，每题带推荐答案
- 动手前复述全部决定，确认后执行；开放决策超过五个 = 改动太大，拆篇或先交 proposed
