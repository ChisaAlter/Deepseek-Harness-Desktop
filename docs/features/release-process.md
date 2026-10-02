# 开发与发布

产品修改在工作分支完成，经 PR 由用户确认合入 main。开发 CI 检查相关行为和实际装配；版本增加后自动发布成功 CI 的安装包。维护职责见[维护说明](../maintenance/README.md)，操作和失败重试见[发布说明](../handbook/modules/release-process.md)。

## 必须保持的结果

- 发布资产来自成功的 main 开发构建，版本、tag、更新信息和文件字节一致。
- 已发布版本不覆盖，上传重试复用原包。
- 用户数据、产品能力和有效故障复现不能为了通过检查而删减。
- 如实区分源码测试、打包启动和实际安装结果。

## 实现位置

`.github/workflows/test.yml`、`.github/workflows/release.yml`、`scripts/ci-scope.mjs`、`scripts/publish-release.mjs`、`scripts/check-release-assets.mjs`。

## 历史

旧候选、计划和签署记录保留在 [QA 资料](../qa/production-acceptance-test-cases.md) 及历史决定中，不再参与执行。
