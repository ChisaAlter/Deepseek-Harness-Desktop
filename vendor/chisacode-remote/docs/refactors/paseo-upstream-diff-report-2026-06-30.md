## ChisaCode vs Paseo 上游 全面代码差异报告

> **分析日期**：2026-06-30  
> **ChisaCode 版本**：1.0.2（commit `50fd57f`）  
> **Paseo 上游版本**：0.1.102-beta.1（HEAD `e63a971`，2026-06-29）  
> **同步基线推断**：约 paseo v0.1.97 前后（v0.1.98 开始的多项重大功能未合入）

---

### 总览

ChisaCode 是基于 paseo 的二次开发分支，已完成完整的品牌化（Paseo→ChisaCode）、独立版本号体系（1.0.x），并添加了 Kimi Code Agent、agent 预设系统、自定义 provider 等中国本地化功能。与上游最新 v0.1.102-beta.1 相比，落后期约 **5-6 个版本**（0.1.98 → 0.1.102），存在以下重要功能差距。

| 维度      | 上游总文件数 | ChisaCode 文件数 | 差值 |
| --------- | ------------ | ---------------- | ---- |
| server    | 645          | 575              | -70  |
| app       | 1111         | 1033             | -78  |
| protocol  | 70           | 64               | -6   |
| desktop   | 73           | 60               | -13  |
| highlight | 10           | 8                | -2   |

---

### 上游已有、ChisaCode 缺失的功能

#### 高优先级（high）

| #   | 功能                       | 上游版本        | 影响描述                                                                                      | 证据                                                                                                                                                        |
| --- | -------------------------- | --------------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Provider 配额/用量系统** | v0.1.98         | 无法追踪 Claude/Codex/Copilot/Cursor/Grok/Kimi/MiniMax/Z.AI 共 8 个 provider 的用量配额与余额 | 上游 `server/src/services/quota-fetcher/providers/` 含 8 个 provider 文件；`app/src/provider-usage/` 含 11 个 UI 文件；ChisaCode 两目录均不存在             |
| 2   | **Docker 官方镜像**        | v0.1.102-beta.1 | 无法容器化部署                                                                                | 上游 `docker/` 目录含 `Dockerfile.agents.example`、`docker-compose.example.yml`、`base/`；ChisaCode 根目录无 docker/                                        |
| 3   | **故障排查报告一键复制**   | v0.1.101        | 用户无法从设置页复制含主机/daemon/provider/日志的完整诊断报告                                 | 上游 `app/src/components/app-diagnostic-sheet.tsx` + `app/src/diagnostics/app-diagnostic-report.ts` 含完整格式化+Clipboard 复制逻辑；ChisaCode 无这两个文件 |
| 4   | **ja/pt-BR i18n**          | v0.1.101        | 仅支持 zh-CN + en，缺少日语和巴西葡语                                                         | 上游 `app/src/i18n/resources/` 含 8 语言文件（ar/en/es/fr/ja/pt-BR/ru/zh-CN）；ChisaCode 仅 `index.ts` 内联 zh-CN 和部分 en                                 |
| 5   | **Syntax 主题系统（8套）** | v0.1.98+        | 语法高亮仅限 GitHub 单主题，缺少 7 个替代主题                                                 | 上游 `highlight/src/themes.ts`（298 行）定义 github/catppuccin/dracula/tokyo-night/one/nord/gruvbox/solarized 八套主题；ChisaCode 无 themes.ts              |

#### 中优先级（medium）

