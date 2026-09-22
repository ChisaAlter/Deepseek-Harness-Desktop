# 决策记录（Decision records）

中文 | [English](README.en.md)

一类设计文档：记录影响本仓库的决定或提案——动机、被否方案、代价，即代码与文档承载不了的「为什么」。本文件定义决策记录的存放、生命周期、格式与何时写。

## 目录布局与命名

每篇决策记录有两个轴，都编码在**路径**里：`{lifecycle}/{class}/yyyy-mm-dd-slug.md`：

- **lifecycle**（顶层目录）即状态，文件随状态在目录间移动：
  - `proposed/` — 实施前评审的提案；可以含将来时与计划
  - `implemented/` — 已落地的决定；随代码事实同步更新（只更新事实：路径、命名、默认值——不改写决定本身）
  - `rejected/` — 考虑过并否决；仅当其理由能防止重犯时有保留价值，否则整组删除
  - `archived/` — 已实施但未来指导价值低的记录移入的**冻结**区；永不编辑、永不当作现行依据，由 `verify-archived-decisions` 以 hash manifest 封存
- **class**（二级目录）封闭集合，见 `scripts/decision-tree.json`：`product` 用户可见行为 / `architecture` 结构与机制 / `process` 工具与流程 / `bug-fix` 缺陷修复 / `testing` 测试设施与策略。加类须同改 JSON 与本节。
- 文件名日期是**首次提出**日期（以 git 历史为准）；跨记录引用一律用相对 md 链接，可被 `verify-md-links` 机检。

## 何时写

- 非琐碎改动（行为、契约、结构、流程、盘上/线上/配置格式变化）**必须**同 PR 新增或更新至少一篇决策记录；纯机械/局部修改豁免。
- 更新 owning 记录即满足要求；不要为同一决定重复建记录。决定反转时新建记录并互链——不把旧记录改写成相反内容。
- implemented 记录被完全取代时可合并删除：删除方须保留旧记录全部独有 rationale/alternatives/verification，修复全部入链，同提交删 `.en.md` 与 `.i18n.yaml`。
- 归档用 `node scripts/archive-decision.mjs <记录路径> [--superseded-by <新篇>]` 一键完成：移动三件套到 `archived/`、两侧插 `Archived:` 行、重写入站链接、重录 sidecar 与封印清单；`--superseded-by` 会在新篇插 `Supersedes:` 指针（归档篇冻结，指针只写在新篇里）。归档后内容永久冻结。

## 文件格式

`verify-decision-format`（`doc-sync` 一部分）机检以下条款：

- 头三行固定：`# Decision: <title>`、空行、`Status: <status>`；机检 token（`# Decision:`、`Status:`）双语文件都用英文原文。
- Status 与所在目录一致：`proposed` / `implemented` / `rejected — <一句话原因>`；archived 目录的文件保留 `Status: implemented` + `Archived:` 行。
- 正文以 `## Problem` 开头；`## Alternatives considered` 强制——每条被认真考虑过的方案一段：是什么、为什么输。被否方案必须真实，不后补稻草人。
- 骨架随生命周期：proposed 用 `Problem → Proposal → Alternatives considered → Acceptance criteria → Risks`；implemented 用 `Problem → Decision → Alternatives considered → Consequences`（现在时，禁止 `## Proposal` / `## Plan` / `## Acceptance criteria` / `## Risks` 等提案期标题）；rejected 冻结提案骨架，verdict 只在 Status 行。
- 技术性专节（拓扑、协议、schema）在必需节之间自由命名。

## 与 feature 卡的分工

- 卡（`docs/features/`）：**现行契约**——用户路径、不变量、allowed touch、gates。只写「是什么」。
- 决策记录：**为什么这么定**——动机、被否方案、代价、所需验证；proposal 阶段也承载计划性文字。
- 卡的 `Sources` 用 `Decision:` 行链接 owning 记录；被否提案只进 `rejected/`，不建卡；`status: killed` 的卡是防复活的负契约，杀因应能追到决策记录或 spec。

## 写作规则

- 一个事实一个家；别处需要时链接过去。写当前态，不写变更史——历史在 git、PR、本记录与 postmortem。
- 直写：点名行为者与事实，不用隐喻；想写 `contract`/`boundary`/`shape` 前先想有没有更准的术语。
- 可机检的不变量拧进门禁，不留成「约定靠 review 记」。
- 双语：`slug.md` 中文正本 + `slug.en.md` 英文副本 + `slug.i18n.yaml` 确认记录，契约见 [../i18n/README.md](../i18n/README.md)。
