# @deepseek-ai/dsh-client-ui-settings-skills

[English](README.md) | 中文

Web Settings 栏目 `skills`（order 16）。页面把 `ctx.remote.skillInventory` 呈现为可搜索的发丝目录，带一个来源筛选。每次 Remote 调用都会带上当前 session 的 `sessionId` 与 `cwd`，让 Host 读取该存活 Agent 的分层目录。可写行提供模型调用 Switch、打开现有编辑器，并提供删除；只读行没有删除。创建可选择用户根或活动项目的 `.dsh/skills` 根，并接受初始调用开关。目录会响应当前 session 变化，并抑制上一个 session 或项目的迟到响应。composer 的 `/` 选择器仍使用 `skill.list`。

页头还会打开由 Host `gh skill search` 与 `gh skill install` Remote 支撑的 GitHub Skill Hub。搜索结果展示精确的公开仓库、路径、描述与 stars。安装目标可选用户 DSH 根或活动项目的 `.dsh/skills` 根；执行前必须在确认视图中核对来源和作用域，不传覆盖参数，成功后刷新本地目录。GitHub CLI 缺失、版本过旧和仓库冲突会保留显示在弹窗中。

带有分组标签（`metadata.group`）的技能会按分组渲染为树状节点：分组按首次出现顺序排列，未分组行以“未分组”节点排在最后；全部分组为空时保持平铺列表。节点可展开/折叠，状态存 sessionStorage 并在刷新后保留。每个组节点带一个“模型调用”总开关，批量切换组内所有可写技能（持久化到各自 frontmatter）；停用后整组折叠并置灰，全只读的组开关禁用。创建/编辑弹窗的分组输入是可编辑下拉：列出目录中已有分组供选择（含“留空”清除项），也可以直接输入新分组名；搜索也会匹配标签。带有磁盘路径的行提供“打开所在目录”按钮，经注入的 `openDirectory`（`workspaces.openPath`）交给宿主用系统默认程序打开该目录。

## 模型体验

无，因为这个浏览器 Settings 页不注册提示词、工具、消息或提供方请求。

#### KV Cache 影响

无；本包从不组装模型输入。

## 已知限制与暂缓事项

- **Skill Hub 需要 GitHub CLI** — `gh` 缺失或版本过旧、不支持 `gh skill` 时，本地创建与编辑仍可使用。
- **preset 目录需要存活 session** — 没有当前 session 时页面既不发送 `sessionId` 也不发送 `cwd`，Host 回退到全局 skill 层，standard preset 的项目/捆绑根不会出现。

不发布运行时 invariant companion；本包不拥有独立的持久事件关系，UI 或服务行为由聚焦的包测试覆盖。
