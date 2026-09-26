# 启动器重构计划：独立分发、双线路下载、增量更新与组件平台

状态：2026-09-25 重写为**验收驱动交付**。本文是当前唯一有效的启动器重构计划。

> 交付单位是"用户可验收的完整结果"，不是施工批次。§2 验收单全部通过之前不停止、不交付；中间不产生"批次完成"式汇报。

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
- 启动器界面按已确认的原型（`docs/superpowers/prototypes/launcher-redesign.html`）落地：DSHD 融合式顶部（48px 隐形拖拽区 + 右上 32px 方形窗控）、左 rail 分区导航、卡片化分区——不是另起皮肤，是把原型移植为唯一 UI。
- 上述能力全部落在同一份启动器实现上；空壳演示或隐藏旧窗不算交付。

## 2. 交付定义与停止条件

**只有 §2.1 全部亲手可验 + §2.2 工程门槛 + §2.3 审查门槛 + §2.4 实机矩阵全部通过，才允许停止并交付。** 任何一项不通过：修复并回到对应阶段重验，不许降级交付、不许把未完成项改叫"遗留"。

### 2.1 用户验收单（交付时逐项附操作步骤）

| # | 用户操作 | 必须看到 |
| --- | --- | --- |
| A1 | 安装并打开 `Deepseek-Harness-Launcher-Setup-*.exe` | 原型同款界面：无独立标题栏（融合顶部）、右上 32px 方形窗控（关闭悬停 `#e81123`）、左 rail 含**首页/组件/版本/导入/插件排查/设置**六分区；暗色主题正常 |
| A2 | 在未装桌面端的环境打开启动器 | 首页出现线路卡：GitHub/Gitee 两卡（或 Gitee 明示不可用原因）；选线路→下载并安装→进度条+阶段（下载/校验/安装）→可取消、可重试→安装完成后首页进入已安装态 |
| A3 | 已装桌面端时打开 | 首页显示已装版本与运行状态；「启动桌面端」「跳过用户插件启动」「检查更新」全部真实生效；启动中/失败状态正确反馈 |
| A4 | 版本页在有新版本时检查更新 | 版本列表真实来自所选线路；新版本提供**增量包**选项；增量失败自动回退同版本完整包；取消下载不留半成品 |
| A5 | 组件页 | 至少一个真实组件完成安装→运行→停止→更新→回滚→卸载全流程；服务类组件关窗后驻留托盘；组件故障不影响启动/下载主路径 |
| A6 | 导入页 / 插件排查页 / 设置页 / Recovery Board | 与旧版逐项等价：来源选择、扫描、导入执行/取消/进度；插件名单、归因、逐项与批量禁用、移除、`desktopRuntimeDamage` 判定；设置读写即生效；Recovery Board 在启动失败后完整出现并可操作 |
| A7 | Gitee 线路 | 匿名 release 元数据+大附件下载实测通过后在 UI 开放；开放后选 Gitee 时元数据/安装包/校验全部只走 Gitee（抓包或日志可证）；未通过则保持禁选并写明原因 |
| A8 | 重复启动 / 托盘重开 / 启动器与桌面端同时运行 | 永远只有一个启动器窗口；启动器与运行中的桌面端互不挤占（独立单实例锁）；spawn 的运行时秒退时启动器落回可见窗口，不留隐藏无窗进程 |
| A9 | 装入一个**故意让桌面端启动崩溃的测试插件**，从启动器重试 | 桌面端失败→启动器落回首页 Recovery Board→**该插件被归因为可疑**（非"内置损坏"等误判）→一键禁用（或批量禁用可疑）→再启动桌面端成功；全程不依赖 `--skip-user-plugins`（老版本运行时不识该 flag，禁用走 profile 落盘） |

### 2.2 工程门槛（交付前我跑完）

- `npm test` 全绿；`npm run check:governance` 6/6；`npm run doc-sync` 8/8（含 sidecar 重录）。
- 新增/改动模块沿用 `deps` 注入并有对应单测；现有 IPC 通道与 payload 契约不破坏。
- `npm run pack:launcher` 产出 win-unpacked 并实测启动；`npm run dist:launcher` 产出 NSIS Setup 并实测安装。
- 改动落在 `desktop-launcher` 卡 Allowed touch 内；越界项先与用户确认。

