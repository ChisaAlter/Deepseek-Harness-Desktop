# 模块：构建、钉版与发版

## 职责与非目标

**职责：** vendor harness 钉版、官方 `build:official` 客户端、electron-builder 出包、CI 发版。  
**非目标：** 不在手册复述完整 CI YAML；不把源码钉伪称为已发包装钉。

## 当前版本

`0.3.2`（tag `v0.3.2`）是最近已发布版本；`0.3.3` 当前处于候选阶段，默认仅生成 Windows x64。Harness 钉 `dsh-v0.1.7-alpha.2`（SHA `00102833dfaee1da9f48a3a8eae9d34005a75218`）。候选运行完成后，必须把同一候选运行的 SHA、Desktop tests 结果和 Setup SHA256 写入发布记录，再使用 `publish.yml` 晋级；中文 / English 发布说明分别在 [release-notes.md](../../../.github/release-notes.md) / [release-notes.en.md](../../../.github/release-notes.en.md)。

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
- 改 client 后：`vendor/deepseek-harness` 内 `pnpm run build:official` 再重启桌面（与官方发版同一 profile；不要只跑 `build:lib:client`）。`build:official` 现在按阶段凭据决定重跑范围：只改浏览器来源时仅重做 `client` + `web`，native/host 产物沿用已验证结果；`--force` 可忽略凭据全量重建。  
- 安装包经 GitHub Actions `release.yml` **windows job** 产出。验收对象是该 artifact，不是本地 `npm run dist`。`afterPack` 会把打包时的 `node.exe` 打进包内，本机 Node 24 ≠ CI Node。
- Node 钉版单一来源是根 `.nvmrc`（当前 22.22.2；engines 要求 `^22.19.0 || >=24`）：CI 全部 `setup-node` 用 `node-version-file`，云端环境 `.cursor/environment.json` → `.cursor/install.sh` 在旧 Node 上自动装 `.nvmrc` 版本并跑 `npm ci` + vendor `pnpm install`。

## 实现入口

- `scripts/`（setup/sync/dist/QA）
- `package.json` scripts
- `.github/workflows/`

## 不变量

