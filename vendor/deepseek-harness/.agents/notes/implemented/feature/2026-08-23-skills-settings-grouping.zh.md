# Agent Note: 技能设置的分组与打开目录动作

Status: implemented

[English](2026-08-23-skills-settings-grouping.md) | 中文

## Problem

Skills 设置页把所有已发现的技能渲染为一张平铺的可搜索列表：技能多时没有任何视觉组织手段，而想查看或编辑某个技能的文件（`SKILL.md` 及其附带资源）的用户，只能自己在系统文件管理器里手工定位目录。

## Decision

每个技能在前台 frontmatter 中携带由 Settings 持有的分组标签，页面把行渲染为可折叠的分组树并提供组级启用开关；每行还提供“打开所在目录”动作。自 [2026-08-29](2026-08-29-skills-groups-multi-select.zh.md) 起标签数量不限，选择器是多选 tag picker，组开关乐观回显且停用不再折叠；本篇保留存储键、分区机制与打开目录动作。

存储：标签存放在 filesystem provider 的开放 `metadata` 对象中，键为 `metadata.group`。该 provider 本就把 `metadata` 暴露在 `SkillDefinition` 上、无需 schema 改动，因此 `@deepseek-ai/dsh-host-skill-inventory` 在 `list`/`get` 中读取它，并通过 `renderSkillMarkdown` 写入；后者把标签列表合并进现有 `metadata` 对象：非空归一化列表写入该键，显式空列表删除该键（`metadata` 因此变空时整个键一并删除），非对象形式的 `metadata` 值在未写入分组时原样保留。读取同时接受标量标签或列表并归一化（去空白、去重、保序），手写标量的文件照常工作。`update` 中省略 `groups` 表示“不属于本次写入”，保留当前标签；`create` 把缺失视为未分组。`setInvocation` 从不触碰它。wire 类型新增 `SkillInventoryEntry`、`SkillInventoryDetail` 及 create/update 请求上的 `groups?`，条目上新增 `directory?`（技能文件路径的 `dirname`，在 Host 侧计算，保证 Windows 分隔符正确）。

呈现：客户端把筛选后的行按标签分组，按首次出现顺序排列，未分组行以“未分组”节点排在最后；筛选结果没有任何标签时保持平铺列表；带多个标签的技能在它的每个分组分区里各渲染一次。每个组渲染为树节点：一个披露头（标签 + 计数，带 `aria-expanded`），子行缩进其下；展开状态是组件状态，按组标签存入 sessionStorage、默认展开，损坏或非对象形式的存储状态回退为默认值。每个节点带一个“模型调用”总开关，通过既有逐技能 `setInvocation` Remote 批量切换组内所有可写技能（逐技能持久化）；仅当所有可写成员都启用时开关为开，批量进行中或组内没有可写技能时禁用，全只读组整体禁用开关，关闭时节点置灰（不折叠），行仍可展开并单独编辑。失败按行显示在对应行上，与单行开关一致；会话切换后的迟到批量结果被忽略。创建/编辑弹窗的分组输入是多选 tag picker（已选标签可移除、目录标签勾选且切换后菜单保持打开、回车或逗号新建），见 [2026-08-29](2026-08-29-skills-groups-multi-select.zh.md)；搜索匹配任意标签。带 `directory` 的条目行渲染文件夹图标，调用注入的 `openDirectory`，其实现为 `ctx.workspaces.openPath(directory)` —— 复用已有 `host.openPath` 接缝（系统默认程序打开；桌面上 surfaces 拦截保持其既有的工作区内行为）。

## Alternatives considered

**在核心 skill 包中新增一等 `category` 字段** — 否决。这会改动 `SkillSummary`/`SkillDefinition` 与 filesystem 解析器，为一个仅用于设置页的概念引入模型可见性与快照风险。`metadata` 是获认可的开放容器，且已贯穿发现、加载与写入。

**基于目录的隐式分组** — 否决。标签是用户控制的显式 frontmatter；从来源目录推导分组会让人意外，而且要有第二个概念才支持排序。

**为打开目录新增一个 Remote** — 否决。`host.openPath` 已经会用系统默认程序打开路径；再造一个接缝会重复它的门控与 WSL/浏览器处理。

**页面顶部“打开技能根目录”按钮** — 否决，改为逐行目录。每个技能自己的目录才是查看与编辑其文件的实用目标。

## Consequences

- 分组对模型不可见：标签寄居在 provider 的 `metadata` 上，模型面向的目录从不渲染它。
- 未知 frontmatter 保持原样：`renderSkillMarkdown` 保留同级 metadata 键与非自有字段，清除标签也绝不覆盖非对象形式的 `metadata` 值。
- 只有一个打开接缝：`workspaces.openPath` 与所有其它 open-path 调用方走同一接缝，桌面拦截（工作区内路径进应用内 Files，区外进系统文件管理器）统一适用。
- 树在组件内由已加载快照推导，观看状态只放 sessionStorage；没有新增客户端 store 或宿主端点，组开关复用逐技能 `setInvocation` Remote，对每个可写成员各调一次。

相关：[MCP 与技能设置](../2026-08-14-mcp-and-skill-settings.md)。部分被[技能分组多选](2026-08-29-skills-groups-multi-select.zh.md)取代：标签数量、选择器与组开关回显/折叠行为归该篇所有。
