# Feature: Release process

| Field | Value |
| --- | --- |
| **id** | `release-process` |
| **status** | `active` |
| **last verified** | 2026-10-02 — v0.3.3 的 3897ce69b 已由 ChisaAlter 推送到 main；此前依赖锁与隔离干净安装、发布工具定向检查、源码桌面四轮真实模型对话已通过，见 .tmp/release/current-state.json 与 .tmp/release/source-model-ui-result.json。最终 CI [36984178966](https://github.com/ChisaAlter/Deepseek-Harness-Desktop/actions/runs/36984178966) 的 Fast checks 与 vendor-gui 通过，Windows 单测 3020 Pass / 1 Fail / 6 Skip；唯一失败是 packaged-p0.test.js 检查故障提示包含 `npm run dist`，而 3897ce69b 修改提示时误删了这个仍有效的构建命令。本地现已在两条诊断提示中恢复适用时的 `npm run dist` 指引，同时保留根 `.nvmrc` 的 Node 版本指引与原断言；Node 24.21.0 定向单测 10/10 通过，真实缺失 EXE 路径退出 1 并输出修正后的提示。此前只改断言的方案不构成充分修复。该次 CI 仍失败；同目标累计未通过 24 次，已停止推送、CI 与新候选，旧候选验收不能继承，尚未发布。 |

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
