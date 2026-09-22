# dsh-v0.1.2-alpha.4 防降级合树与本地发布构建

> 目标：把 vendored DeepSeek Harness 一跳推进到官方
> `dsh-v0.1.2-alpha.4`（`4e84901e6471b79ec0338099867ebb4606d12bb5`），
> 保留桌面 leftover 与 Host 合同，完成门禁并产出本地可发布安装包。
> 不创建 GitHub Release，不推送新版本；桌面根版本仍由独立发版计划管理。

## 约束

- 源码 pin 从 `0.1.2-alpha.2` 一跳到 `0.1.2-alpha.4`，不漂 `master`。
- 合树范围只允许 `vendor/deepseek-harness/**` 与 pin 文件；手机、sidecar、
  Electron 壳和 `src/main/config.js` 的远程改动保持现状，不在本卡解禁或修 DEF-*。
- 冲突裁决：官方类型、视觉、turn rail、性能和 `SessionSeq` 取上游；归档删除、
  消息编辑、composer 宽度、透明主题、SettingsSelect、标题栏日志和桌面组合保留。
- alpha.4 已移除 `session-persistence-sqlite` 与旧 invariant companion，不复活；
  `session-query-sqlite` overlay 必须保留。
- 禁止继续读取 `Session.events`；统一迁移到 `snapshotEvents()`、`eventAt()`、
  `seq` / `SessionSeq` / `SessionLogOffset`。
- 不修改根 `package.json` 桌面版本、安装包 README 钉、NSIS 或 release workflow。
- 任何提交或构建都不得 push；最终只报告本地产物和校验信息。

## 执行清单

- [x] 完成 alpha.4 tag/SHA 核对和 dry-run 定价。
- [x] 在 isolated worktree 中完成真实合树，主树回写 alpha.4 vendor 与 pin。
- [x] 清理 alpha.2-only persistence/invariant 路径，恢复官方 alpha.4 结构。
- [x] 迁移已触及 leftover 的 `SessionSeq`、`snapshotEvents()` 和 persistence test double。
- [x] 补回桌面 fork 包在 alpha.4 TypeScript facade 中的 source aliases。
- [x] 19 个 `DESKTOP_PACKAGES` 版本统一为 `0.1.2-alpha.4`，更新 live fork 断言。
- [x] `pnpm install --frozen-lockfile` 与 `npm run setup:harness` 通过。
- [x] `assertDesktopForks(alpha.4)`、桌面 `npm test`、vendor 焦点测试、`test:gui`
  和三组 keyless e2e 通过。
- [x] 校对 Host/mux/tunnel/query-sqlite 合同；`REMOTE_FEATURE_ENABLED=false`，不改远程产品范围。
- [x] `smoke:source` 与文档 pin 更新完成；需要密钥的人工新能力抽检未执行。
- [x] 清理 sync worktree、backup ref 和状态文件。
- [x] 运行本地 Windows NSIS 发布构建，确认安装包存在且可校验；不发布、不推送。

## 已知合树附录

- dry-run 校验：`dsh-v0.1.2-alpha.4` 与 `4e84901` 一致，冲突集中在 session
  API/client、ui-chat/ui-conversation、theme/layout、models、bundle composition
  和旧 SQLite persistence。
- 合树后保留的同步临时状态必须等所有门禁通过后清理，不能用 `--abort` 代替成功收口。
- alpha.4 的 host 类型构建曾因桌面新增包没有进入 `tsconfig.base.json` source alias
  而误报 `McpServerRecord` 未导出；已补齐 `mcp-servers`、`skill-inventory`、
  `llm-vision-fallback` 和 `mcp-servers-file` aliases，定向 host build 已通过。

## 验收记录

| 检查 | 结果 |
| --- | --- |
| Pin | `dsh-v0.1.2-alpha.4` / `4e84901e6471b79ec0338099867ebb4606d12bb5` / `0.1.2-alpha.4` |
| Host build | 已通过定向 `pnpm run build:lib:host` |
| Desktop fork assertion | 通过 |
| Desktop/vendor tests | `npm test`: 1461/1463（2 skip）；`test:gui`: 5310/5311（1 skip） |
| Keyless e2e | headless + SDK + ACP：7/7 通过 |
| Source smoke | 通过；UI/titlebar/Git/surfaces/PTY |
| Windows installer | `dist/Deepseek-Harness-Desktop-Setup-0.2.8.exe`（782,952,336 bytes），SHA256 `f1bad46920a95c71a55ca2642dcf1a938ef20369f0d251c09d8cfa227eee0cc4`；blockmap SHA256 `37079750b9569e596070d138a0c98a4c3812480885e1ab68f6f6bf434c9ed7bd` |
| Release/push | 明确不执行 |