| #   | 功能                              | 上游版本        | 影响描述                                              | 证据                                                                                                                                                             |
| --- | --------------------------------- | --------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 6   | **Ultracode (Claude 超深度推理)** | v0.1.98         | Claude 用户无法使用 Ultracode 模式                    | 上游 `claude/agent.ts` 含 `type ClaudeThinkingOption = 'ultracode'` 及 `resolveThinkingConfig()` 逻辑；ChisaCode grep ultracode 无命中                           |
| 7   | **自定义 Copilot agent**          | v0.1.100        | 无法选择自定义 Copilot agent 配置                     | 上游新建 `copilot-acp-agent.ts` 含 `COPILOT_AGENT_FEATURE_OPTION`；ChisaCode 无此文件                                                                            |
| 8   | **Shift+Tab 模式切换**            | v0.1.100        | 需通过下拉框切换 Agent 模式，无键盘快捷方式           | 上游 `keyboard-shortcuts.ts` 含 `message-input-mode-cycle-shift-tab`：`combo: 'Shift+Tab'` 绑定；ChisaCode 无 `keyboard-shortcuts.ts` 文件                       |
| 9   | **Claude 图片工具结果渲染**       | v0.1.101        | Claude agent 生成的图片工具结果无法在聊天中渲染为图片 | 上游 `claude/agent.ts` 含 `splitClaudeToolResultImages` 处理 image 块 + `agent.image-rendering.test.ts` 测试；ChisaCode 均无                                     |
| 10  | **全局新建工作区**                | v0.1.102-beta.1 | 新建工作区需先打开项目，无法在全局页面直接创建        | 上游 `app/src/hooks/use-global-new-workspace-action.ts` 处理 `workspace.new` RPC；protocol 新增 `workspace.create.request/response` 消息型；ChisaCode 无对应实现 |
| 11  | **C#/Swift/Dart 语法高亮**        | v0.1.102-beta.1 | 这三种语言代码块无高亮                                | 上游 `highlight/src/parsers.ts` 导入 `@replit/codemirror-lang-csharp` + `@codemirror/legacy-modes/mode/swift` + `clike`（Dart）；ChisaCode parsers.ts 无这些注册 |

#### 低优先级（low）

| #   | 功能                      | 上游版本        | 证据                                                                                                                                                                                                                                         |
| --- | ------------------------- | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 12  | **PR 面板完整实现**       | v0.1.99         | 上游 `app/src/git/pull-request-panel/` 含 21 个文件（activity-state/timeline/checks 等）；ChisaCode 自研精简版 `pr-pane.tsx`（~5 个文件）                                                                                                    |
| 13  | **Protocol 级新 RPC**     | v0.1.98-0.1.101 | 上游新增：`provider.usage.list.request/response`、`diagnostics.request/response`、`workspace.create.request/response`、`binary-frames/demux.ts`、`terminalProfiles`/`terminalSubscription` 等协议字段；ChisaCode messages.ts 均无对应 schema |
| 14  | **Provider 诊断模型**     | v0.1.101        | 上游 `app/src/components/provider-diagnostic-models.ts` 解析诊断数据；ChisaCode 无                                                                                                                                                           |
| 15  | **MiniMax provider 集成** | v0.1.102-beta.1 | 上游 quota-fetcher 含 `minimax.ts` 用量追踪 + app 含 `minimax-icon.tsx`；ChisaCode 仅 `minimax-m2.5` 模型字符串用于结构化生成                                                                                                                |

---

### ChisaCode 本地独有修改

