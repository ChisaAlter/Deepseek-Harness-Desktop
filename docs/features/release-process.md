# Feature: Release process

| Field | Value |
| --- | --- |
| **id** | `release-process` |
| **status** | `active` |
| **last verified** | 2026-10-02 — Node 24.21.0 下发布计划、验收、下载、版本、CI 资格和工作流定向验证通过；3 项资产符号链接测试因本机 EPERM 明确跳过，CI 仍强制执行。文档门禁 7/7 通过。未运行真实 GitHub Actions、签发安装验收或公开发布。 |

## User paths

1. 固定版本范围，以最近正式版为基线，从通过相关 CI 的 main 提交生成一次候选。
2. 对原始安装包执行核心场景与自动选择的影响场景，分类处理失败，记录明确放行。
3. 晋级只上传同一候选字节，并核对不可变提交中的验收记录。

## Invariants

- 安装包 SHA、候选 SHA、run ID、基线和验收计划绑定；新包不继承旧包 Pass。
- 缺失验收、核心场景未通过、未解决的严重产品缺陷均阻止发布。
- 非核心限制只能如实记录，豁免必须有责任人、理由、跟进与期限。
- 完整用例表是回归库；正式执行集由核心场景、变更影响和人工补充组成。

## Allowed touch

- `.github/workflows/`、`scripts/release-*.mjs`、`scripts/check-release-*.mjs`、相关测试与 `package.json`。
- `docs/qa/`、`docs/handbook/`、`docs/features/`、发布流程决策、`.cursor/rules/`、`AGENTS.md`、`CONTRIBUTING.md` 与 `.devin/skills/` 的发布约束。

## Gates

- 发布计划、验收校验、CI 资格和工作流接线的定向测试；`npm run doc-sync`。
- 新工作流的真实 CI 执行单独记录；本地测试不认证已发布或安装版通过。

## Sources

- Decision: [发布收敛](../decisions/implemented/process/2026-10-02-release-convergence.md)
- Handbook: [构建与发布](../handbook/modules/build-release.md)
- Implementation entry: `.github/workflows/release.yml`、`.github/workflows/publish.yml`
