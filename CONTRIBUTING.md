# 贡献指南

中文 | [English](CONTRIBUTING.en.md)

DSHD 接受外部 Pull Request 与 Issue。本文件写清门槛，避免贡献者撞上隐形规则。

## 提 PR 前

- **跑测试**：`npm test`（node:test 全量）。改动文档另跑 `npm run doc-sync`（配对、死链、决策格式等文档门禁）。
- **首次克隆跑一次 `npm install`**：`prepare` 会装 pre-commit/pre-push hooks 和 i18n merge driver；老克隆在新拉这批治理文件后同样重跑一次。
- **带证据**：PR 模板里有 `Proof` 块——贴可复核的测试输出、截图或录屏，不接受「应该没问题」。
- **范围**：一个 PR 只做一件事。重构 + 行为改动请拆开。

## Feature 卡与决策记录（外部贡献者版）

- 产品行为契约在 [docs/features/](docs/features/README.md)。**外部贡献者不需要自己建卡**：改到既有契约时，维护者会在评审中指认对应的卡并要求你对齐；新功能由维护者补卡。
- 决策记录同理：非琐碎改动的「为什么」由维护者或你在 [docs/decisions/](docs/decisions/README.md) 的 `proposed/` 下记录。想用 PR 提案直接改规则？正常提，讨论在 PR 里进行。
- `.cursor/rules/*.mdc` 由维护者维护，不要在 PR 里改。

## 双语文档

- `docs/decisions/**`、登记在 `scripts/i18n-pairs.manifest.json` 的对，走三件套契约（见 [docs/i18n/README.md](docs/i18n/README.md)）。
- **只懂英文也能贡献**：提交英文稿即可，中文正本由维护者补齐（翻译滞后期会登记 pending）。反过来也一样——中文稿即可，英文副本后补。

## Issue

- 用模板：Bug / Feature 两类（`.github/ISSUE_TEMPLATE/`）。Bug 请给版本号、复现步骤、日志或截图。
- 安全漏洞不要公开开 Issue——见仓库 Security 说明或私信维护者。

## 许可

MIT。提交即视为同意以本仓库许可证发布。
