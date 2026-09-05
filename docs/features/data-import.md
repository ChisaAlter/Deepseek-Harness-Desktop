# Feature: Official home import

| Field | Value |
| --- | --- |
| **id** | `data-import` |
| **status** | `active` |
| **last verified** | 2026-09-05 — 历史会话恢复与插件归因定向检查：Harness 工作区/API/旧缓存 121 项、桌面导入/恢复/打包单测 171 项通过；重新登记已有目录接纳导入历史，缓存格式错误不归咎用户插件。未执行候选安装包升级实测。此前：2026-08-25 — 新增设置白名单节 / 引用凭据 / `.agent-presets` / home `AGENTS.md` 导入；冷启动闸门改 shallow probe；导入页展示「将迁移/不迁移」说明 |

## User paths

1. 启动器「导入」自动只读扫描官方 `~/.dsh`（会话、附件、`profiles/web/package.json` 插件名单、`skills/`、`mcp-servers.yaml`）以及 `~/.agents/skills`。
2. 「选择目录」另加一个按 home 布局扫描的来源；「添加技能目录」把含 `SKILL.md` 的根并入技能列表。不扫项目仓库，除非用户主动选中该文件夹。
3. 导入页用分类页签勾选会话 / 技能 / 插件 / MCP / 设置 / 预设，默认可导入项全勾。会话按工作区分组：展示真实 `cwd` 或「无工作区」、对话标题（否则 id）；≥8 项的组默认折叠。扫描**不列出** harness 预设夹 `_no-cwd/preset-*`（非用户对话）。空选点导入 = 不写盘。落点固定桌面 `userData/dsh-home`。导入页固定展示「将迁移/不迁移」说明（不迁移：工作区工程树、`profiles/`、`node_modules`、`storages/` 内部状态、旧 SQLite 会话库、OAuth 会话态、未被引用的凭据）。
4. 插件只按名单 `dsh plugin add` 重装，不拷 `node_modules` / `desktop-plugins`。支持两条受控通道：`github:owner/repo[#ref]` 与官方 registry semver（重装为 `name@<semver>`，含 `^`/`~`）。本地 `file:` / `link:` / `workspace:`、模板包、已下架包、其余规格（tarball URL、dist-tag、npm alias 等）在扫描时预标禁用行（`unsupported`），UI 灰置并给理由，勾不了也不会送进 `pnpm add`。已安装项标「已安装」。
5. MCP 按 id merge 进桌面 `mcp-servers.yaml`（含 header/token）；UI 与日志不展示密钥，列表标启用/停用。附件整树拷 `attachments/`。
6. 设置页签列出官方 `settings.yaml` 中存在的**白名单节**（`llm-deepseek` 模型与提供方、`llm-pi-ai` 自定义提供方、`agent-default-model` 默认模型、`vision-fallback` 视觉回退、`ui-theme` 主题）以及 home 级 `AGENTS.md`（全局指令）。整节**文本级**搬运进桌面 `settings.yaml`：目标已有同名节默认跳过，勾选覆盖才替换；不做字段级 merge。勾选含 `llm-deepseek` / `llm-pi-ai` 的节时，自动同步这些节**引用到**的 `.credentials.yaml` `refs` 凭据条目（`apiKeyEnv`，`llm-deepseek` 隐式默认 `DEEPSEEK_API_KEY`）；密钥只落盘（0600），UI / 日志 / journal 只出现引用名。
7. 预设页签列出官方 `.agent-presets/<id>/`（含 `agent.cordis.yml` 的目录，id 须匹配官方 `[a-z0-9][a-z0-9-]*`），按目录拷贝到桌面 `.agent-presets/`，冲突默认 skip，路径安全同 skills。
8. 导入时若桌面端在跑：先停内核。导入本身幂等（conflict 默认 skip）。崩溃续跑：冷启动闸门消费 `phase:'copying'` 的 journal——清理桌面 home 下残留 `.import-tmp` staging 目录、journal 改写为 `recovered`、启动器停在导入页并提示可安全重跑。

