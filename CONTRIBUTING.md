# 贡献指南

中文 | [English](CONTRIBUTING.en.md)

WhaleIsle 接受外部 Pull Request 与 Issue。本文件写清门槛，避免贡献者撞上隐形规则。

## 提 PR 前

- **先实现后验证**：修复前可写一个能失败的最小复现；除此之外，实现完成之前不准备测试或 QA 夹具，不为假想场景做防御开发。实现完成后做相关自动测试、必要构建/依赖锁检查、原失败和受影响路径的真实 QA；必要项未通过禁止 CI。CI 只在范围稳定后手动最终验证，push/PR 不自动触发；第四次累计未通过停止 CI/新候选，跨 SHA/版本/会话不清零。文档检查按变动选择；发布遵循 [发布操作流程](docs/handbook/modules/release-process.md)。
- **检查 Git 集成**：`node scripts/install-git-integrations.mjs --check` 核对实际 hooks / merge driver；缺失时运行同一脚本去掉 `--check`，无需重装依赖。保留自定义集成；pre-commit 不跑门禁，pre-push 仅在自动/未知工作流策略下核对同 HEAD QA，不跑套件、不认证观察真实性。手动策略下普通推送不要求发布记录；最终 CI 前仍须严格本地 QA。统一职责、证据与验证选择见[维护系统](docs/maintenance/README.md)，线上是否生效必须核实。
- **带证据**：PR 模板里有 `Proof` 块——贴可复核的测试输出、截图或录屏，不接受「应该没问题」。
- **范围**：一个 PR 只做一件事。重构 + 行为改动请拆开。

## Feature 卡与决策记录（外部贡献者版）

- 产品行为契约在 [docs/features/](docs/features/README.md)。**外部贡献者不需要自己建卡**：改到既有契约时，维护者会在评审中指认对应的卡并要求你对齐；新功能由维护者补卡。
- 只有长期架构、兼容性、持久格式或流程取舍需要在 [docs/decisions/](docs/decisions/README.md) 中记录；普通修复用 PR 说明复现、根因、回归证据和 CI 接线即可。已经确定并完成的决定直接放 implemented，不强制先写 proposed。
- `.cursor/rules/*.mdc` 由维护者维护，不要在 PR 里改。

## 双语文档

- 新内部决策默认单语；已有双语记录和登记在 `scripts/i18n-pairs.manifest.json` 的对继续同步（见 [docs/i18n/README.md](docs/i18n/README.md)）。
- **只懂英文也能贡献**：单语内部记录可直接用英文写在 `.md`；对外配对文档由维护者协助翻译。pending 仅暂缓已有完整配对的摘要过期，不能代替缺失译文或结构核对。

## Issue

- 用模板：Bug / Feature 两类（`.github/ISSUE_TEMPLATE/`）。Bug 请给版本号、复现步骤、日志或截图。
- 安全漏洞不要公开开 Issue——见仓库 Security 说明或私信维护者。

## 许可

MIT。提交即视为同意以本仓库许可证发布。
