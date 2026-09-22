# Plan: DSHD 治理规则体系（借鉴上游 DSH 维护机制）

日期：2026-09-16 ・ 状态：草案待拍板 ・ 依据：`vendor/deepseek-harness`（dsh-v0.1.5-rc.2）治理层源码

## 目标

把上游 DeepSeek Harness 的维护机制移植为 DSHD 自己的规则：决策记录、feature 卡生命周期、门禁脚本化、**全量双语配对**、本地/CI 分工、贡献者协作面、postmortem、agent skills。

非目标：不复制上游组织架构（封闭团队、加权审批名单、Projects 状态机 bot 缓做）；不动 `vendor/deepseek-harness` 内部任何文件。

## 上游 → DSHD 映射总表

| 上游机制 | DSHD 落点 | 适配 |
| --- | --- | --- |
| `.agents/notes/` 生命周期决策记录 | `docs/decisions/` 中文「决策记录」 | 路径编码 `{lifecycle}/{class}/yyyy-mm-dd-slug.md`；与 feature 卡分工：卡=契约（是什么），决策=为什么+被否方案 |
| Feature 卡（已有） | `docs/features/` 模板 v2 | `status` 枚举化 `active / proposed / killed`；`_` 前缀只留作 killed 标记；卡只写不变量，rationale 链决策记录 |
| `verify-*` 门禁族 + `run-gates.ts` | `scripts/verify-*.mjs` + `scripts/run-gates.mjs` | node:test 写 spec；`npm run doc-sync` / `check:governance` 聚合 |
| i18n 配对（blob-hash sidecar + merge driver） | **方向反转**：`foo.md` 中文正本 + `foo.en.md` 英文副本 + `foo.i18n.yaml` | 全量机制照搬：hash 确认、`--write` 重录、结构签名、merge driver、fail-closed 冲突 |
| lefthook hooks | `scripts/git-hooks/` + `core.hooksPath` | 零新依赖；`scripts/install-git-integrations.mjs` 由 npm `prepare` 自动跑 |
| PR/issue 模板 + CONTRIBUTING | `.github/` + `CONTRIBUTING.md` | **我们收外部 PR/issue**——模板、label 分类、CI 信任边界按开源项目写 |
| postmortem | `docs/postmortem/` | 触发条件与格式照搬上游 |
| `.agents/skills/` | `.devin/skills/` | 先 2 个：`dshd-pre-push-checks`、`dshd-decision-record` |
| 文档分层 / 写作规则 | `docs/governance.md` 或并入 decisions README | 「一个事实一个家」「写当前态不写历史」「规则带出处链接」 |

## 分层设计

### 1. 决策记录 `docs/decisions/`

```
docs/decisions/
  README.md                 # 规则（≈ 上游 .agents/notes/README.md）
  _template.md
  proposed/    <class>/yyyy-mm-dd-slug.md
  implemented/ <class>/yyyy-mm-dd-slug.md
  rejected/    <class>/yyyy-mm-dd-slug.md
  archived/    <class>/yyyy-mm-dd-slug.md   # 冻结，永不编辑
```

- class 封闭集：`product`（用户可见行为）/ `architecture`（结构与机制）/ `process`（工具与流程）/ `bug-fix` / `testing`。集合写在 `scripts/decision-tree.json`，加类要改它+README。
- 格式：`# Decision: <title>` + `Status: <proposed|implemented|rejected — 一句话|archived>`；implemented 现在时 `## Problem / ## Decision / ## Alternatives considered / ## Consequences`，禁出现 Proposal/Acceptance criteria；**`## Alternatives considered` 强制**。
- 生命周期移动同 PR 内改 Status + 重写骨架；archived 由 `verify-archived-decisions` hash 封存。
- 何时写：改产品契约/结构/流程/格式的非琐碎改动必须同 PR 带决策记录或更新 owning 卡；纯机械/局部修复豁免（沿用 feature spine 现有口径）。
- 与 feature 卡关系：卡持有 shipped invariants 与 allowed touch；决策记录持有动机/被否方案/代价。卡的 `Sources` 增一行 `Decision:` 链接。

