# @deepseek-ai/dsh-skill-admin

[English](README.md) | 中文

用户技能管理服务：合并用户根目录与注册表的技能清单（带归属标记），并在用户技能根目录下创建、编辑、删除技能。

本包是技能能力侧的写入方。读取与加载仍由 [`@deepseek-ai/dsh-skill`](../skill) 及其 provider 负责；本服务只拥有可写根目录——`$DSH_HOME/skills`（source `user-dsh`）——并拒绝写入会话永远解析不到的技能。

## 服务：`SkillAdminService`（ctx key：`skillAdmin`）

### 公开 API

- `ctx.skillAdmin.list()` 返回可写用户根、只读的 user-agents / 项目 / bundled 根，以及全部注册表摘要。不同来源的同名技能都会保留；同一来源以磁盘扫描为准。仅位于可写用户根的条目带 `owned: true`。
- `ctx.skillAdmin.read(name)` 返回一个 owned 技能的 `{ entry, content }`；名称未指向用户根目录中可解析技能时返回 `undefined`。
- `ctx.skillAdmin.save(input)` 创建或覆盖一个用户技能。写入校验 kebab-case 名称与非空描述；拒绝写入已被其他来源占用的名称（避免文件落在会话永远解析不到的位置）；写出带规范 frontmatter 的 `SKILL.md`（`name`、`description`、`whenToUse`，以及仅在非默认时才写出的 `disable-model-invocation` / `user-invocable` 开关）。
- `ctx.skillAdmin.remove(name)` 递归删除一个 owned 技能的目录（或扁平 `.md`）；拒绝 unowned 名称；不存在时抛 `not-found`。

所有失败均抛出带稳定 `code` 的 `SkillAdminError`：`invalid-name`、`invalid-input`、`shadowed`、`not-owned`、`not-found`。

### 配置

| 字段 | 默认 | 含义 |
|---|---|---|
| `dshHome` | `$DSH_HOME` 然后 `~/.dsh` | 显式指定 harness 主目录；可写用户技能根为 `<dshHome>/skills`。 |
| `agentsHome` | `$DSH_AGENTS_HOME` 然后 `~/.agents` | 共享 agent 配置根；`<agentsHome>/skills` 只读列出。 |
| `projectCwd` | `process.cwd()` | 用于解析 `<project>/.dsh/skills` 与 `<project>/.agents/skills` 的工作区。 |
| `bundledSkillDir` | `$DSH_BUNDLED_SKILL_DIR` | 可选 bundled 技能根，只读列出。 |

## Frontmatter 语法

本服务镜像 [`@deepseek-ai/dsh-skill-filesystem`](../skill-filesystem) 的 frontmatter 语法（`---` 分隔、`name`/`description` 必填、`whenToUse`、`disable-model-invocation`、`user-invocable`），保证每次写入经发现流程原样往返。

## 模型体验

服务本身不直接触达模型；受管技能与任何其他技能一样，经同一个 `skill` 工具与 `/` 命令面提供服务，由上述写入的调用开关决定哪些目录会列出它。

## 已知限制与延后工作

- 仅 `$DSH_HOME/skills` 根目录可写。项目（`.dsh/skills`、`.agents/skills`）与 `~/.agents/skills` 技能只读展示；编辑能力延后。
- 格式损坏的用户技能（YAML 错误、缺字段）会被发现流程与本服务的列表一同跳过；暂无可修复界面。
- 遮蔽检查仍读取全局注册表层。`list()` 现在会扫描 `projectCwd` 附近的项目根，但同名项目技能本身不会阻止写入用户根。