### 2.3 审查门槛（QA 级，交付前单独一轮）

- 代码审查与编写分离：交付前由独立审查 pass（审查者不是编写上下文）复核全部 diff，维度至少含：
  - IPC 授权面（LAUNCHER_ONLY 覆盖、sender 校验 fail-closed、无新增未授权通道）；
  - 进程生命周期（子进程 error 事件守卫、僵尸/悬挂进程、单实例边界、退出路径无隐藏窗口）；
  - 下载与安装安全（重定向上限、content-length 校验、半成品清理、SHA-256/签名校验、路径穿越、安装器参数引用）；
  - 落盘格式与状态目录（launcher userData 与桌面 state dir 的归属边界、journal 原子写）；
  - 与 feature 卡不变量及 §1 枚举能力的一致性；
  - 测试覆盖与断言有效性（不无注入裸奔、不把 happy path 当边界）。
- 审查发现全部修复并重跑对应测试；审查结论记录到 §6 进度记录。

### 2.4 实机矩阵（真实 Windows，逐项留证据）

| 场景 | 通过标准 |
| --- | --- |
| 源码启动完整包 | 启动器出现且五分区可用 |
| slim Setup 安装后启动 | 窗口弹出、独立 userData、无 vendor 栈加载 |
| 未安装→选线路→下载→校验→安装 | 全流程成功；取消中断可重试；断流/校验失败落回首页且不留半成品 |
| 已安装采用 | 注册表+exe 探测到已装运行时，首页直进已安装态 |
| 启动器拉起运行时 | 运行时存活→启动器隐藏；运行时秒退（锁竞争/崩溃）→启动器落回可见（存活宽限已测） |
| 运行时含 `--dshd-from-launcher` | 不重复开启动器（需发版终验；旧版降级为自带内嵌启动器，已实测可接受） |
| 更新成功 / 更新失败 / 用户取消 | 成功进入新版本；失败/取消落回启动器且旧安装不受影响 |
| 增量包重建 | 有基线：重建产物 SHA-256 与清单一致；缺基线/损坏/无收益：回退同版本完整包 |
| 导入全流程 | 扫描→勾选→执行→进度→取消；中断 journal 恢复 |
| 插件归因与 Recovery Board | 名单完整、可疑判定正确、批量禁用生效、`desktopRuntimeDamage` 不冒充插件故障 |
| 托盘重开 / 重复启动 | 单实例；重开恢复上次分区上下文 |
| slim 与桌面端共存 | 两进程树并行、锁互不冲突、桌面状态目录归属正确 |
| slim 卸载 | 移除自身安装目录与 userData，不动运行时目录与 dsh-home |
| 插件致崩闭环（A9 对应实机项） | 测试插件装入 dsh-home→桌面端崩溃/启动失败→slim 启动器归因正确→禁用后桌面端恢复启动；slim 归因语料含外部运行时启动日志（spawn 输出必须落盘，不得 `stdio:'ignore'` 丢弃） |

## 3. 已核对的代码事实（2026-09-25 复核）

| 能力 | 现有实现 | 状态 |
| --- | --- | --- |
| 唯一启动器窗口与五分区 | `src/main/window.js`、`src/renderer/launcher.*` | 保留，UI 按原型重写 |
| 启动器服务边界 | `src/launcher/launcher-service.js`（编排）、`install-detect.js`（目标化探测） | 已落地（A 批） |
| 运行时装配 | `src/launcher/runtime-install.js`（路由→校验→安装→落定轮询→外部进程启停+存活宽限）、`release-source.js`（线路表+归一化）、`product.js`（形态判定+桌面状态目录） | 已落地（B-core） |
| slim 独立包 | `src/main-launcher/` 入口与 IPC、`src/main/ipc-launcher.js` 共享通道表、`electron-builder.launcher.yml`（独立 appId/productName/零 vendor extraResources） | 已落地（B-β），win-unpacked 321.5MB 实测共存通过 |
| 应用内差量 | `update.js` `preferUpdater` → `update-updater.js`（electron-updater blockmap） | 保留为已装应用自更新；独立增量包是另一层 |
| 组件平台 | 原型 UI 已有组件页；运行时尚无组件目录/清单/进程监管 | **未做（P1）** |
| 独立增量包 | 无生成器/重建器 | **未做（P2）** |
| Gitee 线路 | `ayase/Deepseek-Harness-Desktop` 已建并公开，main 已推送；匿名 API/仓库页已验证；release 附件匿名下载**未实测**；UI 禁选 | **待实测（P3）** |
| 原型 UI | `docs/superpowers/prototypes/launcher-redesign.html`（已评审确认） | **未移植（P0）** |
| slim NSIS 安装包 | `dist:launcher` 脚本存在，未产出未实测 | **未做（P4）** |

