# 贡献指南

中文 | [English](CONTRIBUTING.en.md)

使用工作分支提出 PR，在描述中说明需求、变化和相关验证。由维护者确认合入 main。开发 CI 自动运行；需要发版时在同一个 PR 更新版本与发布说明，main 检查成功后自动分发。

本地运行与改动相关的已有检查。`npm test` 是产品行为测试，`npm run test:tools` 是工具测试。真实 UI、安装或数据行为按本次影响实际观察，不要求在本机复制整个 CI，也不要求填写候选验收或签字记录。

项目地图见[手册](docs/handbook/README.md)，当前工作方式见[维护说明](docs/maintenance/README.md)，发版和重试见[发布说明](docs/handbook/modules/release-process.md)。行为或长期取舍改变时更新对应资料；普通修复不要求新卡片、决策记录或双语配对。

Bug 请提供版本、复现步骤和相关日志。不要公开提交凭据或用户私人数据。贡献按本仓库 MIT 许可证发布。