### 2. Feature 卡模板 v2

- `status` 枚举：`active`（现行契约）/ `proposed`（方案已定未落地）/ `killed`（负契约：防复活的死亡名单）。`_kill-http-remote.md` 迁移为 `status: killed`（保留 `_` 文件名前缀做树内视觉标记，status 字段做门禁依据）。
- 卡不加 Alternatives 节——它属于决策记录，卡的 Sources 链过去。
- `verify-feature-cards`：字段表齐、status 合法、`last verified` 格式、Sources 链接存在、killed 卡文件名必须 `_` 前缀（反向不要求）。

### 3. 门禁层 `scripts/`

| 脚本 | 检查 |
| --- | --- |
| `verify-decision-format.mjs` | 头/Status 与目录一致/骨架/Alternatives 强制/implemented 禁提案期标题 |
| `verify-decision-tree.mjs` | lifecycle/class 封闭集、命名 `yyyy-mm-dd-slug` |
| `verify-archived-decisions.mjs` | 归档三件套完整性 + frozen hash manifest（`--write` 追加） |
| `verify-feature-cards.mjs` | 上节字段规则 + `_` 前缀约定 |
| `verify-rules-sync.mjs` | 每个 `.cursor/rules/*-product.mdc` 链到存在的卡；卡 README 索引与实际文件一致 |
| `verify-md-links.mjs` | 相对 md 链接与 `#fragment` 锚点可解析（docs/ + 根 md + decisions） |
| `verify-translation-pairing.mjs` | 见第 4 节 |
| `verify-doc-budgets.mjs` | **只对两个权威文档设预算**：`AGENTS.md`、`docs/design-language.md` |
| `run-gates.mjs` | mode → gate 列表的串/并行执行器（`needs` 依赖、`--fail-fast`）；聚合名：`doc-sync`（全部文档门禁）、`governance`（决策+卡+rules+链接） |

- 测试：`node --test` 扩展 glob 到 `scripts/**/*.test.js`（verify 脚本逐个带 spec——门禁自己也测试，照搬上游"维护工具带测试"原则）。
- 现有 `check-*`/`run-*-qa` 不动，归入对应 mode。

### 4. 双语配对（全量机制）

**配对三件套**：`foo.md`（中文正本）+ `foo.en.md`（英文副本）+ `foo.i18n.yaml`（各侧 git blob hash 确认记录）。

- **范围**（决策点 D1）：建议 in-scope = `README.md`、`CONTRIBUTING.md`、`docs/features/**`、`docs/decisions/**`、`docs/postmortem/**`、`docs/design-language.md`、`docs/motion.md`、`docs/handbook/**`、`docs/qa/**`；排除 = `docs/superpowers/**`（工作稿）、`vendor/**`、`mobile/**` 内文档、`docs/code-review-*.md` 一次性稿件。
- **门禁** `verify-translation-pairing.mjs`：三件套齐 / blob hash 与记录一致 / 语言切换行（中文侧 `English | [中文](foo.en.md)` 紧跟 H1，英文侧 `[中文](foo.md) | English`）/ 结构签名（标题深度序、表行列数、列表种类与条数、code fence 序列字节等值、相对链接各指各语言侧）。`--list` 列状态不失败；`--write <pair>` 重录=可审查的确认动作。
- **merge driver** `dshd-translation-pairing`：`.gitattributes` 对 `*.i18n.yaml` 启用；两侧文本合并都干净时自动合成配对记录，否则 fail-closed 留人工；`scripts/resolve-pairing-conflicts.mjs` 处理已停下的 merge。
- **迁移**：现有 4 对（`README`、`design-language`、`motion`、`release-notes`）先录 hash；其余 in-scope 文件批量生成 `.en.md` 初译 + 录 hash，分批 PR（每批可审）。
- 门禁诚实条款照抄进 README：绿了只证明"两侧在这份内容时被确认一致"，不证明翻译质量——语义归 reviewer。