## 4. 目标架构与边界

### 4.1 双程序边界

Launcher 是独立轻量产品：自己的 appId、安装目录、卸载记录、单实例锁、userData（`%APPDATA%/Deepseek-Harness-Launcher`，由 `extraMetadata.productName` 决定）。DSHD 桌面端是受管运行时，仍由完整 NSIS Setup 安装；桌面侧状态（`dsh-home`、插件清单、`last-desktop-start`、import journal）经 `desktopStateDir`/`desktopUserDataDir` 显式指向运行时目录。离线完整包永远可用。

### 4.2 进程与授权

启动器 renderer 只消费 main 授权后的 preload/IPC；`ipc.js` 与 `main-launcher/ipc.js` 共用 `ipc-launcher.js` 通道表。跨进程到运行时的控制走带版本、本机认证与请求身份的窄接口；当前无控制通道时的降级（写盘下次生效、存活宽限探测）必须在 UI 明示。

### 4.3 线路与版本权威

GitHub 与 Gitee 镜像**同一候选构建的原始字节**；签名清单是唯一版本权威。选 Gitee 后查询与下载不得暗回 GitHub。线路只在实测通过后开放。

### 4.4 增量更新

发布时除完整 Setup 外产出**独立增量包**（固定上一正式版→目标版）。启动器用已验证的本地基线 + 增量包离线重建目标 Setup，长度与 SHA-256 与清单一致才运行安装器；缺基线/损坏/不适用/无收益回退同目标完整包。与 `electron-updater` blockmap（应用内自更新）分层共存，互不冒充。

### 4.5 组件平台

首批组件只接受项目审核并签名的工具/服务包。组件是独立进程：二进制在启动器版本目录、数据在独立数据目录，原子切换 active 并保留上一健康版本回滚；main 持有 PID/代际/健康状态与有界退避，安装后默认不自启。组件操作锁与 DSHD 安装锁分离；组件故障不阻塞下载/安装/启动主路径。不写 `dsh-home`、不写 Harness profile、不复用插件市场。

### 4.6 未安装态与既有功能保全

保全是能力级：§1 枚举操作在拆分前后都必须真正可用。未安装 DSHD 时六个分区与 Recovery Board 保留可见，需运行时的操作明确标注、安装后原位启用。正常启动、自动启动、重复点击、启动失败、托盘重开只出现一个启动器窗口；`spawn` 成功不等于桌面 ready（存活宽限裁决）。源码开发启动不被当作「未检测到安装」。

## 5. 执行计划：契约冻结 + 并行子代理车道

> 阶段只表示施工顺序，不产生"完成"汇报。只有 §2 全过才算交付。
> 并行的前提是**接缝先钉死**：共享文件的所有交叉点在 §5.0 一次性冻结，之后每条车道只碰自己的文件集，车道之间只允许经由冻结契约通信。

### 5.0 契约冻结（主上下文执行，先于任何车道）

一次性落盘以下接缝，车道以此为唯一协作面：

