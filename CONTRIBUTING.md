# 贡献指南

中文 | [English](CONTRIBUTING.en.md)

DSHD 接受外部 Pull Request 与 Issue。本文件写清门槛，避免贡献者撞上隐形规则。

## 提 PR 前

- **跑测试**：提交直接覆盖修改风险的定向结果；完整 node:test、GUI、核心与平台矩阵由 CI 执行。跨模块修改在候选稳定后集中回归。文档修改运行 `npm run doc-sync`；发布遵循 [发布操作流程](docs/handbook/modules/release-process.md)。
- **检查 Git 集成**：`node scripts/install-git-integrations.mjs --check` 核对实际 hooks / merge driver；缺失时运行同一脚本去掉 `--check`，无需重装依赖。安装会保留已有自定义集成；hooks 检查工作目录，CI 检查实际提交。
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
