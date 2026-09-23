# Decision: 发布与晋级工作流使用不可变 action 版本

Status: proposed

中文 | [English](2026-09-19-workflow-action-sha-pinning.en.md)

## Problem

`.github/workflows/test.yml` 的 `actions/checkout` 与 `actions/setup-node` 已钉到 commit SHA，但同一仓库的 `release.yml` 使用可变 tag `@v4`（checkout、setup-node、upload-artifact），`publish.yml` 的 checkout 也仍是 `@v4`。发布链是唯一生成用户安装包与正式 Release 资产的路径：它比测试链更需要可复现的构建输入，却使用了更弱的供应链约束。审计把这种不一致记为 AUD-07。

## Proposal

把 `release.yml` 与 `publish.yml` 的每个 `uses:` 钉到与 `test.yml` 相同的 commit SHA（`actions/checkout@11d5960a326750d5838078e36cf38b85af677262`、`actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020`、`actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02`），并保留 `# v4` 注释标注语义版本。SHA 通过 GitHub API 的 tag ref 核对，不依赖记忆。不引入新的第三方 action，不改变 job 结构、权限或 artifact 命名。

## Alternatives considered

- **保持 `@v4` 并只加注释** — rejected：注释不改变解析结果，tag 仍可被移动，正是本次要消除的风险。
- **全仓库统一改用固定 tag（如 `@v4.2.2`）** — rejected：tag 同样可变，只是变更频率较低；SHA 才是不可变引用。
- **引入 Dependabot 的 github-actions 更新器作为唯一机制** — rejected：更新器能保持新鲜度，但不能替代「当前引用必须不可变」这一要求；两者互补，本次只做后者。

## Acceptance criteria

`release.yml`、`publish.yml`、`test.yml` 中不存在形如 `uses: owner/action@vN` 的可变 tag 引用；三个 workflow 对同一 action 使用同一 SHA；workflow YAML 仍可解析，job/step 结构不变。

## Risks

SHA 钉版需要人工或自动化更新；固定在旧 commit 可能错过安全修复，需要配合依赖更新流程。本轮未实际调度 workflow（release 为 tag/dispatch 触发），因此验证限于静态解析与引用一致性。可复用 `test.yml` 已验证的 SHA，降低引入错误引用的风险。