1. **IPC 通道表**：在 `src/main/ipc-launcher.js` 增加注册器数组挂点（`extraRegistrars`），车道模块各自导出 `register(deps)` 自挂——通道名与 payload 形状冻结在本计划 §5.1，实现归车道，挂点归契约。
2. **preload 方法面**：`preload.js` 中 `launcherApi` 的新方法名一次性声明（`componentsList/componentsInstall/componentsStart/componentsStop/componentsUpdate/componentsRollback/componentsUninstall`、`installDelta`），方法体是薄透传——契约步先写好，车道不动 preload。
3. **渲染层接缝**：`launcher.html` 由车道 A 搭骨架，组件面板只留 `<section id="panel-components">` 容器 + `<script src="launcher-components.js">`；车道 C 拥有 `launcher-components.js` 全部内容与面板内部 DOM。版本页增量按钮走 `status.deltas` 字段 + `launcherApi.installDelta`，字段形状冻结。
4. **文件所有权表（§5.2）**：每车道一个互不相交的文件清单；共享文件（`ipc-launcher.js` 挂点、`preload.js`、`config.js` 新字段）只允许契约步写。

### 5.1 冻结契约（车道必须遵守，不得单方面改）

- `shell:components-list` → `{ components: [{ id, name, version, latest, kind: 'tool'|'service', state: 'not-installed'|'installed'|'running'|'error'|'downloading', progress?, pid?, message? }] }`
- `shell:components-install {id}` / `-start {id}` / `-stop {id}` / `-update {id}` / `-rollback {id}` / `-uninstall {id}` → `{ ok, error?, state? }`；进度经 `shell:components-progress {id, phase, percent}` 推送
- `shell:install-delta {tag}` → `{ ok, status: 'applied'|'fallback-full'|'error', error? }`；`status.deltas: { [tag]: { size, sha256 } }`
- `status()` 负载新增 `components` 数组与 `deltas` 表（车道 C/D 各自只写自己的键）
- 新 config 字段只允许 `components`（对象）一个命名空间，车道 C 独占读写

### 5.2 并行车道（§5.0 冻结后同时开工）

| 车道 | 范围 | 独占文件 | 出口（内部自查） |
| --- | --- | --- | --- |
| **A · UI 移植** | 原型 → `launcher.html`/`launcher.css`/`launcher.js`：融合顶部+方形窗控、rail 六分区、线路卡、进度卡、五态显隐；组件面板只留容器+script 挂点，版本页增量按钮按 `status.deltas` 契约渲染 | `src/renderer/launcher.html`、`launcher.css`、`launcher.js`、`src/renderer/window-controls.css`（方形对齐） | 旧五分区逐项等价；五态渲染正确；暗色正常；不接数据的面板显示空态不报错 |
| **B · 归因补齐** | spawn 外部桌面端 stdout/stderr 落盘 `logs/last-external-boot.log`（桌面状态目录），`collectForensics` 并入语料；`--skip-user-plugins` 不识时 profile 级禁用兜底 | `src/launcher/runtime-install.js`、`src/launcher/launcher-service.js`、`src/launcher/forensics-log.js`（新）、对应 `.test.js` | A9 链路：崩溃插件可归因；禁用走落盘不依赖 flag；测试覆盖 |
| **C · 组件平台** | 组件清单源、版本目录+原子切换、进程监管（PID/代际/退避）、装/跑/停/更/滚/卸；一个工具组件+一个服务组件样例 | `src/launcher/components/`（新目录全部）、`src/main/ipc-components.js`（新）、`src/renderer/launcher-components.js`（新）、样例组件目录 `components/samples/`（新） | 样例走完六生命周期；关窗驻留；故障不阻塞主路径 |
| **D · 增量管线** | 增量包生成器（发布侧）+ 启动器侧重建器+SHA-256 校验+三态回退；本机 0.3.2 已装版 ↔ 本地新构建实差分 | `src/launcher/delta/`（新）、`src/main/ipc-delta.js`（新）、`scripts/build-delta.mjs`（新）、对应 `.test.js` | 真实双构建重建哈希一致；三回退路径各实测 |
| **E · Gitee 实测** | 建 prerelease 测试 release→匿名元数据+附件下载→与 GitHub 同文件哈希对比→出证据记录 | 只写 `docs/superpowers/plans/` 下证据文件；**不改 `release-source.js`**（`verified` 翻转由集成步按证据执行） | 全链路匿名下载成功且哈希一致 → 允许翻转；否则产出失败原因 |