| #   | 类别                     | 描述                                                                                                                                                                                                            | 核心文件                                                                                                                                              |
| --- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **品牌化**               | Paseo → ChisaCode 全面重命名：包名 `@getpaseo/*`→`@chisacode/*`、配置 `paseo.json`→`chisacode.json`、Logo `paseo-logo.tsx`→`chisacode-logo.tsx`、IPC 通道 `paseo:*`→`chisacode:*`、CLI 命令 `paseo`→`chisacode` | 全项目 >200 个文件                                                                                                                                    |
| 2   | **Kimi Code Agent**      | 新增中国供应商 Kimi（月之暗面）作为 agent provider                                                                                                                                                              | `server/src/server/agent/providers/kimi-code-agent/*`、`app/src/components/icons/kimi-icon.tsx`                                                       |
| 3   | **自定义 Provider 系统** | 用户可配置自定义模型、合成模型、MCP 服务器                                                                                                                                                                      | `app/src/screens/settings/custom-model-providers-section.tsx`、`custom-models-section.tsx`、`synthetic-models-section.tsx`、`mcp-servers-section.tsx` |
| 4   | **Agent 预设系统**       | 内置 agent 预设目录，快速启动预制 agent                                                                                                                                                                         | `app/src/agent-presets/apply-preset.ts`、`preset-catalog.ts`                                                                                          |
| 5   | **用量统计**             | 本地用量统计视图（非 provider quota，是 agent 侧的 token 消耗）                                                                                                                                                 | `app/src/screens/settings/usage-statistics-section.tsx`、`usage-statistics-model.ts`                                                                  |
| 6   | **生成式 UI HTML**       | 支持在聊天中渲染生成式 HTML 预览                                                                                                                                                                                | `app/src/components/generative-html-preview.tsx`、`generative-ui-html.ts`                                                                             |
| 7   | **GitHub Release 更新**  | 从 `ChisaAlter/ChisaCode` 仓库拉取更新                                                                                                                                                                          | `app/src/updates/github-release-updates.ts`                                                                                                           |
| 8   | **安全加固**             | Electron 沙箱安全检查（拒 unsafe flags、未信任 IPC 发送方、`CHISACODE_HOME` 外路径）、0.0.0.0 绑定密码告警                                                                                                      | `desktop/electron/*`                                                                                                                                  |
| 9   | **zh-CN 本地化优先**     | i18n 精简为 zh-CN 为主，内联单文件（135KB）架构，`VALID_APP_LANGUAGES` 仅 `['zh-CN', 'en']`                                                                                                                     | `app/src/i18n/index.ts`                                                                                                                               |
| 10  | **品牌 UI 组件**         | 液态霓虹背景、思考消息、会话列表、命令中心增强、错误边界                                                                                                                                                        | `app/src/components/liquid-neon-backdrop.tsx`、`thought-message.tsx` 等                                                                               |

---

### 同步优先级建议

| 优先级 | 功能                        | 理由                                                                                                           | 工作量估计                          |
| ------ | --------------------------- | -------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| P0     | Provider 配额/用量系统      | 多 provider 用户强需求，ChisaCode 已有自定义 provider 配置，配额视图是自然延伸；上游已完成 provider 无关化设计 | 大（server + app 两包，约 20 文件） |
| P1     | Claude 图片工具结果渲染     | 功能缺口明显，仅需补 claude agent 渲染逻辑 + 测试                                                              | 小（约 3 文件）                     |
| P1     | Shift+Tab 模式切换          | 小改动、高频交互提升                                                                                           | 小（约 2 文件）                     |
| P2     | 故障排查报告一键复制        | 诊断片段 framework 已有，整合即可                                                                              | 小（约 2 文件）                     |
| P2     | C#/Swift/Dart 语法高亮      | 仅需在 highlight 包注册解析器 + 依赖                                                                           | 极小（1 文件 + 3 依赖）             |
| P2     | Syntax 多主题系统           | 提升代码块视觉效果                                                                                             | 中（约 3 文件）                     |
| P3     | Docker 镜像                 | 容器化部署场景价值高                                                                                           | 大（新增 docker/ 目录 + CI）        |
| P3     | ja/pt-BR i18n               | 仅当恢复多语言策略时有意义；当前 ChisaCode 策略明确聚焦 zh-CN                                                  | 中（约 10 文件）                    |
| P4     | Protocol 级 RPC schema 同步 | 保持与上游协议兼容，减少未来 merge conflict                                                                    | 持续/小（逐 RPC 审核）              |

### 风险与注意事项

1. **品牌化冲突**：所有含 `paseo`/`Paseo`/`getpaseo` 标识符的上游新代码直接 merge 会编译失败，需逐文件映射到 `chisacode`/`ChisaCode`/`ChisaAlter`
2. **协议兼容性**：上游新增了多个 RPC message schema（provider.usage.list、diagnostics.request、workspace.create.request），若 server/app 只合入一侧会导致 client-daemon 协议断裂
3. **i18n 架构分歧**：上游是分离文件多语言架构，ChisaCode 是内联单文件，任意上游 i18n 改动都无法直接合入
4. **AGPL 合规**：上游 0.1.102 新增 `claude-duck` DuckDuckGo 搜索集成、Docker 镜像发布，合入时需确保 NOTICE 记录准确
5. **CI 管线差异**：ChisaCode 移除了上游 `deploy-website.yml` 等 workflow，合入 CI 相关更改时需人工比对
