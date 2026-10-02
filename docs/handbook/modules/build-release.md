# 构建、钉版与发版

本章保存装配实现；开发与发布操作见[发布说明](release-process.md)，项目维护见[维护说明](../../maintenance/README.md)。

## 本地开发与构建

`npm ci` 安装根依赖，`npm run setup:harness` 准备锁定的上游并构建官方 profile，`npm start` 启动桌面。Windows 使用 `npm run dist`，macOS 使用 `npm run dist:mac`。这些是操作入口，不是每次修改必须顺序执行的清单。

Harness 来源由 `vendor/harness-upstream.json` 记录；同步用 `npm run sync:harness -- --ref … --sha …`。整合时查看[上游合并与差异保护](../../maintenance/README.md#上游合并与差异保护)，不要覆盖已经交付的桌面能力。

## 实际装配

- `scripts/setup-harness.js` 使用锁文件中的 pnpm 和官方 `build:official`。客户端修改后构建该 profile，随后重启桌面。
- `package.json` 保存 Electron、NSIS、DMG、资源和 afterPack 配置。Windows 安装器品牌与静默安装行为见[安装器资料](../../features/windows-installer.md)。
- 根 `.nvmrc` 是 CI Node 版本来源。`afterPack` 把实际构建时的 Node 打入安装包；本机版本不能冒充 CI 包内版本。
- 生产依赖必须在 manifest 与锁文件中完整声明；实际装配保留消费者的依赖实例共享/隔离关系。实现与理由见[运行时实例布局](../../decisions/implemented/architecture/2026-09-28-runtime-instance-layout.md)。
- `afterPack` 对 Harness 归档计算 SHA256；提取和同版本升级通过归档内容识别变化，不能用文件长度或版本号替代。
- 上游 `scripts/build-stage-credentials.mjs` 按 native/host/client/web 的输入与产物身份复用阶段，避免无变化时重复编译。该缓存属于构建实现，不是人工验收凭据。
- Office runtime 通过 `prepare:office-runtime` 进入 Windows 安装包。其资源、依赖和能力边界见[Office runtime](../../features/office-runtime.md)。

## CI 产物与分发

`test.yml` 在开发阶段产生 `Whale-Isle-windows-x64`，包含版本化 Setup、blockmap 和 latest.yml；启动打包后的应用后上传。请求 macOS 时还产生同一次运行的 DMG。

`release.yml` 从成功的 main 开发构建下载资产。版本高于已发布版本才分发，失败上传可重试原 CI run。资产检查由 `scripts/check-release-assets.mjs` 核对文件与更新元数据；不运行候选计划或签署检查。

`SHA512SUMS.txt` 是桌面更新器的实际输入，发布时必须包含同批资产的 SHA512。下载、安装、用户数据迁移等变更需要相应实际操作验证；打包启动成功只证明它观察到的行为。历史候选报告不是当前流程。
