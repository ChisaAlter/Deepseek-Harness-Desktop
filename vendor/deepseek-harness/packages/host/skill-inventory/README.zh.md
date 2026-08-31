# @deepseek-ai/dsh-host-skill-inventory

[English](README.md) | 中文

为 Settings 的 Skills 页提供 Host Remote `skillInventory`。每个方法都接受可选的 `cwd` 与 `sessionId`。提供 `sessionId` 时，网关只读解析该精确存活 Agent，并读取该 Agent 所见的分层 `ctx.skills` 视图（含 standard preset 的 filesystem provider）；它不会创建或恢复 Agent，缺少存活 Agent 时抛出类型化的 `session-not-found`。`list` 与 `get` 不过滤 composer 的 `isUserInvocable`，并补上 `path`、`source` 与 `writable`；条目还携带 `groups`（Settings 持有的分组标签列表，一个技能可属于多个分组）与 `directory`（技能文件所在目录，供“打开目录”动作使用）。`create` 按调用方选择的模型/用户初始调用开关，写入 `$DSH_HOME/skills/<name>/SKILL.md` 或 `<project-root>/.dsh/skills/<name>/SKILL.md`（`project-root` 是 `cwd` 最近的 `.git` 祖先，否则就是 `cwd` 本身）。`update`、`delete` 与 `setInvocation` 只写 `user-dsh`、`user-agents`，以及在提供 `cwd` 时的 `project-dsh` / `project-agents`。更新正文或只改调用开关都会保留未知 frontmatter 字段；删除会移除整个技能目录。启停沿用已有 frontmatter：`disable-model-invocation` 与 `user-invocable`。bundled、runtime 与 custom skill 只读。

分组标签存放在 frontmatter 的 `metadata.group`（`create` / `update` 接受可选的 `groups` 列表，传空列表即清除）。读取同时接受标量标签或列表并做归一化（去空白、去重、保序）；Settings 写入 YAML 列表。它复用 filesystem provider 的开放 `metadata` 对象，因此 Settings 只拥有这一个键：同级的 metadata 字段、未知顶层字段以及非对象形式的 metadata 值都会被保留或原样不动，无需改动技能 schema。

该服务仅供 Remote 使用。Client 包通过 [`api-remotes`](../../api/remotes/README.zh.md) 消费。composer 的 `skill.list` RPC 不变。

## 模型体验

无，因为这个 Host Remote 不注册提示词、工具、消息或提供方请求。

#### KV Cache 影响

无；本包从不组装模型输入。

## 已知限制与暂缓事项

- **没有 skill 市场** — 创建只写本地文件；从目录安装不在范围内。
- **创建后不可改名** — 重命名等于删除再创建。
