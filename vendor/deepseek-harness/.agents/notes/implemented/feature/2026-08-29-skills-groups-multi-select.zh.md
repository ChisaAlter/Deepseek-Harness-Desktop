# Agent Note: 技能分组支持多选，组开关即时回显

Status: implemented

[English](2026-08-29-skills-groups-multi-select.md) | 中文

## 问题

技能设置的分组是单值标签，编辑器是单选组合框，一个技能无法同时属于两个分组。三个交互问题叠加：组开关要等全部 frontmatter 写盘完成才翻转，点击没有可见响应；停用分组会自动折叠分区，把刚停用的行藏起来；分组输入框实测只有 163px——Menu 的 `inline-flex` root span 落在普通 block 容器里时按固有宽度收缩。另外，启动失败的会话（例如会话日志损坏）会让整个技能目录页以 `session-not-found` 报错。

## 决策

- **数据模型。** wire 字段 `group?: string` 在 `SkillInventoryEntry`、`SkillInventoryDetail` 与 create/update 请求上改为 `groups?: readonly string[]`。SKILL.md 保留 `metadata.group`：读取接受标量标签或列表，并在 `normalizeMetadataGroups` 归一化（去空白、丢空值、去重、保序）；Settings 写入 YAML 列表，空列表清除；`update` 省略 `groups` 表示不动已存标签。手写的标量读取为单元素列表，既有文件零丢失。
- **分区。** 一个技能在它携带的每个分组标签的分区里各渲染一次（首现顺序，未分组最后）；结果计数仍按技能条数；搜索命中任意标签。
- **编辑器。** `GroupTagPicker` 取代组合框：已选标签渲染为可移除的标签，下拉列出目录分组并打勾（`Menu` `selectedIds`），切换后菜单保持打开，输入新标签加回车或逗号即添加，另有一行一键清空。字段外包 `.groupFieldShell { display: grid }`，把 Menu root span 撑满字段宽度，Playwright 实测输入框从 163px 恢复到 614px。
- **组开关。** 点击立即翻转全部可写行（乐观回显，不等写盘）；每行的写盘仍走 `setInvocation`，失败的行回退到各自原值并显示行内错误。批量进行中开关保持禁用。停用不再折叠分区；展开/收起只归分区头。
- **目录降级。** 会话作用域读取失败时，客户端回退全局目录并显示 `sessionCatalogUnavailable` 提示；全局读取也失败才显示错误视图。网关保留 typed `session-not-found` 契约——它同时服务移动端 Remote，在那里静默降级会掩盖会话分层。

## 考虑过的方案

**改用新的 `metadata.groups` 键。** 否决：`metadata.group` 是 Settings 持有的既存数据，读取侧归一化标量即可完成迁移，不需要重写脚本。

**组开关沿用写盘完成后再更新。** 否决：每行一次文件写入让点击到反馈的延迟肉眼可见；乐观回显加逐行回退在失败时仍保持服务端权威。

**网关在 Agent 缺失时静默回退全局注册表。** 否决：全局注册表缺少项目技能分层，回退会静默少显示技能且无信号；`session-not-found` 是共用契约。

**停用后保持折叠并置灰。** 否决：用户需要看到刚停用的行。

## 后果

- `ui-settings-skills` 的注入 face 与 `dsh-host-skill-inventory` 的 wire 类型同步携带 `groups`；Typert 生成的 schema 在重建后跟随。
- 手改标量 `metadata.group` 的文件照常读取；下一次 Settings 保存写回列表形式。
- Client spec 覆盖选择器、多分区渲染、标签移除、乐观回显与回退、停用不折叠、目录降级；宽度实测记录在桌面功能卡。

相关：[技能设置的分组与打开目录动作](2026-08-23-skills-settings-grouping.zh.md)（存储键与分区机制延续；标签数量、选择器与组开关行为由本篇取代）、[MCP 与技能设置](2026-08-14-mcp-and-skill-settings.zh.md)。
