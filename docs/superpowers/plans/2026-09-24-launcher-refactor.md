# 启动器重构计划：独立分发、双线路下载、增量更新与组件平台

状态：2026-09-24 制定。功能尚未交付；本文是当前唯一有效的启动器重构计划。

## 1. 目标（不可缩减）

- 重构**现有**启动器：`src/renderer/launcher.html` / `launcher.js` / `launcher.css` 是唯一 UI 源。首页、导入、版本、插件排查、设置五个分区与首页 Recovery Board 全部保留，不新建第二套启动器界面。
- **现有控制能力逐项保留且可操作**（对应 preload `launcherApi` 与 LAUNCHER_ONLY IPC，不是只保留外观）：
  - 桌面端启停：`startDesktop` / `stopDesktop` / 跳过用户插件启动 / 完整重试 / 就绪与失败状态反馈；
  - 版本管理：本机安装识别（`launcherStatus`）、正式版列表、指定版本安装与切换、检查更新、卸载入口；
  - 插件排查：全插件名单与归因、逐项禁用/启用、批量禁用可疑、移除、`desktopRuntimeDamage` 判定；
  - 数据导入：来源与技能目录选择、扫描、执行、取消与进度；
  - 启动器设置：自动启动、启动后退出、更新询问等读写。
- 启动器成为**独立分发的轻量安装包**：用户先装启动器，首次使用选择下载线路——**GitHub（国外）或 Gitee（国内）**——由启动器把 DSHD 下载到本机并完成安装；已安装的 DSHD 直接识别采用。
- 启动器提供**检查更新**与**增量更新**：版本页可查询新版本并执行更新，增量包独立完成校验与安装。
- 启动器自带**组件功能**：项目后续自研的工具/服务组件，用户在启动器内浏览、下载、安装、运行、停止、更新、卸载。
- 上述能力全部落在同一份启动器实现上；空壳演示或隐藏旧窗不算交付。

## 2. 已核对的代码事实（2026-09-24 复核）

| 能力 | 现有实现 | 继续方式 |
| --- | --- | --- |
| 唯一启动器窗口与五个分区 | `src/main/window.js`、`src/renderer/launcher.*`（home/import/versions/plugins/settings + 首页内嵌 Recovery Board） | 原地重构扩展，不另造页面 |
| 桌面启动/停止与冷启动闸门 | `src/main/index.js`、`launcher-gate.js`（`runColdStartGate` / `createParkedUpdateDrainer`）、`harness-controller.js` | 提取启动器服务边界；HarnessController 保留运行时所有权 |
| 安装识别、版本查询、下载安装 | `src/main/update.js`：`discoverWindowsInstall`、`getInstalledAppInfo`、`listReleases`、`installFromAsset`、`installUpdate` | 复用并拆出安装探测、发布查询、下载、安装职责；保留源码/注册表安装区分 |
| 应用内差量更新 | `update.js` 的 `preferUpdater` → `update-updater.js`（electron-updater blockmap，v0.3.2 起） | 保留为已安装应用的自更新通道；与启动器独立增量包分层共存（见 §3.4） |
| 导入、设置、插件恢复 | `src/main/ipc.js` 的 LAUNCHER_ONLY handlers、`data-import.js`、`profile-ops.js` | 保留数据语义与 IPC 授权模型，先封装调用再改进程边界 |
| 今日保留的正确性修补 | 更新确认绑定展示快照、放弃重停、导入互斥、空选择零 journal（决策 `2026-09-24-launcher-update-import-ownership`） | 保留并在重构后定向复核 |

## 3. 目标架构与边界

### 3.1 双程序边界

Launcher 拆为独立轻量产品：自己的 appId、安装目录、卸载记录、单实例锁，打包白名单剔除 Harness 归档与桌面插件。DSHD 桌面端成为受管运行时，仍由完整 NSIS Setup 安装（离线完整包永远可用）。安装身份、配置归属与卸载迁移随打包边界落地时设计；已安装用户的设置与 `dsh-home` 不得丢失。

### 3.2 进程与授权

启动器 renderer 继续只消费 main 授权后的 preload/IPC 状态与操作结果，不获得 Harness 对象或任意执行能力。第一步先在同进程内把启动器状态与操作汇总为应用服务；拆出运行时后，桌面端经带版本、本机认证与请求身份的窄接口服务启动器，恢复与插件排查逻辑不复制到第二处。

### 3.3 线路与版本权威

GitHub 与 Gitee 镜像**同一候选构建的原始字节**；签名清单（release catalog）是唯一版本权威，绑定版本、候选 SHA、各资产大小与 SHA-256、平台架构与两条镜像 URL。用户选择 Gitee 后，查询与下载不得暗中回退 GitHub API。Gitee 线路在真实大文件、匿名下载、国内网络与哈希复核通过前不对用户展示，未完成时明确标注未完成。

### 3.4 增量更新

