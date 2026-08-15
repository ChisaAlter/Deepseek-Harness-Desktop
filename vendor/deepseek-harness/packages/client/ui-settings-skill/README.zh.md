# @deepseek-ai/dsh-client-ui-settings-skill

[English](README.md) | 中文

技能设置页：浏览 Harness 已知的全部技能，并创建、编辑、删除用户自己的技能。

本页渲染主机 [`@deepseek-ai/dsh-skill-admin`](../../skill/skill-admin) 服务经 `skills.catalog` 管理 RPC 提供的目录。用户自有（用户根目录）技能带编辑与删除操作；其他来源的技能只读展示并标注来源。创建与编辑共用同一对话框，内含与主机一致的命名语法与调用开关。

## 模型体验

页面本身不触达模型。此处写入的调用开关（`modelInvocable` / `userInvocable`）决定哪些目录会列出该技能：模型侧工具目录与输入框 `/` 菜单。此处保存的技能与其他技能一样经同一个 `skill` 工具提供服务。

## 已知限制与延后工作

- 仅用户根目录（`$DSH_HOME/skills`）技能可编辑；项目与内置技能只读展示。
- 页面展示主机平面目录；项目级技能按会话出现在 `/` 菜单中。
