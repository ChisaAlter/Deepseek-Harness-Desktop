# 模块：构建、钉版与发版

## 职责与非目标

**职责：** vendor harness 钉版、官方 `build:official` 客户端、electron-builder 出包、CI 发版。  
**非目标：** 不在手册复述完整 CI YAML；不把源码钉伪称为已发包装钉。

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
- `release.yml` 的 release job 不重跑测试（见 `ci-isolation.test.js`），但发布前**机器校验同一 SHA 的 Desktop tests（test.yml）已绿**，否则拒绝 `gh release create`。先让 main 上该提交 CI 变绿，再打 tag。  
- macOS 策略（已文档化）：Windows 安装包是发布门槛；macos job 失败时仍发布，但 Release 里不带 `.dmg` 资产。  
- 下载校验：release job 生成 `SHA512SUMS.txt`（`sha512sum` 标准格式）并随 Release 发布；桌面更新器下载 Setup 后按清单强制校验（缺条目 / 不匹配 / 清单拉取失败均中止并删除下载文件）。**已知限制**：v0.2.7 及更早的 Release 无该清单，安装器不校验直接安装。  
- 现 `v*` tag 在 CI 绿的前提下 `gh release create`，仍来不及先走验收表。合规顺序见验收表 §0.1。  
- SQLite 等格式与 rc 版本兼容性以发版说明为准。

## 门槛

- QA：每次发布前生产验收全表（CI 包）；`TC-INST-001`、`TC-INST-008`、`TC-INST-009`、`TC-INST-012`、`TC-INST-013`

## 延伸阅读

- [README.md](../../../README.md) 开发节
- harness 上游 [docs/architecture.md](../../../vendor/deepseek-harness/docs/architecture.md)