### 5. 本地 hooks + CI

- `scripts/git-hooks/pre-commit`：`git diff --cached --check`、staged `.i18n.yaml` 配对校验、staged 触到 `docs/features|decisions|.cursor/rules` 时跑对应 verify、`vendor/` pin 文件守卫（`harness-upstream.json` 改动必须同提交带 sync 说明）。
- `pre-push`：`npm test`（现有 node:test 单测，快）+ `npm run check:governance`。
- 安装：`scripts/install-git-integrations.mjs` 设 `core.hooksPath=scripts/git-hooks` 并注册 merge driver；挂 `package.json` `prepare`。
- CI：`test.yml` 加 `governance` job（ubuntu-latest，无 Electron，跑 `doc-sync` + `governance`，~1 分钟）；`vendor-gui`/`desktop` 车道不动。
- 本地轻 / CI 重明文进 AGENTS.md：本地只跑暂存级+单测；矩阵与 vendor 车道归 CI。

### 6. 贡献者协作面（按"收外部 PR/issue"写）

- `CONTRIBUTING.md`（**首个双语对**，dogfood 配对机制）：PR 欢迎；门禁清单与本地跑法；feature 卡规则——外部 PR 不要求自建卡，由 maintainer 补卡/决策记录；issue 模板入口；行为契约优先级（卡 > 口头）。
- `.github/pull_request_template.md`：Motivation（`Fixes #NN`）/ Changes / Testing + `<details><summary>Proof</summary>` 可复核证据块。
- `.github/ISSUE_TEMPLATE/`：`bug.md` / `feature.md` / `task.md`，带 native `type:`。
- Label 分类（写进 CONTRIBUTING 或 `docs/governance.md`）：`kind/{feature,bug-fix,doc,testing,cleanup,dependency}` + `area/{launcher,boot,settings,marketplace,surfaces,terminal,pet,remote,updater,infra}`；Dependabot 自动打 `kind/dependency`+`area/infra`。
- `.github/dependabot.yml`：npm `/` + github-actions，周更 + `cooldown.default-days: 30`（抗新包供应链），`exclude-paths: vendor/**`。
- CI 信任边界写明：`pull_request` 无 secrets 跑外部 PR 是现状且必须保持；任何将来需要 secrets/写权限的 job 用 `pull_request_target` + checkout 默认分支受信脚本的范式（上游 e2e.yml 注释范式照搬为规则条文）。

### 7. Postmortem `docs/postmortem/`

- `README.md` 定义触发条件（照搬）：**subtle**（机制非显然）+ **systemic**（逃逸原因在测试/工具/约定缺口）+ **costly to rediscover**。
- 格式：Executive summary → Summary → Impact → Timeline → Root cause → **Why every test missed it** → Guardrails added → Lessons；编号 `NNNN-slug.md`；guardrails 必须链到实际新增的测试/规则/卡条目。
- 首个候选：launcher 端口保留段误判插件冲突（2026-09-10 已修，值得补录为 0001）。

### 8. Skills `.devin/skills/`

- `dshd-pre-push-checks`：推送前按 diff 面选最小门禁（改 docs→doc-sync；改 launcher→对应单测+skip-compose 契约；改卡/decisions→governance）；含 `--force-with-lease` 与失败后处理流程。
- `dshd-decision-record`：新决策记录的建卡/迁移/归档操作手册（supersession 检查、三件套、--write 重录）。
- 后续按需再加（翻译配对流程、postmortem 写作）。

### 9. AGENTS.md 治理段（增量，守半页纪律）

新增小节，每条一行链到 owning doc：
- 非琐碎改动必须同 PR 带决策记录或更新 owning 卡（→ docs/decisions/README.md）
- 文档门禁 `npm run doc-sync`；全量门禁 `npm run check:governance`（→ scripts/run-gates.mjs）
- 双语文档配对契约（→ docs/i18n/README.md 或 docs/bilingual.md）
- hooks 由 `prepare` 自动装；手动 `node scripts/install-git-integrations.mjs`
- 写作规则：一个事实一个家、写当前态不写历史、规则带出处链接
- `docs/features/README.md` 分工表加一行「决策记录 = 为什么+被否方案」