### 5.3 集成与收口（主上下文，串行）

1. 车道产物逐一合入：检查接缝守契约（IPC 名/payload/preload 名/文件边界），接缝冲突由主上下文裁断，车道产物不许互相改。
2. 按车道 E 证据翻转 `release-source.js` 的 Gitee `verified`（或写明原因保持禁选）。
3. `dist:launcher` 出 NSIS Setup。
4. **QA 审查车道**（独立审查子代理，非编写者）：按 §2.3 六维度复核全部 diff，出审查报告；问题修复后复审。
5. **实机矩阵**（§2.4）逐项跑并留证据（截图/日志/进程表），含 A9 崩溃插件闭环。
6. §2.1 验收单逐项配操作步骤 → 交付。

### 5.4 并行纪律

- 车道产物必须先过 `node --test <自有测试>` + `node --check` 再交回；不许把红灯交给集成步。
- 车道不得改契约；契约不够用就停下上报，由主上下文改契约再续。
- 每个车道汇报用同一格式：交付文件清单、测试结果、契约偏差（应为零）、未决项。
- 审查车道与编写车道分离；审查不通过回到对应车道，不算交付进度。

## 6. 进度记录

- **2026-09-24 A 批完成**：`src/launcher/launcher-service.js`（编排）+ `install-detect.js`（探测，`deps` 注入）落地；`ipc.js` 仅授权+传输；`update.js` 回导出兼容。147/147 定向测试通过。
- **2026-09-24 B-core**：`product.js` 包形态；`release-source.js` 双线路表；`runtime-install.js` 安装编排；`install-detect.js` 目标化；冷启动门 slim 分叉 + `--dshd-from-launcher` 直通；首页未安装卡 + 设置线路行；`checkDesktopUpdate` 未安装钳制；`shell:install-runtime`/`shell:cancel-runtime-install` 通道。184/184 定向测试；slim dev 实跑未安装态落安装卡。
- **2026-09-24 B-β**：`src/main-launcher/` 独立入口 + `ipc-launcher.js` 共享通道表；`electron-builder.launcher.yml` 独立打包 321.5MB（对照完整包 3759.3MB）；**userData 分离**（`extraMetadata.productName` 才有独立锁与 config；桌面状态经 `desktopStateDir` 显式指向）；**`startExternalDesktop` 12s 存活宽限**（spawn 秒退→落回可见启动器）；共存与降级 handoff 实测通过。全量 2326/2326、治理 6/6、doc-sync 8/8。
- **2026-09-25 重写**：批次汇报改为验收驱动（§2）；新增 P0（原型 UI 移植）为最高优先；Gitee 仓已公开（匿名 API/页面验证过），附件下载实测列入 P3；增量与组件从"等外部条件"改为本地可实测项。
- **2026-09-25 并行批次**：契约冻结（`extraChannels`/`statusContributors`/`components` config 命名空间/preload 方法名）后五车道并行交回：
  - A 车道：原型移植进真实 `launcher.html/css/js`（六分区 rail、方形窗控、`data-launcher-state` 五态、组件面板空容器 + `__launcherComponents` 挂载点）。
  - B 车道：`forensics-log.js` 外部运行时有界轮转启动日志（512KiB 尾部）+ `collectForensics` 语料并入；33/33。
  - C 车道：`src/launcher/components/` 平台 + `launcher-notes` 样例（v1→v2 HTTP 可观测升级/回滚/停/卸真 E2E）；31/31。
  - D 车道：`src/launcher/delta/` 零依赖 zip+manifest+应用（base-hash 预检、备份回滚、失败回退完整包）+ `build-delta.mjs`；本机 0.3.2↔0.3.3 双树实测 67/67 哈希一致；29/29。
  - E 车道：Gitee parity 实测通过（匿名元数据+302→CDN 附件下载+SHA512 逐字节一致）；发现 `/releases/latest` 返回 prerelease 差异→`releaseRaw` 收编过滤，`verified:true` 已开放。
  - 集成侧修复（实机揪出）：`stopExternalDesktop` 兼容新旧 exe 镜像名（更名遗产）；slim 模式 `disabledPlugins`/`pluginRecovery` 重定向写桌面端 `config.json`（`profile-ops` 加 `configIO` 缝）；外部 spawn 加 `ELECTRON_ENABLE_LOGGING=1` 让 stderr 落到启动日志；`last-desktop-start.json` 新增 `logTail`（失败瞬间内核日志尾部 80 行）补齐 slim 归因语料——实证：0.3.2 打包运行时的 cordis 加载错误不进 stderr 管道。
  - 打包实机验证：`Whale-Isle-Launcher-Setup-0.3.3.exe` / `win-unpacked` 实跑——六分区、方形窗控、线路卡双可选、组件页识别 bundled 样例并跑完 装→启(HTTP 200)→停→卸 全链、单实例锁、已装态共存探测全部通过。全量测试 2413/2423（8 红全部位于在途 dshbot/whale/vendor 批次，与启动器改动面零交集）。
