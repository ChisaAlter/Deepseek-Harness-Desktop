---
name: dshd-maintenance
description: 按 WhaleIsle 唯一维护准则维护负责契约、当前事实和必要长期记录。
---

# WhaleIsle 维护工具入口

[维护准则](../../../docs/maintenance/README.md)是唯一项目维护准则。本技能提供操作定位，不另建门槛、自检清单或流程。

## 操作定位

- 产品契约及当前验证入口：[功能卡](../../../docs/features/README.md)。
- 当前架构和操作：[手册](../../../docs/handbook/README.md)。
- 确有长期取舍时的记录格式：[决策说明](../../../docs/decisions/README.md)；优先更新负责记录。
- 已有双语配对操作：[配对说明](../../../docs/i18n/README.md)。
- 系统性事故的记录格式：[复盘说明](../../../docs/postmortem/README.md)。
- 验证工具定位：[dshd-checks](../dshd-checks/SKILL.md)。
- 原包交付操作：[发布操作说明](../../../docs/handbook/modules/release-process.md)。

归档工具为 `node scripts/archive-decision.mjs <record> [--superseded-by <new>]`；只用于本次相关且满足准则的记录。模板、技能和历史不构成额外审批，普通修改不为填写记录扩大范围。