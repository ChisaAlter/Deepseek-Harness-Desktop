# DSHD 维护系统

中文 | [English](README.en.md)

本仓库的可执行治理系统：规则写给 agent 读、决策沉淀为受管文档、能机械检查的纪律全部拧成脚本。本文档是系统的唯一总览；各层细节去各层自己的 README。

## 五层

| 层 | 位置 | 职责 | 机检 |
| --- | --- | --- | --- |
| 契约层 | [docs/features/](../features/README.md) + `.cursor/rules/` | 产品行为契约：用户路径、不变量、默认可改面、门槛 | `verify-feature-cards`、`verify-rules-sync` |
| 决策层 | [docs/decisions/](../decisions/README.md) | 为什么：动机、被否方案、代价；路径编码生命周期 | `verify-decision-tree`、`verify-decision-format`、`verify-archived-decisions` |
| 叙事层 | [docs/postmortem/](../postmortem/README.md) | 事故叙事——唯一允许讲故事的层 | 无（叙事不机检） |
| 语言层 | [docs/i18n/](../i18n/README.md) | 双语配对：三件套、blob hash、结构签名、pending 棘轮 | `verify-translation-pairing` |
| 执行层 | `scripts/` + `.github/` | 门禁聚合、git hooks、merge driver、PR/issue 模板、dependabot | `run-gates.mjs`、`verify-md-links`、`verify-doc-budgets` |

代理操作入口：根 [AGENTS.md](../../AGENTS.md) 是 standing orders；`.devin/skills/` 里 `dshd-maintenance`（决策记录操作流）与 `dshd-checks`（改动面→最小检查集）是可执行程序。

## 知识回流管线

```
incident → docs/postmortem/
         → guardrails: tests / rules / gates
         → AGENTS.md / docs/features/ / .cursor/rules/
         → scripts/verify-* + *.test.mjs
         → .devin/skills/<name>/SKILL.md
         → rule links back to owning docs/decisions/ record
```

反向同样成立：新决策先查 `rejected/` 与活跃树，别重提已否决路线。

## 命令

```sh
npm run check:governance    # 结构门禁：决策树/格式/归档封印/卡/schema/规则同步/远程开关
npm run doc-sync            # 全量文档门禁：上面 + 死链/配对/字数预算
node scripts/verify-translation-pairing.mjs --list          # 所有配对状态
node scripts/verify-translation-pairing.mjs --write <path>  # 改完双语任一侧后重录
node scripts/verify-archived-decisions.mjs --write          # 归档动作时重录封印
node scripts/archive-decision.mjs <record> [--superseded-by <new>]  # archive a decision in one step
node scripts/resolve-pairing-conflicts.mjs                  # merge 后清理 i18n 冲突
DSHD_GATE_FAIL_FAST=1 npm run doc-sync                      # 红一个即停
```

`npm install` 经 `prepare` 自动装 git 集成：`core.hooksPath` 指到 `scripts/git-hooks/`（pre-commit 跑结构门禁、pre-push 跑 doc-sync），`*.i18n.yaml` 走 `dshd-translation-pairing` merge driver。

## 边界

- `docs/superpowers/`（过程稿）、`docs/qa/results/`（历史验收记录）、`vendor/`（上游自带治理）不进死链与配对检查。
- 外部 PR/issue 开放：见 [CONTRIBUTING.md](../../CONTRIBUTING.md)；卡与规则由维护者收尾。
- 本系统只管仓库维护，不管产品 UI——产品面变更走 feature 卡与 [design-language.md](../design-language.md)。
- 暂无生成式看板与 `// Note:` 代码锚点（记录量未到需要索引的规模；需要时按上游 build-board / check-note-anchors 模式补，不先手建）。
