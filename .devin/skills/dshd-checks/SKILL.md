---
name: dshd-checks
description: 定位 WhaleIsle 现有验证工具；执行顺序、风险选择和停止规则由唯一维护准则定义。
---

# WhaleIsle 验证工具入口

[维护准则](../../../docs/maintenance/README.md)是唯一项目维护准则。本技能只定位工具，不新增测试清单、审批、覆盖率指标或执行顺序。

## 工具定位

- 模块行为：从负责功能卡的 Gates 和现有测试寻找能区分原故障的入口，检查实际测试发现与 skip 条件。
- 实际操作：使用对应 UI、命令、文件、窗口、安装和系统状态工具；所需 live 场景选择严格入口，读取实际结果。
- 维护结构：相关 verify 工具；同时需要两个模式时可用 `node scripts/run-gates.mjs governance doc-sync` 去重。
- 本地命令：`node scripts/run-final-gates.mjs --list` 定位可选入口，`--only name,name` 执行已选择的命令。
- Git 接线：`node scripts/install-git-integrations.mjs --check` 核对配置；缺失时按准则修复。
- 最终 CI 准备：`node scripts/run-final-gates.mjs --check-local-qa <full-sha>` 检查现有记录一致性，另核实实际覆盖和真实历史。
- 上游合并：步骤、冲突裁定和合并后验证见[维护准则的上游合并一节](../../../docs/maintenance/README.md#上游合并与差异保护)。
- 候选与原包：按[发布操作说明](../../../docs/handbook/modules/release-process.md)执行。

命令成功只说明它实际检查的范围。`--list`、hook 或记录校验不是行为通过证明；新增工具的理由与验证范围按维护准则确定。