## Invariants

- 官方 `~/.dsh` 与 `~/.agents` **只读**：不写、不删、不清理。
- Harness / PTY / Electron `process.env.DSH_HOME` 仍不准指向官方 home。
- 不拷工作区工程树、项目 `.dsh/skills`（除非用户把该目录选进来源）、`profiles/`、`storages/` 内部状态、旧 SQLite 会话库。`settings.yaml` 只迁移上述白名单节（整节文本级，非白名单节永不写入）；凭据只同步被所选 llm 节引用的 `refs` 条目，`.credentials.yaml` 的 `records`（OAuth 会话态 / 刷新令牌）与未引用条目不迁移。
- 设置节与凭据条目为**文本级**搬运：不解析嵌套字段、不改写来源文本；跨节 YAML 锚点引用不受支持（已知限制）。凭据只接受 `refs` 下的单行标量条目；目标 `.credentials.yaml` 以 0600 写入。
- 冷启动闸门用 `probeImportHold` 浅探针（destEmpty && sourceHasData，首个命中即返回，不读会话元数据 / 不解压 zstd）；完整 `scanImport` 只在导入页使用。
- 不改会话文件夹名、不改写 jsonl。旧 rc `.db` 标不兼容并跳过。
- 导入会话保留原 `cwd`；已有桌面工作区不会触发首次启动的历史分组。导入后通过重新添加原目录恢复归属（新建或已登记目录均刷新索引，见 [no-directory-sessions](no-directory-sessions.md)）；不猜测迁移后的盘符或目录，不导入来源工作区内部 storage。
- 列表展示可读写会话 header / `session/title`（明文 jsonl 或 Node 内置 zstd）；勾选与拷贝键仍是 sessions 相对路径 `rel`，不得用标题改名落盘。
- `runImport` 必收勾选；省略选择 = 零写入。路径穿越与源根外技能路径拒绝落盘。
- 插件重装规格只允许 `github:owner/repo[#ref]` 或 `name@<semver>`（`installImportPlugin` 受控通道，仅主进程 LAUNCHER IPC 使用）；渲染进程 / 工具的 `installPlugin` 通道保持 github-only。
- journal 在 `userData/import-journal.json`，不在 `dsh-home/sessions` 里。`recoverInterruptedImport` 只清 journal 自己的 destHome 且必须等于当前桌面 home；官方来源仍只读。
- 已知权衡（MCP 凭据）：MCP merge 原样拷贝 header/token 进桌面 `mcp-servers.yaml`（明文，与官方 CLI 相同的落盘形态）；OAuth 类服务器的会话态/刷新令牌不迁移，导入后可能需在桌面端重新授权。桌面不回写官方文件。
- 已知限制（storages）：官方 `storages/`（storage-json / storage-sqlite 后端的插件内部状态）**不迁移**——格式归 harness 内部所有、可能跨版本变更，且与会话数据不同没有稳定的冲突键；导入后相关插件从空状态重建。

## Allowed touch

- `src/main/data-import.js` 与其单测
- 启动器导入页 UI（`src/renderer/launcher.*`）
- `src/main/ipc.js`、`src/preload/index.js` 与其单测
- `docs/features/dsh-home.md` / `desktop-launcher.md` 只读扫描例外
- `.cursor/rules/data-import-product.mdc`

## Do not touch

- vendor 会话格式
- 自动静默迁移（无用户确认不得拷）
- 把桌面 `DSH_HOME` 指回 `~/.dsh`

## Gates

| Kind | What |
| --- | --- |
| Automated | `data-import` 与 IPC 勾选转发单测 |
| Manual / QA | `TC-LAUNCH-004` |

## Sources

- Implementation：`src/main/data-import.js`、`src/renderer/launcher.js`
