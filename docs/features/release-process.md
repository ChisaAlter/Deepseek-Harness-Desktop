# Feature: Release process

| Field | Value |
| --- | --- |
| **id** | `release-process` |
| **status** | `active` |
| **last verified** | 2026-10-02 — Windows / Node 24.21.0 / npm 11.19.0：维护工具既有定向行为和真实 hook 结果保留；当前 CI 资格、工作流接线、隔离 Git 工具检查通过。临时 RunAs token 下资产校验的真实文件符号链接路径通过，无 skip。远程 `@types/node` override 固定为锁内 22.20.4 后原失败 dry-run 与隔离干净 `npm ci --ignore-scripts` 均通过，锁文件未改；此前代理断连失败保留。当前源码构建、Files 保存、Git、PTY 工作环与后台真实任务保护/pwsh 路径通过。续验 Windows / Node 24.19.0 的隔离 CLI Host：MiniMax 两轮真实响应及同会话 pwsh-1 字符串任务 ID、exit 0、输出匹配通过；观察器误要求每轮新增 request/header，已按继承语义核对同一次保存会话，无重复模型请求。证据 `.tmp/release/minimax-real-model-20261002-reviewed.json`；原 529 与观察器失败保留，不认证桌面模型 UI 或原包验收。累计同目标 CI 未通过次数已核实为 23，未清零；用户已明确恢复前台验收；隔离源码桌面 Node24.21.0 已观察四轮真实模型回复：连通、上下文回忆、README 文件读取和模型驱动 pwsh。命令 `(Get-Item .).Name` 的工具输出及最终回复均为 `workspace`，四轮持久会话全部正常结束；证据 `.tmp/release/source-model-ui-result.json`。旧原包的失败与未验收状态不变。无推送、CI、新候选或发布。 |

## User paths

1. 固定范围和实际完成标准，先完成实现，再完成同版本本地严格 QA/实际操作；随后才手动触发最终 CI，从通过的 main SHA 生成一次候选。
2. 对原始安装包执行核心场景与自动选择的影响场景，分类处理失败，记录明确放行。
3. 晋级只上传同一候选字节，并核对不可变提交中的验收记录。

## Invariants

- 安装包 SHA、候选 SHA、run ID、基线和验收计划绑定；新包不继承旧包 Pass。
- 缺失验收、核心场景未通过、未解决的严重产品缺陷均阻止发布。
- 非核心限制只能如实记录，豁免必须有责任人、理由、跟进与期限。
- push/PR 不自动触发 CI；第四次累计未通过即停止 CI 与新候选，不能跨 SHA/版本/工作流/会话清零。用户当前约束优先，禁止提前准备测试与假想风险开发。
- 完整用例表是回归库；正式执行集由核心场景、变更影响和人工补充组成。

## Allowed touch

- `.github/workflows/`、`scripts/release-*.mjs`、`scripts/check-release-*.mjs`、`scripts/run-final-gates.mjs`、`scripts/run-gates.mjs`、`scripts/git-hooks/`、`scripts/install-git-integrations.mjs`、相关测试与 `package.json`。
- `docs/qa/`、`docs/handbook/`、`docs/features/`、`docs/maintenance/`、发布流程决策、`.cursor/rules/`、`AGENTS.md`、`CONTRIBUTING.md` 与 `.devin/skills/` 的维护入口；子项目 AGENTS/CLAUDE、文档技能、测试说明、hook 生命周期和维护检查配置中的宿主执行范围与冗余要求。

## Gates

- 发布计划、验收校验、CI 资格和工作流接线的定向行为测试、实际 hook 操作和工作流解析；文档工具按本次内容选择，不要求每改一次全量 doc-sync。
- 新工作流的真实 CI 执行单独记录；本地测试不认证已发布或安装版通过。

## Sources

- Decision: [本地 QA 优先](../decisions/implemented/process/2026-10-02-local-qa-first-release.md)
- Previous decision: [发布收敛](../decisions/implemented/process/2026-10-02-release-convergence.md)
- Handbook: [构建与发布](../handbook/modules/build-release.md)
- Acceptance: [v0.3.3 候选 36912364842](../qa/releases/v0.3.3/36912364842.json)
- Implementation entry: `.github/workflows/release.yml`、`.github/workflows/publish.yml`