发布时除完整 Setup 外产出**独立增量包**（固定上一正式版 → 目标版）。启动器用已验证的本地基线 Setup + 增量包离线重建目标 Setup，长度与 SHA-256 与清单一致后才运行安装器；缺基线、补丁损坏、不适用或无收益时回退同一目标版本完整包。该通道与已实施的 `electron-updater` blockmap 差量（应用内自更新，`2026-09-17` 决策）是不同层：blockmap 仍服务既有安装的自更新，不冒充独立增量包，独立增量包也不复用 `latest.yml` 语义。

### 3.5 组件平台

首批组件只接受项目审核并签名的工具/服务包。组件是独立进程：二进制在启动器自有版本目录、数据在独立数据目录，原子切换 active 并保留上一健康版本回滚；main 进程持有 PID/代际/健康状态与有界退避，安装后默认不自启。组件操作锁与 DSHD 安装锁分离；组件故障不得阻塞下载/安装/启动主路径。不写 `dsh-home`、不写 Harness profile、不复用插件市场。

### 3.6 未安装态与既有功能保全

保全是能力级而非外观级：§1 枚举的启停、版本、插件、导入与设置操作在拆分前后都必须真正可用——跨进程后经带认证的窄接口落到桌面运行时，不得退化成只读展示或静默失效。未安装 DSHD 时五个分区与 Recovery Board 保留可见，明确标注哪些操作需要先安装，安装后原位启用。正常启动、自动启动、重复点击、启动失败、托盘重开只出现一个启动器窗口；`spawn` 成功不等于桌面 ready。源码开发启动仍可启动本工作区桌面，不得被当作「未检测到安装」。

## 4. 执行批次与完成条件

批次是依赖顺序，不授权缩减范围；整体完成必须覆盖 C–E。

| 批次 | 范围 | 完成条件 |
| --- | --- | --- |
| A. 原地解耦 | 从 `index.js` / `ipc.js` 提取启动器状态与操作服务，从 `update.js` 提取安装识别；现有 `launcher.js` 对接新边界。只拆必要模块，不换页面框架 | 五个分区与恢复功能可用；§1 枚举的桌面启停、版本管理、插件逐项/批量操作、导入、设置逐项实测可用；源码运行与已安装版本不混淆；重复启动不多开、失败不误报 ready；现有更新/导入修补仍成立。重启应用验证 |
| B. 轻量包与完整安装 | 拆出 DSHD 运行时装配，精简启动器必需依赖；首页/版本页增加线路选择、未安装态、下载/取消/重试、校验与安装；运行时控制与恢复通道接回导入、设置、插件排查 | 从未安装开始，在同一启动器选线路、下载、校验、安装并进入 DSHD；已安装用户直接采用；失败留在原窗口；五分区端到端可用；离线完整包与源码启动仍各只有一套启动器 |
| C. 双线路与签名清单 | 签名清单接入更新服务；GitHub/Gitee 镜像同一候选字节。Gitee 真实大文件与匿名下载验证及早做，不占 A/B 主路径 | 选 Gitee 后查询/下载不暗访 GitHub；取消、断流、校验失败保留旧安装；未验证线路不冒充可用 |
| D. 独立增量包 | 构建固定上一正式版到目标版的独立补丁；版本页消费，先在缓存重建完整 Setup 再校验安装 | 完整包与增量包同时发布；真实相邻版本重建哈希一致；无基线/损坏/无收益回退同目标完整包 |
| E. 组件分区 | 原导航增加组件分区；复用下载校验，独立组件锁、版本目录与进程监管。首批为项目维护的工具与服务各一例 | 工具、服务各一例完成下载、安装、运行、停止、更新、回滚、卸载；服务运行时关窗进托盘、退出停服务；不写 Harness profile |

UI、打包边界或跨进程接口改变前，同批更新 `docs/design-language.md`、相关 feature 卡与决策记录；现行单进程合同在实现前仍是现状，不提前宣称已拆开。

### 4.1 进度记录

