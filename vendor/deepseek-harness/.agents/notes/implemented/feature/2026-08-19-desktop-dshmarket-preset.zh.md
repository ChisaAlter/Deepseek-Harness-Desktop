# Agent Note: 桌面预置 dshmarket

Status: implemented — **已被 [桌面自有市场分区](2026-08-25-desktop-owned-market-section.zh.md) 反转**；桌面不再预置安装 dshmarket。

[English](2026-08-19-desktop-dshmarket-preset.md) | 中文

## 问题

桌面自研的插件市场（`settings.plugins.tab` id `marketplace`）不是 [dsh-market](https://github.com/dsh-market/dsh-market)。首次启动再跑 `dsh plugin add dshmarket` 仍要访问 npm 仓库，离线用户会失败。

## 决策

**Deepseek-Harness-Desktop 把已发布的 `dshmarket` 1.14.0 包源码放在 `vendor/dshmarket`。** electron-builder `extraResources` 用 `{ from: "vendor", to: "vendor", filter: ["dshmarket/**"] }` 复制，使插件自己的 `node_modules` 不是拷贝根（根在 `vendor/dshmarket` 时会丢掉该目录的 `node_modules`）。安装包里的运行时依赖来自 `afterPack`，不依赖 Git 里一份完整的 `node_modules`：若已打包插件缺少已声明依赖，或该依赖的 `exports` / `module` / `main` 文件，`afterPack` 在项目树有 `vendor/dshmarket/node_modules` 时先拷过去，然后清空已打包的 `node_modules` 并执行 `npm install --omit=dev --ignore-scripts`（有 `package-lock.json` 时用 `npm ci`）。这些入口文件仍缺失则打包失败。`setup:harness` 在 `vendor/dshmarket` 不完整时执行同样的安装。`dsh.start()` 之前，`ensureDshMarketPlugin` 把该目录复制到 web profile 的 `desktop-plugins/dshmarket`；若 `node_modules/dshmarket` 还不是真实目录，则建立指向该副本的 junction；并 upsert 托管的 `cordis.patch.yml` 插入块（`id: dsh-market`，`name: dshmarket`）。不执行 `dsh plugin add`。缺少打包的 `package.json`、已声明依赖，或依赖的导出文件，只记日志、去掉托管插入块，不中止 Harness 启动，也不覆盖已有 profile 副本。若 profile 的 `dsh.profile.bundles` 已含 `dshmarket`，仍刷新 `desktop-plugins` 副本，并去掉托管插入块，避免 Loader 看到两行 `dsh-market`。

**不再有自研市场标签页。** `ui-settings-plugin-inventory` 只注册插件列表（`id: 'all'`）。市场界面是 `dshmarket` 的 `settings.section`（id `market`），即 `MarketSection` 加上 Harness 源上的 `/dsh-market/*`。

**托盘和菜单的 `openMarketplace()` 跳到该分区。** 显示主窗口并调用 `openHarnessSettings('market')`。Harness 未加载时记下待跳转，绝不创建市场 `BrowserWindow`。

主进程目录拉取和 `installMarketplacePlugin(id)` 仍给 Host `install_dsh_plugin` 与 IPC 调用方用，不是设置里的插件市场界面。该 Host 路径仍由 [桌面插件市场精选目录](2026-08-18-desktop-marketplace-curated-catalog.zh.md) 拥有。

## 曾考虑的替代方案

- **把 `MarketSection.tsx` 抄进 `ui-settings-plugin-inventory` 并留在插件标签里** —— 仍是分叉他们的界面，而且客户端逐文件覆盖率会吃下一整页第三方代码。
- **自研标签页和 `dshmarket` 分区并存** —— 设置里出现两个市场。
- **首次启动执行 `dsh plugin add dshmarket`** —— 依赖 npm，add 失败则设置里没有市场。
- **把 `dshmarket` 写进官方 web profile 模板** —— 只有库存 bundle 列表会带上它，用户自管的列表不会。
- **extraResources 从 `vendor/dshmarket` 拷贝** —— electron-builder 把该目录的 `node_modules` 当成拷贝根 `node_modules` 丢掉，打包后的 `lib/net.js` 无法 `import 'undici'`。
- **把 Git 跟踪的 `vendor/dshmarket/node_modules` 当作安装包运行时** —— 仓库的 `dist/` 忽略规则会在 `node_modules` 例外之后再次忽略 `js-yaml` 的 `exports.import` 文件 `dist/js-yaml.mjs`，只检查 `node_modules/<dep>/package.json` 会放行这棵残缺树。

## 后果

设置 → 插件市场是随包装来的插件，作为左侧独立导航，不是「插件」下的标签。非官方 `dshmarket` CSS 随该包装来。应用更新会刷新 profile 里的副本。已经由 pnpm 装进 `node_modules/dshmarket` 的真实目录不动。`--skip-user-plugins` 恢复启动时不会加载用户层插入块，直到完整插件启动。

## 测试

`src/main/dshmarket-preset.test.js` 钉住复制加托管插入、刷新副本、`dsh.profile.bundles` 已含 `dshmarket` 时跳过并去掉插入块、不替换真实 `node_modules/dshmarket` 目录、缺少打包 `package.json`、运行时 `node_modules/<dep>` 或依赖导出文件时失败、复制随包 `node_modules`、从 `vendor` 用 `dshmarket/**` 做嵌套 `extraResources`、仓库内 1.14.0 包源码，以及 `.gitignore` 不忽略 `vendor/dshmarket/node_modules/**/dist`。`src/main/after-pack.test.js` 钉住补回被丢掉的插件 `node_modules`、打包树缺依赖或其导出文件时拒绝、提升安装的嵌套依赖可通过、这些文件缺失时执行 `npm install`，以及文件齐全时跳过。`src/main/harness-controller.test.js` 钉住预置发生在桌面安装插件之后、`dsh.start()` 之前，以及预置失败仍启动 Harness。`src/main/window-marketplace.test.js` 钉住 `openMarketplace` 注入 `settings.section` id `market`，且不加载 `marketplace/index.html`。`ui-settings-plugin-inventory` 的 `browser-plugin.client.spec.tsx` 钉住存在 `window.shell` 时也不注册 `marketplace` 标签。

## 相关

- 反转方：[桌面自有市场分区](2026-08-25-desktop-owned-market-section.zh.md)
- [桌面插件市场精选目录](2026-08-18-desktop-marketplace-curated-catalog.zh.md)
