# 核心行为回归

开发 CI 在上游代码或共享依赖变化时运行已有 GUI、模型、工具、会话、控制器、工作区和子代理测试，并验证实际构建后的桌面装配。入口是 `.github/workflows/test.yml`。

相关源码测试与真实调用路径继续保留；不再用另一套正则测试固定工作流步骤的名称、数量和顺序。纯文档不运行核心矩阵。执行方式见[维护说明](../maintenance/README.md)和[发布说明](../handbook/modules/release-process.md)。

历史回归原因见[原修复记录](../decisions/implemented/bug-fix/2026-09-28-release-gui-contract-reconciliation.md)。旧候选与签署规定已退役，历史结果不代表当前版本。