- **2026-09-25 QA 对抗审查收口**（独立审查车道抓到 1 blocker + 3 major，全部修复并复验）：
  - delta 死按钮：`ipc-delta` 产出 `{deltas:{available:[...]}}` 与渲染端 map/array 消费形状不匹配→按钮永不渲染。修法：`release-source.js` 行级挂 `delta`（资产名 `*-delta-<installed>-<to>.zip` 匹配）+ 渲染端 `row.delta || deltaFor(tag)` 双路径兜底；DOM 级测试 `launcher-render.test.js` 钉死三形态（行字段 / payload.deltas 数组 / 无证据不渲染），`runtime-install.test.js` 补 `listFor` 行字段断言。
  - slim 托盘缺口：`src/main-launcher/tray.js`（显示窗口/退出）+ `bindLauncherClose` 关窗即隐藏（`hideOnClose` 契约；托盘创建失败退回默认关闭，绝不滞留无窗进程）。真机证据：关窗后 4 个启动器进程全存活、`document.visibilityState` visible→hidden→二次实例触发 `openLauncher` 重开 visible；组件 pid 不变且 HTTP 持续应答（A5 驻留 + A8 重开达标）。
  - `removePluginOp` 修复：卸载失败不再清 `disabledPlugins`（崩溃插件不会被静默放回）；写盘走 `pluginConfigIO`（slim 指向桌面端 `config.json` 原子写）。`ipc.test.js` 三条回归（成功清项/失败保留/slim 拒止）。
  - slim 无 vendored `dsh plugin`：`shell:remove-plugin` 与导入页插件重装在 slim 返回 `{ok:false,error:'desktop-only'}`；UI 相应行渲染「需在桌面端内移除」元信息并禁用勾选（真机验证：slim 插件行零个移除按钮、标签已渲染）。决策记录已原地同步（standalone-distribution 第 6 条）。
  - 附修：`packaged-p0.test.js` 断言随 `Whale Isle.exe` 产品改名更新。
  - 验证面：launcher+ipc+components+delta+renderer 定向 211/211；打包 slim 重出并重测托盘/组件驻留/拒止标签；governance 6/6、doc-sync 8/8。

## 7. 关联

- 主卡：[desktop-launcher](../../features/desktop-launcher.md)；拟议卡：[launcher-distribution](../../features/launcher-distribution.md)、[launcher-components](../../features/launcher-components.md)
- 决策：[启动器独立分发架构](../../decisions/proposed/architecture/2026-09-24-launcher-standalone-distribution.md)
- 相关既有决策：[electron-updater 差量通道](../../decisions/implemented/product/2026-09-17-electron-updater-differential-updates.md)、[冷启动更新检查退出自动启动](../../decisions/proposed/product/2026-09-22-nonblocking-startup-update.md)、[发布资产校验](../../decisions/proposed/process/2026-09-20-release-asset-validation.md)、[更新确认与导入归属](../../decisions/implemented/bug-fix/2026-09-24-launcher-update-import-ownership.md)
- 视觉唯一来源：[design-language](../../design-language.md)；UI 原型：[launcher-redesign](../prototypes/launcher-redesign.html)
