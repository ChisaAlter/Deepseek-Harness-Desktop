# 决策记录

中文 | [English](README.en.md)

记录未来维护者需要理解的长期取舍。何时介入和防复发要求见[维护系统](../maintenance/README.md)。

本页只在[WhaleIsle 唯一维护准则](../maintenance/README.md)下说明记录格式和工具操作，不追加评审、写作或测试门槛；历史执行约定不授权当前行动。

## 何时写

- 架构、兼容性、持久数据格式或发布 / 测试责任发生长期变化，且理由不能从实现直接看出时，更新已有记录；没有对应记录才新建。
- 普通缺陷修复、机械调整、现有契约下的实现变化不强制建记录。在提交 / PR 中说明复现、根因和验证即可。
- 已授权的工作直接实施；只有实质方案尚待决定才写 proposed。完成的决定直接写 implemented，不强制经过提案评审。
- 同一事实只维护一处。功能卡写当前契约，手册写当前实现，决定写理由，不复制整套验证流水账。

## 目录与生命周期

路径为 `docs/decisions/{lifecycle}/{class}/yyyy-mm-dd-slug.md`；日期是首次提出日。

| lifecycle | 含义 |
| --- | --- |
| proposed | 尚待决定的方案 |
| implemented | 已实施的决定，保留取舍与适用边界 |
| rejected | 未采纳方案，Status 附真实原因；仅在有防重犯价值时保留 |
| archived | 已实施决定的冻结历史；不能作现行规则 |

class 来自 `scripts/decision-tree.json`：product、architecture、process、bug-fix、testing。原地更新事实，理由反转则新建并互链；不把旧结论改写成相反的决定。

归档用 `node scripts/archive-decision.mjs <record> [--superseded-by <new-record>]`。仅归档 implemented，保留单语或双语形态，重写活跃文档入链并封存；历史 QA、过程稿和已封存记录不重写。预检失败不移动，执行失败恢复原文件。rejected 留在原生命周期。

## 内容格式

- 头三行：`# Decision: <标题>`、空行、`Status: <lifecycle>`。rejected 的状态附 ` — 原因`；archived 保留 implemented 并附日期。
- 正文从 `## Problem` 开始。implemented / archived 需要 `## Decision` 和 `## Consequences`；proposed 需要 `## Proposal`、`## Acceptance criteria`、`## Risks`；rejected 保留问题及否决原因。
- `## Alternatives considered` 可选，只记录真正考虑过的方案，不设数量下限。没有备选时删掉空节，不编造取舍。
- 已实施记录不保留 Proposal、Plan 等未来计划节；未完成的操作和测试如实放在后果或证据限制中。
- 技术专节按需要增加，长度按事实需要决定，无字数或页数门槛。

[模板](_template.md)提供已实施记录骨架，不要求为普通修改填模板。

## 语言和来源

内部新记录默认单语 `slug.md`，中文或英文均可；不需要翻译占位或 sidecar。已有配对及明确对外提供的双语文档继续按[配对规则](../i18n/README.md)维护，不删除已有译文来逃避检查。

[功能卡](../features/README.md)的 Sources 可写 `Decision: none`；存在长期决定时链接其实际文件。链接通过只说明目标存在，不说明该决定正确、已经验证或仍适用。
