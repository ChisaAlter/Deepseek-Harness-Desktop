# 模块：构建、钉版与发版

## 职责与非目标

**职责：** vendor harness 钉版、官方 `build:official` 客户端、electron-builder 出包、CI 发版。  
**非目标：** 不在手册复述完整 CI YAML；不把源码钉伪称为已发包装钉。

## 当前版本

`0.2.9`（2026-09-06）已公开为 Latest，仅提供 Windows x64；Harness 钉 `0.1.2-rc.1`。固定源码 `583b6fa92d93df2ee56363e96e2891b356af75b9`，Desktop tests run `34015974835` attempt 2 与 Windows build run `34015983516` 均成功。已将同一批校验过的 Setup、blockmap 和 `SHA512SUMS.txt` 从原草稿就地发布，资产摘要保持不变。维护者在获知新包实机 P0 未完成后明确授权本次发布；授权记录、文件摘要与未测边界见 [发布记录](../../qa/results/2026-09-06/candidate-583b6fa/RELEASE-STATUS.md)。中文 / English 发布说明分别在 [release-notes.md](../../../.github/release-notes.md) / [release-notes.en.md](../../../.github/release-notes.en.md)。

## 用户路径（开发者）

```powershell
npm install
npm run setup:harness
npm start
npm test
npm run dist          # Windows
npm run dist:mac      # macOS 真机
```

同步上游：`npm run sync:harness -- --ref … --sha …`（以 `vendor/harness-upstream.json` 为准）。

## 架构要点

- 钉：`vendor/harness-upstream.json`（当前文档化基线见根 README）。  
- Windows 安装器品牌化（欢迎/完成侧栏、header、许可页、zh_CN+en_US、`build/installer.nsh`）契约见 [windows-installer 卡](../../features/windows-installer.md)；位图用 `npm run installer:assets` 再生成，GUI 定制不得影响静默 `/S` 与 artifact 命名。  
- 改 client 后：`vendor/deepseek-harness` 内 `pnpm run build:official` 再重启桌面（与官方发版同一 profile；不要只跑 `build:lib:client`）。  
- 安装包经 GitHub Actions `release.yml` **windows job** 产出。验收对象是该 artifact，不是本地 `npm run dist`。`afterPack` 会把打包时的 `node.exe` 打进包内，本机 Node 24 ≠ CI Node。
- Node 钉版单一来源是根 `.nvmrc`（当前 22.22.2；engines 要求 `^22.19.0 || >=24`）：CI 全部 `setup-node` 用 `node-version-file`，云端环境 `.cursor/environment.json` → `.cursor/install.sh` 在旧 Node 上自动装 `.nvmrc` 版本并跑 `npm ci` + vendor `pnpm install`。

## 实现入口

- `scripts/`（setup/sync/dist/QA）
- `package.json` scripts
- `.github/workflows/`

## 不变量

- 验收表：每次发布前对 **CI 安装包 SHA** 走完 [production-acceptance-test-cases.md](../../qa/production-acceptance-test-cases.md)。禁止把源码钉写成已发包装钉；禁止用本机 dist 给该表打 Pass。  
- `after-pack` 拍平 pnpm 树后，MCP SDK 必须仍能解析到 ajv major ≥ 8（版本冲突的兄弟依赖嵌回 `sdk/node_modules`）；禁止把已安装 runtime 的 `node_modules` 当源码提交。
- `release.yml` 的 release job 不重跑测试（见 `ci-isolation.test.js`），但发布前**机器校验同一 SHA 的 Desktop tests（test.yml）已绿**，否则拒绝发布；手动晋级也须校验相同源码 SHA，不能把后续文档提交当作已构建提交。
- macOS 策略：手动候选默认只构建 Windows；仅显式 `include_macos=true` 时构建 macOS。tag-push 仍保留 macOS best-effort 分支，但 0.2.9 的手动发布不上传 DMG，不删除未来版本的 macOS 构建能力。
- 下载校验：`SHA512SUMS.txt` 使用 `sha512sum` 标准格式，随同一批 Release 资产发布；桌面更新器按清单强制校验（缺条目 / 不匹配 / 清单拉取失败均中止并删除下载文件）。`v0.2.7` 已有该清单；其它旧版本若缺少清单，当前更新器先请求明确确认，拒绝则不下载，不会静默安装未校验文件。
- 现 `v*` tag 在 CI 绿的前提下 `gh release create`，仍来不及先走验收表。合规顺序见验收表 §0.1。发布草稿时 GitHub 自动创建标签也会触发该 push 工作流：0.2.9 的重复 run `34018917540` 已取消并复核正式资产未变；现有流程晋级固定产物时须监控并取消重复构建，不能假定 API 发布不会触发 tag-push。
- SQLite 等格式与 rc 版本兼容性以发版说明为准。

## 门槛

- `test.yml` 在 vendor 构建后执行 GUI 与无密钥核心回归：识图路由、工具调用、会话历史、控制器、工作区和子代理。任一核心集合失败都会阻止同 SHA 的发布门禁通过。

- QA：每次发布前生产验收全表（CI 包）；`TC-INST-001`、`TC-INST-008`、`TC-INST-009`、`TC-INST-012`、`TC-INST-013`

## 延伸阅读

- [README.md](../../../README.md) 开发节
- harness 上游 [docs/architecture.md](../../../vendor/deepseek-harness/docs/architecture.md)