## 分阶段实施

| Phase | 内容 | 验收 |
| --- | --- | --- |
| A 骨架 | `docs/decisions/` 树 + README + 模板；卡模板 v2 + status 枚举迁移（`_kill-http-remote` 转正）；features README 分工表加决策行 | 手工审 |
| B 门禁 | verify-decision-format/tree/feature-cards/rules-sync/md-links + run-gates + `doc-sync`/`check:governance` npm script + node:test glob 扩展 + 各 spec | 全绿；人为制造 3 类坏例验证门禁会红 |
| C 双语 | i18n 契约文档 + verify-translation-pairing（含 --write/--list/结构签名）+ merge driver + 安装器；先录 4 个已有对；分批补齐 in-scope 语料 | 任改一侧不重录即红；merge driver 在真实 merge 上验证一次 |
| D 协作面 | CONTRIBUTING 双语对 + PR/issue 模板 + dependabot + label 文档 + git-hooks 安装器 | 新 clone 装 hooks 成功；模板在 GitHub 生效 |
| E 沉淀 | postmortem/ + 0001 补录；`.devin/skills/` 两个 skill；AGENTS.md 治理段 | 评审通过 |

顺序理由：A→B 先有记录载体再有执法；C 体量最大独立推进；D/E 无依赖可穿插。

## 待拍板决策点

- **D1 双语范围**：按上表"in-scope 排除 superpowers/vendor/一次性稿"是否认可？全量含 handbook（~25 篇）意味着一次较大的初译量。
- **D2 决策记录独立成树**：推荐 `docs/decisions/`；备选是塞进 feature 卡加 `type: decision`——不推荐，卡是契约索引不是 RFC。
- **D3 hooks 零依赖方案**（`core.hooksPath` + 自写脚本）vs 引入 lefthook 依赖。推荐零依赖。
- **D4 archived 是否从第一天建**：上游有 hash manifest；我们可以先建目录+规则，封存门禁随 B 阶段一起做（成本低，建议带上）。
- **D5 缓做清单确认**：加权审批、issue Projects 状态机 bot、文档站投影、全量字数预算、skill 自动维护回路——本期不做，写入 decisions/rejected 或 README「明确不做」。

## 明确不做（防 scope 蔓延）

- 不改 `vendor/deepseek-harness` 内部治理文件；上游机制只是参考源。
- 不引入 pnpm/vitest/lefthook；全用 npm + node:test + 自写脚本。
- 不要求外部 PR 自写决策记录/feature 卡（maintainer 职责写进 CONTRIBUTING）。
- 不做 VitePress 文档站、不做 CI 平台矩阵扩张。

## 决策回填（2026-09-17 定案）

- D1 双语范围：按推荐执行——`docs/decisions/**` 强制三件套，其余登记制（`scripts/i18n-pairs.manifest.json`）；superpowers/vendor/qa-results 排除。
- D2 决策记录独立成树：已定 `docs/decisions/`，见 [2026-09-17-governance-rules-adoption](../../decisions/implemented/process/2026-09-17-governance-rules-adoption.md)。
- D3 hooks 零依赖：已定 `core.hooksPath` → `scripts/git-hooks/` + `prepare` 自动装。
- D4 archived 第一天建：已带 hash manifest 封印（`verify-archived-decisions`）。
- D5 缓做清单：维持不做；加权审批/GitHub Projects bot 等未引入。
- 双语配对契约全文：[2026-09-17-bilingual-pairing-contract](../../decisions/implemented/process/2026-09-17-bilingual-pairing-contract.md)。
- 系统总览（五层 + 回流管线 + 命令表）：[docs/maintenance/README.md](../../maintenance/README.md)。