- **2026-09-24 A 批完成**：`src/launcher/launcher-service.js`（编排）+ `install-detect.js`（探测，`deps` 注入）落地；`ipc.js` 仅授权+传输；`update.js` 回导出兼容。147/147 定向测试通过。
- **2026-09-24 B 批核心（B-core）**：`product.js` 包形态（`dshdPackage:'launcher'`/`DSHD_LAUNCHER_PACKAGE=1`）；`release-source.js` 双线路表（Gitee 未验证禁选）；`runtime-install.js` 安装编排（路由→校验→`quitAfterInstall:false`→注册表/exe 落定轮询→外部进程启停）；`install-detect.js` 目标化；冷启动门 slim 分叉 + `--dshd-from-launcher` 直通；首页未安装卡 + 设置线路行；`checkDesktopUpdate` 未安装钳制（无运行时不弹"更新"询问）。IPC 新增 `shell:install-runtime`/`shell:cancel-runtime-install`（LAUNCHER_ONLY，进度走 `shell:update-progress`）。184/184 定向测试通过；slim dev 实跑确认未安装态落首页安装卡。**未完成（B-β）**：独立 electron-builder slim 目标与 `index.js` vendor 懒加载（真正瘦身）；slim 包 userData 与运行时 userData 分离后导入目标重定向；跨进程插件归因/Recovery Board 对运行时的等效通道；Gitee 实机验证前线路仍不可选。
- **2026-09-24 B-β 落地**：`src/main-launcher/` 独立 slim 入口（无 harness/vendor 栈初始化）+ `src/main/ipc-launcher.js` 共享通道表（ipc.js 与 slim ipc 同表，防漂移）；`electron-builder.launcher.yml` 独立 appId/productName/`dshdPackage` extraMetadata/零 vendor extraResources；`npm run pack:launcher` 产物 321.5MB（对照完整包 3759.3MB ≈ -91%）。**userData 分离（修正共享方案）**：Electron 单实例锁以 userData 路径为 mutex，且 app.name 取自打包 package.json 的 `productName`——必须 `extraMetadata.productName` 真正改写，slim 才有自己的 `%APPDATA%/Deepseek-Harness-Launcher`（独立 config + 独立锁）；桌面侧状态（dsh-home、导入 journal、last-desktop-start）由 `product.js` 的 `desktopStateDir`/`desktopUserDataDir` 显式指向运行时目录。**startExternalDesktop 存活宽限**：spawn 成功不等于桌面存活——运行时输掉自己的单实例竞争会秒退，不报失败会让启动器永远隐藏无窗；现在宽限 12s 轮询 `tasklist`，期间消失/从未出现都判 `ok:false` 让门落回可见启动器（测试覆盖 alive/exited/never-started/spawn-error/未安装五态）。**共存实测**：打包 slim 与 dev 桌面实例并行无锁冲突；本机 `C:\Program Files\Deepseek-Harness-Desktop`（0.3.2）真实存在——占锁时桌面 spawn 秒退→启动器正确落回显示；释放锁后 spawn 存活→启动器保持隐藏、0.3.2 自带内嵌启动器出现（旧版不识 `--dshd-from-launcher`，优雅降级，干净 handoff 需 runtime ≥ 携带该 flag 的版本）。slim 入口带 `logs/main.log` fatal 追踪（GUI 进程无控制台）。全量 2326/2326、治理 6/6、doc-sync 8/8。**遗留**：跨进程插件 align（写盘已生效，运行中实例下轮启动应用）、slim 托盘与组件驻留（E 批）、携带 flag 的 runtime 真实 handoff（需先发一版含该 flag 的桌面端）、Gitee 验证。

## 5. 下一批代码起点

1. 为 `getInstalledAppInfo` / `discoverWindowsInstall` 建立可注入平台接口，再从 `update.js` 提取，维持现有返回契约与卸载能力。
2. 将 launcher-status、start/stop、config、import、recovery handler 的编排接到启动器服务；IPC 授权留在 main，先接同进程后端，不先实现通用 RPC 框架。
3. 用现有首页、版本、导入与恢复操作验证边界；只修测试暴露或当前代码确认的异步覆盖问题，不顺带重构其它产品模块。
4. 然后进入 B：让同一份页面在缺少 DSHD 运行时的环境也能操作，接真实完整包。

## 6. 检查与交付证据

按 feature Gates 跑相关更新/冷启动/IPC/导入定向测试，再执行仓库产品检查并重启应用。真实 Windows 流程覆盖：源码、已安装、未安装、更新失败、导入、插件恢复、托盘重开、重复启动。每批记录实际通过与未完成项；历史批次的测试计数不算本轮通过。

文档修改走 `check:governance` / `doc-sync`；双语记录重录 sidecar。包白名单、体积与启动测量在 B 的真实功能链上验收。正式签名、Gitee 上传与发行依赖外部配置时单列阻塞项，不阻塞本地代码完成。

## 7. 关联

- 主卡：[desktop-launcher](../../features/desktop-launcher.md)；拟议卡：[launcher-distribution](../../features/launcher-distribution.md)、[launcher-components](../../features/launcher-components.md)
- 决策：[启动器独立分发架构](../../decisions/proposed/architecture/2026-09-24-launcher-standalone-distribution.md)
- 相关既有决策：[electron-updater 差量通道](../../decisions/implemented/product/2026-09-17-electron-updater-differential-updates.md)、[冷启动更新检查退出自动启动](../../decisions/proposed/product/2026-09-22-nonblocking-startup-update.md)、[发布资产校验](../../decisions/proposed/process/2026-09-20-release-asset-validation.md)、[更新确认与导入归属](../../decisions/implemented/bug-fix/2026-09-24-launcher-update-import-ownership.md)
- 视觉唯一来源：[design-language](../../design-language.md)