- 验收表：每次发布前对 **CI 安装包 SHA** 走完 [production-acceptance-test-cases.md](../../qa/production-acceptance-test-cases.md)。禁止把源码钉写成已发包装钉；禁止用本机 dist 给该表打 Pass。  
- `after-pack` 拍平 pnpm 树后，先以当前工作区完整运行时包替换同名旧包（缺少编译产物时失败）；旧包的 pnpm 宿主条目不再给新版包注入依赖，当前工作区与 vendored Cordis 包按源实例和发布文件比较完整依赖解析链，仅在冲突处补嵌套包并复验发布文件、依赖解析链和模块实例身份；同一源实例被拆分或不同源实例被合并均阻断构建，顶层版本或 peer 冲突不豁免，peer 在消费者一侧共享；两个仅供测试的包从发布树排除，若收集到的工作区或 vendored 包直接声明运行时依赖、或最终发布树仍含这两个包则构建失败；其他旧消费者仍按最终顶层版本补齐旧版嵌套包；最后运行真实 CLI 契约检查。MCP SDK 必须仍能解析到 ajv major ≥ 8（版本冲突的兄弟依赖嵌回 `sdk/node_modules`）。禁止把已安装 runtime 的 `node_modules` 当源码提交。当前工作区依赖重排仍有已知同源拆分，保持发布阻断并冻结后续开发；见[局部回退决定](../../decisions/implemented/architecture/2026-09-24-whale-performance-partial-rollback.md)。
- `release.yml` 只负责候选构建、安装树冒烟和原始 artifact 上传；`publish.yml` 不重建二进制，而是在晋级前**校验同一候选 SHA 的 Desktop tests（test.yml）已绿**，否则拒绝发布，不能把后续文档提交当作已构建提交。
- **阶段凭据**：`.dsh-build/build-stage-credentials.json` 记录 `native-system` / `host` / `client` / `web` 四个阶段各自的输入与产物身份（`size:mtime:ctime` manifest 摘要 + 路径绑定内容摘要）、内联的公开环境摘要与 schema 版本。复用条件是该阶段及其所有前序阶段都验证通过；manifest 命中走快路径，manifest 变动时用内容摘要兜底，所以 `touch` 与「字节相同的重建」仍算命中，而产物被篡改 / 截断 / 缺失、凭据缺失或 schema 不符一律 fail-closed 重跑。判定实现只有一份：`vendor/deepseek-harness/scripts/build-stage-credentials.mjs`，被 `scripts/build.ts`（经 `.d.mts`）与根 `scripts/prestart-ensure.mjs` 共用。稳态校验约 1.2 s，内容模式约 2.2 s；缓存只在进程内，不落盘。  
- **`build:lib` 不再被 `build.ts` 调用**：它必然连跑 host 与 client 两个面，会让按面复用失效；`build.ts` 直接调用 `build:lib:host` / `build:lib:client`。手工构建仍可继续用 `build:lib`。  
- 晋级前的资产核对由 `scripts/check-release-assets.mjs` 单点完成（workflow / 测试 / 本地排障共用同一实现）。它只读、离线、不读 GitHub 凭据、有界：要求恰好一个版本化 Setup + 同名 `.exe.blockmap` + `latest.yml`（皆为非链接普通文件、不逃出资产目录），Setup 文件名 / tag / package 版本 / 元数据版本一致，Setup SHA256 等于操作者摘要，`files[]` 只引用本地 Setup 且大小与 base64 sha512 匹配字节，旧式顶层 `path`/`sha512` 可缺失但存在时不得矛盾。provenance 记录校验器**实际确认**的摘要，而不是把输入回显。它不证明 `.blockmap` 与 Setup 的密码学对应——v26 元数据没有该字段。
- `publish.yml` 的运行时准备是 `npm ci --ignore-scripts`（尊重候选 SHA 的锁文件、禁用生命周期脚本，不用 `npx` 也不依赖 runner 上的环境包）；稀疏检出必须带上 helper、`package-lock.json` 与 `.nvmrc`，候选 SHA 缺 helper 时显式失败而不是换成别处代码。
- macOS 策略：候选默认只构建 Windows；仅显式 `include_macos=true` 时构建 macOS。macOS 资产必须来自同一候选运行，晋级阶段不重建，也不因 tag push 触发候选。
- 下载校验：`SHA512SUMS.txt` 使用 `sha512sum` 标准格式，随同一批 Release 资产发布；桌面更新器按清单强制校验（缺条目 / 不匹配 / 清单拉取失败均中止并删除下载文件）。`v0.2.7` 已有该清单；其它旧版本若缺少清单，当前更新器先请求明确确认，拒绝则不下载，不会静默安装未校验文件。
- 发布不再由 `v*` tag push 触发。先手动运行候选构建并完成验收，再手动运行 `publish.yml`，显式提供候选 run ID、release tag 和 Setup SHA256；晋级工作流按 run ID 下载原始资产并以 `--target` 固定候选 SHA。
- SQLite 等格式与 rc 版本兼容性以发版说明为准。

## 门槛

- `test.yml` 在 vendor 构建后执行 GUI 与无密钥核心回归：识图路由、工具调用、会话历史、控制器、工作区和子代理。任一核心集合失败都会阻止同 SHA 的发布门禁通过。

- 发布资产契约：`node --test scripts/check-release-assets.test.mjs`（32 项，含四条变异检验，证明各门确实是拦下缺陷的那一个）；`src/main/ci-isolation.test.js` 静态钉住 `publish.yml` 的晋级顺序、稀疏检出内容、`npm ci --ignore-scripts`、无 `npx` 与缺 helper 时的显式失败。

- QA：每次发布前生产验收全表（CI 包）；`TC-INST-001`、`TC-INST-008`、`TC-INST-009`、`TC-INST-012`、`TC-INST-013`

## 延伸阅读

- [README.md](../../../README.md) 开发节
- harness 上游 [docs/architecture.md](../../../vendor/deepseek-harness/docs/architecture.md)
