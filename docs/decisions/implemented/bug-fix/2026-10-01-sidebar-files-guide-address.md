# Decision: Files 目录入口与旧查看器地址恢复

Status: implemented

中文 | [English](2026-10-01-sidebar-files-guide-address.en.md)

## Problem

右栏 guide 同时展示「文件」和「文件查看器」，但查看器入口没有具体文件。恢复或点击该入口后，`sidebar://desktop-file` 被传入文件读取，出现 ENOENT。用户要求只保留目录入口，并保持已有文件页签和草稿。

记录审计：[单一右栏](../architecture/2026-09-28-single-panel-in-place.md)保留宿主与页签生命周期；[DSHD 右栏外观](../product/2026-09-23-right-sidebar-dshd-guide.md)保留视觉来源，其旧双栏方案由前者接管；[项目审查修复](2026-09-30-project-audit-fixes.md)保留有效文件的保存与草稿约束。三者均部分重叠，本次没有完全取代的记录。

## Decision

Files 只注册「文件」目录 guide；`desktop-file` 仍处理具体 Session 文件资源，不注册独立 guide。旧无文件查看器、Sidebar 内部地址、absolute 或畸形地址、空根资源不挂载文件编辑器、不执行文件读取，主体直接复用标准 `SidebarFilesPanel`。所属 Session 来自槽位的标准 share，不借用当前前台会话；同 key 的标题组件显示 Files 本地化标题，有效文件仍显示 `resourceTitle`。

兼容呈现只列出所属 Session 的目录，保留页签记录、pane、expanded 与浮窗状态，不调用会展开、激活或把浮窗移回 dock 的替换动作。有效文件资源的地址、页签身份、缺 cwd 时的草稿保留与保存队列不变。没有持久布局迁移或存储格式版本变更。

## Alternatives considered

- 通过标准替换动作把旧查看器改为 `files`：能够正规化地址并复用目录页去重，但既有 planner 会展开、激活右栏并把浮窗移回 dock，改变隐藏或浮窗状态；原位兼容呈现避免这些副作用。
- 启动时重写或删除所有 `desktop-file` 页签：能提前清除旧占位地址，但会扩大持久布局迁移范围，并触及有效文件与草稿；保留记录仅调整无文件页的呈现。

## Consequences

用户从一个目录入口选择具体文件，旧查看器地址不再进入文件读取。旧占位记录仍存在，因此需保留兼容主体和标题；目录展示使用既有文件树能力。回归覆盖 guide 清单、真实布局恢复、跨 Session 归属、隐藏与浮窗状态，以及有效文件和缺 cwd 草稿不变。

验证：真实 Guide / registry / controller / keyed body 与布局恢复回归 9/9、既有 adapter / apply 16/16；变更源码/测试窄 lint、`ui-files` 类型构建和 client catalog 检查通过。文档配对与门禁通过；这些结果不代表新安装包验收。
