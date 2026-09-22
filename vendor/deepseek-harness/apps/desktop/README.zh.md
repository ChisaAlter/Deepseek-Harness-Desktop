# DeepSeek Harness 桌面端

[English](README.md) | 中文

桌面应用是完整 dsh Web 应用外的一层 Electron 壳。Electron RunAsNode 子进程启动共享 profile runner，Electron 立即从 `dsh-app://app/` 加载打包内的 Web 入口。共享加载页等待 Host 启动注入，然后在同一文档中启动客户端。Electron 将应用 HTTP 请求转发给已认证的 Web Host；WebSocket 流连接到该 Host，仅为归属的应用窗口附加凭据。Node IPC 承载启动注入、就绪与关闭。Desktop 默认使用端口 `19387`，与 Web 的 `3080` 分开；可通过 `webserver.config.port` patch 覆盖。

应用菜单第一项“**关于 DeepSeek Harness**”打开 Electron 原生关于面板，展示应用图标、产品名称和当前安装的发布版本。菜单文案跟随桌面壳的语言。macOS 从应用包读取图标，因此未打包的开发启动会显示 Electron 图标；Windows 使用随包分发的 PNG。

Desktop 的本地原生目录流程打开绑定应用窗口的 Electron 文件夹对话框，并先恢复、显示和聚焦该窗口。并发请求共用一个对话框；取消不返回路径，失败后可以重试。普通 Web 使用 Host 选择器。浏览模式列出 Host 目录。Linux 缺少 zenity 或 kdialog 时，自动选择使用浏览模式，不使用 Electron 对话框。

Creator 和 Web Plugin Manager 在 Electron Node 模式下使用 Desktop 内置 pnpm，无需 PATH 中存在 pnpm。私有 Node 启动器环境仅应用于包操作。

## 关键技术决策

设计师原稿位于 `resources/icon.png` 和 `resources/icon.svg`；平台适配保留鲸鱼与渐变，分别位于 `resources/icon-windows.*` 和 `resources/icon-macos.*`。将各平台 SVG 导出为透明的 1024×1024 PNG。electron-builder 为 Windows 应用、安装程序和卸载程序生成多尺寸 ICO（[Windows 图标要求](https://learn.microsoft.com/en-us/windows/apps/design/iconography/app-icon-construction)）。安装页面在两种主题下使用匹配的图案；卸载程序的欢迎和完成页共用 `installer/assets/uninstaller-sidebar.png`，准备阶段将其转换为 164×314 BMP。

macOS PNG 使用带留白的圆角底板，供传统 ICNS 打包使用，包含最高 1024 像素的表示。它是扁平图标，并非 Icon Composer 文档。Apple 的[应用图标指南](https://developer.apple.com/design/human-interface-guidelines/app-icons)要求向 Icon Composer 提供未遮罩的图层；这些输入需要在 macOS 上单独导出，不能复用已做圆角的 ICNS 图案。发布前须在支持的 macOS 版本中验收 Finder 和 Dock 的显示效果。

### 内置工作区依赖

Windows 签名打包保留有效的上游签名，并在执行冒烟检查前，为第一方运行时中未签名的 PE 可执行文件、DLL、Python 扩展和 Node 插件补签。每个新签名必须匹配配置的证书且带时间戳；已有签名无效、签名错误或验签错误都会停止本轮执行，不自动重试。electron-builder 只有在校验复制后运行时可执行文件的签名、且文件与已准备的源文件逐字节一致后，才保留其签名，避免复制资源时重复签名。检查覆盖 decimal、XML、LZMA、UUID、numpy 和 pandas。开发、仅准备和未签名构建不使用硬件令牌，可能被 Windows 代码完整性策略阻止；任何构建模式都不会关闭该策略。冒烟检查通过不代表所有扩展或企业策略都兼容。

Desktop 携带独立的 Python、Node.js 和 pnpm 分发包。Python 包含 numpy、pandas、python-docx、python-pptx、openpyxl、Pillow、lxml、XlsxWriter 及其完整依赖。`load_workspace_dependencies` 工具首次使用时，将该产物离线安装到 `$DSH_HOME/dsh-runtimes/dsh-primary-runtime`（通常为 `~/.dsh/dsh-runtimes/dsh-primary-runtime`），并返回解释器、pnpm 脚本和库目录的绝对路径，以及记录内置分发包名称与版本的 `pythonDistributions`。版本报告不包含用户自行安装的包。Office 任务默认使用这些库，用户或工作区指令指定其他环境时遵循其要求。pnpm 脚本通过返回的 Node 可执行文件运行。返回的 Node 库目录为随包交付的库预留，不是 pnpm 的全局安装目录。

Desktop 默认注册 `office-docx`、`office-pptx` 和 `office-xlsx`。这些技能使用内置 Python 库创建文件和进行定点编辑，随后重新打开文件，并在交付前运行共享结构检查器。PowerPoint 的创建和编辑使用 python-pptx。技能资源复制到 ASAR 外的 `runtime/office-skills`，让 Python 可以读取检查器。可用的 `render_document` 工具可以补充视觉检查；缺少该工具不妨碍创作或交付。检查范围与限制见 [Office 技能包](../../packages/skill/skill-office/README.zh.md)。

该产物随 Desktop 版本发布。`runtime.json` 记录 Desktop 版本、目标平台、组件与 Python 分发包版本，以及所选目标的锁定产物输入与组装格式的摘要。分发包名称按 PEP 503 归一化；名称归一化后重复，或 numpy/pandas 的组件版本与分发包版本冲突时，清单会被拒绝。匹配的安装会被复用；依赖或压缩包变化后，即使 Desktop 版本不变，也会在完整暂存副本完成后替换目录。不含摘要的旧清单会在下次安装时被替换。用户自行添加的 Python 包仅在产物身份一致时保留。目录替换失败时保留之前的安装；解释器仍在运行时，Windows 可能拒绝替换。

Desktop 私有的 `runtime/bin` 目录仅添加到包安装进程，不进入 PTC 和 agent shell 从 Host 继承的 PATH。该工具不修改 PATH、环境变量或用户包管理器配置。pnpm 的全局包、命令入口和 store 保留自身默认值及用户设置，包括环境不支持全局安装时的原生错误。不提供独立依赖更新器。[第一方 Runtime 决策](../../.agents/notes/implemented/feature/2026-09-14-desktop-primary-runtime.zh.md)记录这些选择。

Node 准备内置解释器和 Python 库，无需系统 Python 或 pip。[下载锁](scripts/primary-runtime-lock.json)固定解释器压缩包、Python 分发包版本及目标平台 wheel 的 URL 和哈希；pnpm 使用 Desktop 构建依赖锁。每个目标的 wheel 文件名必须与分发包版本一致。所选目标、wheel 记录及分发包映射内部的键顺序，以及 wheel 条目顺序都会影响产物身份，编辑时须保留；锁文件顶层键的顺序不影响该身份。库 wheel 解压到 site-packages，各 wheel 的 `.data/scripts` 目录保留辅助文件，不生成命令行包装器。其他安装方案会被拒绝。本机目标检查在清理暂存目录后以及 macOS 签名后验证锁定 wheel 的集合与版本，允许解释器自带的 pip，并检查 Python 版本、Office 文档读写和依赖完整性，不写入字节码。独立 Node 可执行文件获得 V8 所需的 JIT 权限。跨目标执行和签名安装需要对应的发布主机。`dev:desktop` 和 `start:desktop` 都会在启动 Electron 前准备 `.desktop-build/targets/<target>/runtime/primary-runtime`；首次准备可能需要下载锁定的依赖。准备未完成时，启动命令不能报告成功退出。

| 决策 | 原因 | 直接结果 |
|---|---|---|
| 发布身份 | 桌面壳 API、Web 客户端、后端与插件依赖图作为一个组合完成验证；独立版本会产生未经验证的组合，并让更新可用性含糊不清。 | Electron 与 `@deepseek-ai/dsh` 始终使用同一精确版本。即使桌面壳代码不变，升级 dsh 也必须发布新 Desktop 版本。 |
| 运行时 | 应用必须能够在没有系统 Node.js 或 pnpm 的机器上运行。 | dsh 通过设置 `ELECTRON_RUN_AS_NODE=1` 和 `--expose-internals` 的 Electron 运行，所有包操作都使用内置 pnpm。包管理器配置和 Host 环境遵循用户设置。包脚本通过 `node` shell 启动器转发给 Electron。 |
| 包来源 | 即使离线，启动时安装核心依赖也会增加开销。 | `app.asar/dsh` 携带完整生产依赖树；profile 只安装外部插件。 |
| 状态归属 | 共享可执行依赖图会让 CLI（命令行界面）与 Desktop 相互改变 dsh、Cordis、插件或原生模块版本，而两个桌面进程还可能争用同一个 profile。 | Electron 在访问任何 profile 前获取进程生命周期单实例锁，并独占 `$DSH_HOME/profiles/desktop` 及其包管理器状态。CLI 与 Desktop 共享 `$DSH_HOME` 下受支持的产品数据，但绝不共享可执行包、插件激活、锁文件或 `node_modules`。 |
| 传输 | Web 服务与认证共享一套实现。 | Electron 加载打包的 Web 资源；Host 提供启动注入和经过认证的 API。 |
| 插件变更 | Desktop 与 Web 需要一致的安装和激活行为。 | 主应用使用共享 Web 插件管理器和内置 pnpm。 |
| 更新 | 桌面壳与 dsh 独立更新会重新产生版本分裂，而桌面壳未变化的数据块不应强制完整传输。 | Electron 壳、匹配的 dsh 运行时与 pnpm 组成一个已签名更新单元。平台更新产物可以复用未变化的数据块，但运行时版本选择绝不脱离 Desktop 发布。 |

[薄壳决策](../../.agents/notes/implemented/architecture/2026-09-10-desktop-web-wrapper.zh.md)负责共享 Web 行为与 Desktop 适配。[Electron 打包与更新决策](../../.agents/notes/implemented/architecture/2026-08-25-electron-desktop-packaging-and-updates.zh.md)负责发布身份、签名及更新验收。

## 安装归属

Electron 拥有 `$DSH_HOME/profiles/desktop`。其 `dependencies` 包含 pnpm 安装的包；`dsh.profile.bundles` 包含内置 bundle，后接已启用插件。签名应用从 `resources/app.asar/dsh` 提供 dsh、私有 Desktop Host 及其生产依赖。打包应用选择 runtime profile 解析，不创建包链接；开发 profile 使用文件系统链接。宿主与插件在同一个 Electron Node 模式进程中执行；Desktop 不启用 `--preserve-symlinks`。CLI 不能启动或修改此 profile。

应用 preload 暴露启动就绪、致命启动失败上报和原生目录选择。产品页面还获得 Desktop 标记、更新展示数据和打开原生确认的操作，不能选择安装产物或授权安装。插件管理使用 Web 应用经过认证的 HTTP API；Electron 不提供插件管理 IPC 或独立管理页面。

产品 UI 保留 Web 操作，包括通过共享认证 HTTP 路由执行的“打开方式…”。Desktop 使用 Web 的自动目录选择机制，并以共享 Web 模板的 bundle 列表初始化新 profile。

Electron 根据应用语言选择类型化的英文或中文 shell 文案，并回退到英文。在 Windows 上，主文档的语言会更新桌面菜单、恢复与更新提示。仓库 Client UI i18n 检查覆盖桌面端源码。

Windows 使用 40 DIP 顶栏，保留原生窗口按钮，颜色随应用调色板同步。侧栏开关旁的本地化“应用”和“编辑”入口打开原生弹出菜单。仅当应用框架发布 shell overlay 席位后才挂载菜单，启动加载期间不显示。“应用”提供检查更新和退出；“编辑”向当前编辑器发送对应按键，提供撤销、重做、剪切、复制、粘贴、删除和全选。插件管理使用主应用的“插件”页面。按 Alt 不会出现额外的原生菜单行。其他平台保留原生菜单。可编辑区域保留快捷键和不带快捷键标注的右键菜单；命令可用状态由 Chromium 提供，选中的只读文本提供“复制”命令。

macOS 上自定义应用菜单还会声明标准的 File、Window 和应用菜单，因为替换 Electron 的默认菜单会丢掉 Close Window（⌘W）、Minimize（⌘M）和 Hide（⌘H）。Linux 保留应用菜单和 Edit 菜单。

### 运行时与插件激活

签名资源中的 `resources/app.asar/dsh/desktop-runtime.json` 绑定 shell 版本、Electron 的 Node 版本、平台、架构、共享包版本和最终文件清单。启动读取元数据，并检查共享包记录。发布 schema、shell 版本、目标兼容性和文件完整性在打包时验证。首次启动不会把核心包复制到 profile 存储或通过 pnpm 安装核心包。

1. 主窗口在 profile 准备或后端启动前，从打包静态资源显示共享 Web 加载页。共享 profile 初始化创建缺失的 manifest、空用户 patch 与 pnpm workspace 文件，不覆盖现有文件。
2. 生产版在启动 Host 前，清理当前运行包清单或已记录 Desktop 包清单中各包的 profile 副本和回退链接，同时删除对应依赖声明与 overrides；清理改变包状态时丢弃锁文件。其他插件文件、配置和版本保留；开发模式跳过此清理，启动时不运行 pnpm。
3. Electron 的 Node 版本、平台或架构变化时保留已安装插件。原生兼容性问题在加载时报错，可通过 pnpm 修复。
4. 主应用的“插件”页面通过共享[插件管理器](../../packages/boot/plugin-manager/README.zh.md)操作 Desktop profile。包操作使用内置 pnpm 及正常的用户和 profile 配置。
5. 共享管理器负责安装错误、激活和重启要求。即使 Host 无法启动，原生恢复仍可禁用第三方 bundle。

[Web 插件 UI](../../packages/client/ui-plugin-manager/README.zh.md)负责管理界面。Desktop profile 初始化和恢复保留已安装插件文件。

主窗口创建、主文档加载、preload、渲染器、Web 初始化或后端的致命失败，会在每个应用进程中打开一次原生恢复对话框。对话框显示首次错误末尾的限长摘要，标明截断情况，并提供退出、重启、禁用第三方插件、备份 profile patch 并重启。启动失败保留 Web 加载页和动画；运行中失败保留当前页面。预期关闭、取消导航和普通请求错误不会触发恢复。共享 Web 插件管理器报告包操作错误；插件变更后的 Host 启动失败会进入原生恢复。不通过启动超时推断故障。 包含 `listen EADDRINUSE` 的监听失败以退出其他正在运行的 DSH 实例的提示替代诊断和重装建议，仅提供退出和重启。

原生弹窗详情最多包含 1,200 个 UTF-16 代码单元和八行诊断；完整的已报告错误写入 Electron 控制台。Host 错误诊断仅保留 stderr 输出的最后 64 Ki 个字符。更早的输出会被丢弃，避免长期运行的 Host 使壳的诊断缓冲区无限增长。

恢复操作等待 Host 关闭后才修改插件启用状态。原生恢复操作在 profile 事务锁内调用共享 app-boot 恢复函数。它禁用第三方 bundle，并将 profile 的 `cordis.patch.yml` 重命名为 `cordis.patch.yml.bak-<timestamp>`（重名时追加序号），无需解析；下次启动创建空 patch。已安装包和已有备份保留。home 级 patch 不变。Electron 控制台记录备份路径（或原文件不存在）以及 home 级 patch 未修改。profile 数据无效、重命名失败或写入失败会作为恢复操作错误报告；已完成的修改保留，Desktop 不会假装恢复成功后重启。Desktop 不提供 profile 重置操作或应急 HTML 文档。

包事务独占 `$DSH_HOME/profiles/desktop/lock`，直到 pnpm 进程退出。pnpm 运行前，共享模块回退辅助函数只删除其拥有的链接，保留 pnpm 管理的目录；开发 Host 在启动时重建所需链接。链接清理保留目标目录。原生构建遵循 pnpm 配置的构建策略；发布准备使用独立的构建期允许列表。

## 开发

`dev:desktop` 会构建当前 Host、客户端 bundle、Web 前端和 Electron 壳，把已构建的 CLI 包、私有 Desktop Host 包及其 workspace 依赖投影为一次性桌面 npm 项目，然后直接启动 Electron；这条路径不从 npm 解析 dsh：

```sh
pnpm run dev:desktop
```

开发 Harness 状态默认写入 `apps/desktop/.desktop-build/development/home`，一次性 npm 项目位于 `apps/desktop/.desktop-build/development/project`，Electron 浏览器数据则位于 `apps/desktop/.desktop-build/development/electron-user-data`。因此，会话、设置、凭据、包链接和浏览器数据都不会进入用户正常使用的 Harness home；显式 `DSH_HOME` 只会替换开发 Harness home。Renderer DevTools 默认自动打开，Main、Renderer 和 dsh Host 调试端口依次为 9229、9222 和 9230。`DSH_DESKTOP_MAIN_INSPECT_PORT`、`DSH_DESKTOP_RENDERER_DEBUG_PORT` 与 `DSH_DESKTOP_HOST_INSPECT_PORT` 可以替换这些端口，`DSH_DESKTOP_OPEN_DEVTOOLS=0` 则保持 Renderer 调试窗口关闭。

显式构建完成后，`start:desktop` 会重新生成一次性项目，并跳过构建直接启动已有产物：

```sh
pnpm run start:desktop
```

Workspace 开发使用 Electron RunAsNode 运行当前 CLI 与私有 Desktop Host 包，插件管理和恢复使用 `$DSH_HOME/profiles/desktop`，与一次性工作区运行时分离。Host 在开发与打包构建中都使用 runtime 模块解析，不创建官方包的 fallback 链接；开发者安装的包（包括链接）保留原生优先级。需要验证 Electron RunAsNode、内置 pnpm、内置 dsh 资源、插件安装和修复时，应运行未封装安装器的应用目录。

## 打包

<a id="release-versions"></a>

### 发布版本

每次 Desktop 打包前，第一步都要与当前用户确认完整版本号。检查所选部署环境、dsh 基础版本、保留的发布记录和已发布对象，再提出准确版本供用户确认。用户确认前，不得修改发布家族清单或启动打包；仅选择部署环境不代表用户已认可版本号。

修改任何清单前，记录当前 dsh 版本作为基础版本。production Desktop 使用完全相同的版本，包括其中的 `alpha`、`beta` 或 `rc` 标识。test 发布保留完整的预发布基础版本并追加 `.YYYYMMDD.index`；稳定基础版本则追加 `-test.YYYYMMDD.index`。

| dsh 基础版本 | production Desktop | test Desktop 示例 |
|---|---|---|
| `0.1.6-alpha.1` | `0.1.6-alpha.1` | `0.1.6-alpha.1.20260916.1` |
| `0.1.6-beta.2` | `0.1.6-beta.2` | `0.1.6-beta.2.20260916.1` |
| `0.1.6-rc.3` | `0.1.6-rc.3` | `0.1.6-rc.3.20260916.1` |
| `0.1.6` | `0.1.6` | `0.1.6-test.20260916.1` |

日期使用实际创建时的 Asia/Shanghai 日期。每个基础版本、每天的序号从 1 开始，检查保留的发布记录与已发布对象后递增；绝不复用已发布版本。只从记录的基础版本派生一次，不从已有测试后缀的清单继续追加。最终根包、Desktop、内置 dsh、私有 Desktop Host 和其他发布家族清单必须全部使用同一个派生版本。test 分发不发布对应的无后缀基础版本。

版本派生不改变固定更新通道，也不改变 `nightly.yml` / `nightly-mac.yml` 文件名。SemVer 排序为 `0.1.6-alpha.1 < 0.1.6-alpha.1.20260916.1 < 0.1.6-alpha.2`，稳定基础版本的测试版低于该稳定版。客户端只接受更高版本：替换 feed 无法让已安装的较高版本更新到较低的纠正版。这类客户端需要手动安装；保持自动降级关闭。[版本决策](../../.agents/notes/implemented/process/2026-09-16-desktop-release-version-derivation.zh.md)解释为什么不能用通道名替换预发布标识。

打包、上传以及手动 macOS 签名检查使用 `apps/desktop/.env.windows` 或 `.env.macos`，由目标平台选择。复制对应的 [Windows 模板](.env.windows.example) 或 [macOS 模板](.env.macos.example)，填写本机配置；Git 忽略这两个本地文件，安装产物也不包含它们。发布字段只从目标文件读取，不回退到系统或 shell 中的同名变量；`PATH`、代理和构建工具环境仍保留。文件使用 UTF-8，支持 BOM；相对证书、SignTool、Apple API Key 和钥匙串路径以 `apps/desktop` 为基准，变量值不做 shell 展开，包含 `#` 或空格的密码需要引号。CI 同样在运行前生成目标文件。

每条打包命令在构建与下载前检查应用 ID、更新地址和该模式需要的签名配置。macOS 检查身份、Team ID、一套完整公证凭据、`CSC_LINK` 指定的可读本地 p12 文件、显式配置的 `CSC_KEY_PASSWORD`，以及引用的 API Key 和钥匙串文件；Windows 检查公开代码签名证书、SignTool 文件、容器名称和 PIN 格式。仅准备 Windows 资源或显式未签名打包不要求签名凭据。配置检查不验证 PIN 是否正确、Token 是否登录、钥匙串是否解锁或 Apple 是否接受凭据；实际签名与公证负责这些检查。单独运行相同检查：

```sh
pnpm --dir apps/desktop run check:package
```

无需提前执行 `prepare:desktop`：

```sh
pnpm run package:desktop
```

发布自动化使用固定目标命令，确保运行时准备、dsh 准备与 electron-builder 接收相同的平台和架构：

```sh
pnpm run package:desktop:mac:arm64
pnpm run package:desktop:mac:x64
pnpm run package:desktop:win:x64
```

macOS arm64 命令要求 Apple Silicon。macOS x64 命令可以在 Intel macOS 或带 Rosetta 的 Apple Silicon 上运行。Windows x64 命令要求 Windows x64。Linux 不是受支持的 Desktop 发布目标。

每个目标都在 `apps/desktop/.desktop-build/targets/<target>/` 下持有自己的打包输入、已准备运行时、包集合、dsh 依赖树、pnpm 准备状态、未打包应用、更新元数据和最终产物。Electron 归档缓存继续由 `.desktop-build/downloads` 共享，因为每个归档文件名都包含版本、平台和架构，并且在解包前经过验证。目标构建绝不读取其他目标的可变准备状态。

### 运行时文件筛选

Desktop 在本地打包工作区包，并通过目标捆绑的 Node 和 pnpm 安装外部依赖。[Desktop 文件策略](scripts/runtime-file-policy.ts)随后在签名和完整性封装前过滤不可变的 `resources/app.asar/dsh/node_modules` 副本。它排除 TypeScript 声明、已识别的 JavaScript/CSS/TypeScript source map、TypeScript 构建缓存、Domino 测试目录、选定的原生编译器输出和其他平台的 node-pty 预构建文件。它保留运行时 JavaScript、原生模块及其 DLL/EXE 辅助文件、WASM、未知资源、许可证和 notices。该策略不修改 npm tarball、捆绑的包管理器或用户安装的插件文件。

[Office 转换提供方](../../packages/document/office-to-pdf/README.zh.md)携带目标已声明的原生引擎；kit 未声明匹配原生目标时携带 WASM 引擎。准备阶段在打包前拒绝缺少目标引擎的情况。引擎资源、许可证和 notices 保留在运行时依赖树中。

打包应用运行编译后的 JavaScript 和预生成的 Typert 元数据，不编译 TypeScript 插件。源码级调试导航和编辑器声明仍可从开发包中获取。[复制规则测试](tests/runtime-file-policy.spec.ts)覆盖排除项和保留资源；`prepare:dsh` 在 Host smoke 和最终清单验证之前，使用 Electron RunAsNode 执行[产物 smoke](tests/fixtures/runtime-payload-smoke.mjs)。

Windows 发布验收还需在 Desktop 构建后手动运行[目录和替换检查](scripts/smoke-windows.ps1)。将 `$Makensis`、`$SevenZip` 和 `$PluginDir` 分别设为锁定版本构建器的 NSIS 编译器、7-Zip 可执行文件和 x86-unicode NSIS 插件目录。从仓库根目录运行以下命令。它验证 目录替换与回滚和两种文件占用替换方式；不属于单元测试通道。

```powershell
pwsh -NoProfile -File apps/desktop/scripts/smoke-windows.ps1 -Makensis $Makensis -SevenZip $SevenZip -PluginDir $PluginDir
```

Windows 安装器先将新版本解压到安装目录旁边，再退出旧应用并通过同卷目录改名完成替换。同路径升级在替换成功前保留旧目录；解压失败时旧版不变，替换失败时尝试恢复旧目录。安装器在启动前清理旧版备份。强制结束安装器或断电可能留下 `.new-*` 或 `.old-*` 目录；不同安装位置或安装范围迁移仍使用 electron-builder 的旧卸载器流程。

### 上传更新

test 与 production 的 `upload:*` 上传在发布前置检查通过后，分别保留新的 `.desktop-build/upload-records/<environment>-<target>-*` 目录。`plan.json` 记录目标、版本、每个文件的大小/SHA-512 和发布的 YAML 字节；刷盘的 `events.jsonl` 记录 PUT 意图及可用的响应状态/请求 ID；`result.json` 记录完成结果或最后失败阶段。缺少最终结果表示中断或存储不可用，不表示成功。不记录凭据值、认证头或原始 SDK 错误。审计写入失败即停止后续 PUT。每个对象都以一次流式腾讯 COS PUT 上传，并携带显式长度与 Content-MD5；COS SDK 仅在请求体不是流时才会重发请求，上传器自身也不重试。保留部分记录，检查远端状态后再执行下一次操作：超时或回执写入失败不能证明对象未存储。这些记录仅在本地，不防篡改，也不会自动备份；每次发布应将它们与构建证据一同归档到受控存储。公网 CDN 回读仍是单独的发布验收，上传结果明确标记为 `not-performed`。

Windows 操作人员可以在仓库外保存 CLIXML 对象，其中 `SecretId` 和 `SecretKey` 是经 DPAPI 加密的 SecureString 字段。[凭据启动器](scripts/upload-with-credentials.ps1)要求显式提供 `-CredentialFile` 和 `-Environment production` 或 `test`；不指定 `-Upload` 时，只验证解密以及向本地 Node 子进程注入凭据，不发起网络请求。它要求 `PATH` 中有 Node，并使用加密该文件时的 Windows 用户和机器。明文、空字段及纯空白字段都会失败。父进程环境保持不变；子进程先清除无关密钥与 Node 预加载选项，再仅接收所选 COS 凭据对。原始子进程 stderr 不会显示，stdout 中的凭据值会被遮盖。此检查不能证明 COS 授权有效。显式上传还要求 `-Upload -Target <target> -Bucket <bucket>` 及下述常规发布完成前提；真实云端上传仍需发布操作人员验收。此启动器支持长期密钥，不支持 STS 凭据。显式上传要求所选部署环境和 bucket 与目标 dotenv 文件及已完成的打包记录一致，才会发起网络写入；即使 dotenv 文件含有其他 COS 密钥，也使用 DPAPI 凭据对。

`DSH_DESKTOP_AUTO_UPDATE_ENV` 同时选择打包写入的 URL 与后续 COS 上传环境，可取 `test` 或 `production`；缺省为 `test`。测试打包通过 `DOWNLOAD_TEST_ORIGIN` 提供 HTTPS origin；生产使用 `https://download.deepseek.com`。上传通过 `DOWNLOAD_TEST_COS_BUCKET` 或 `DOWNLOAD_PROD_COS_BUCKET` 提供所选 bucket。清单目录为 `dsh-desk/feeds/<target>/`；带版本的安装包和 blockmap 位于 `dsh-desk/bin/<target>/`。目标为 `mac-arm64`、`mac-x64` 和 `win-x64`。

更新目标与上传凭据都与所选环境对应：

| 环境 | 公开 origin | COS bucket | COS 凭据 |
|---|---|---|---|
| `test` 或未设置 | `DOWNLOAD_TEST_ORIGIN` | `DOWNLOAD_TEST_COS_BUCKET` | `DOWNLOAD_TEST_COS_SECRET_ID`、`DOWNLOAD_TEST_COS_SECRET_KEY` |
| `production` | `https://download.deepseek.com` | `DOWNLOAD_PROD_COS_BUCKET` | `DOWNLOAD_PROD_COS_SECRET_ID`、`DOWNLOAD_PROD_COS_SECRET_KEY` |

在目标 `.env` 中配置更新地址与所选 COS bucket、SecretId、SecretKey，再打包并上传同一个目标：

```sh
pnpm run package:desktop:mac:arm64
pnpm run upload:mac:arm64
```

内测打包在目标 `.env` 中显式设置 `DSH_DESKTOP_AUTO_UPDATE_ENV=test` 和 `DOWNLOAD_TEST_ORIGIN=https://download-test.deepseek.com`；上传使用 `DOWNLOAD_TEST_COS_BUCKET=bj-toc-download-test-1320056602` 及独立测试凭据。test 和 production 都使用固定 Nightly 通道，部署选择不提供通道切换。

前期内测包使用 `test` 部署。只有正式发布才显式选择 `production`；更换上传凭据不会改变已有安装包的更新目标。打包不需要 COS 凭据，会禁用 electron-builder 发布、移除子进程的 COS 凭据，并且仅在签名与公证成功后记录完成状态。上传在读取凭据前验证该记录、部署、目标、共同版本号、文件名、大小与 SHA-512。安装包和 blockmap 先于 YAML 上传；历史对象继续保留。每个版本发布 `nightly.yml` 或 `nightly-mac.yml`；稳定版本还发布指向相同产物的 `latest.yml` 或 `latest-mac.yml`。发布的 YAML 使用安装包绝对 URL。上传器不设置 Cache-Control，包括 COS SDK 否则会添加的空头部：缓存策略由部署基础设施负责，清单不缓存，安装包缓存单独配置。同一目标应串行发布，并在发布验收前验证公网产物与清单内容。

macOS 配置使用必填发布环境，不会接受钥匙串中最先发现的证书。空值、格式错误的 Team ID、包含 electron-builder 不支持的 `Developer ID Application:` 前缀的签名身份，以及不完整的公证凭据都会被拒绝。macOS 打包要求已配置的身份及其私钥可用。运行时准备会把该身份、安全时间戳与 hardened runtime 应用到每个内嵌 Mach-O 文件；应用签名完成后，深度严格检查会拒绝其他叶证书 Authority 或 Team ID，验证通过才生成发布产物。macOS 固定目标安装包命令为已签名应用创建独立副本，并发执行两条产物流。一路先公证 App 并钉票，再生成 ZIP 及其更新元数据。另一路把已签名 App 副本封装进签名 DMG，再公证 DMG、钉票并验证；其中的 App 不单独附加票据。只有两路均成功结束，产物才会移入最终目录并写入发布完成记录。仅生成目录的命令同样需要公证凭据，并等待 Apple 公证和 App 钉票完成。[并行公证决策](../../.agents/notes/implemented/process/2026-09-09-parallel-macos-notarization.zh.md)负责副本隔离与容器票据语义。`CSC_LINK` 必须指向包含 Developer ID Application 证书及私钥的本地 p12，不支持 URL 或 Base64 输入。`CSC_KEY_PASSWORD` 是其导出密码，不是 Apple 账号或登录密码；未加密的 p12 可显式填写空值。构建前，打包流程自动创建并解锁私有临时钥匙串、导入 p12、授权签名并签署小型探针。运行时与 App 签名显式使用该钥匙串，无需预先配置或手动解锁登录钥匙串。子进程只接收钥匙串路径，不接收 p12 密码。成功或普通失败后删除临时钥匙串；强制终止后由 CI 清理临时凭据。CI 从密钥存储生成证书文件和 `.env.macos`，限制文件访问权限，并在作业结束后删除二者。环境中的 `CSC_NAME` 与证书发现顺序都不能选择发布所有者。公证凭据也可以使用 electron-builder 支持的完整 Apple ID 或钥匙串 profile 方式。手动执行 `pnpm --dir apps/desktop run verify:mac-signature -- <path-to-app>` 重复应用检查时，也必须提供两个 macOS 身份变量。

macOS 签名遍历真实文件，不跟随 Framework 的软链接别名。PAK 资源保留全部随附语言，由外层 Framework 或应用签名记录完整性，不逐个签名。[发布策略](../../.agents/notes/implemented/architecture/2026-08-25-electron-desktop-packaging-and-updates.zh.md)负责依赖补丁和验证要求。

可通过公司代理加速向 Apple 公证服务上传。代理配置参见公司内部文档。

### 未签名 Windows 测试安装包

在 Windows x64 上，使用完整的未签名打包命令进行本地安装测试：

```sh
pnpm run package:desktop:win:x64:unsigned
```

该命令要求设置 `DSH_DESKTOP_APP_ID` 并具备常规构建依赖，包括编译原生模块所需的 Python 和 Visual C++ 构建工具。Python 不在 `PATH` 中时，将 `PYTHON` 设置为其可执行文件路径。命令将安装包写入 `.desktop-build/targets/win-x64/unsigned-artifacts/`，省略自动更新配置，清除签名凭据，且不生成发布完成记录。它不需要 EV 凭据或更新源地址。签名打包和上传命令仍遵循正式发布要求。

### Windows 安装界面

Windows 安装程序使用原生 NSIS 页面，提供亮暗配色、系统阴影、可编辑的安装目录，以及默认勾选立即启动的完成页。安装仅面向当前用户。点击安装或按 Enter 均校验当前路径；新安装位置必须为空，非空位置必须是已登记的安装目录。受影响安装路径中的程序运行时显示系统提示，并保持应用运行；其他目录中的同名应用不阻止安装。静默更新最多等待受影响应用退出十秒，若仍在运行则以退出码 2 结束。

主题在启动时跟随 Windows；可用 `/THEME=light`、`/THEME=dark` 和 `/THEME=auto` 显式选择配色。窗口在品牌控件准备完成后显示。欢迎页首次出现时，安装窗口会一次性移到普通窗口前方；若焦点在其他窗口，任务栏按钮会闪烁提示，但安装窗口不会始终置顶。进度读取锁定版本的 7-Zip 解压器百分比；目录替换、注册和清理仍使用有界估算。加权百分比不代表剩余时间。NSIS 报告成功后，进度条用 600 毫秒补满并短暂显示 100%，再显示完成页；切换目标时长为 750 毫秒。完成页保留窗口位置。点击完成后，安装程序先隐藏窗口，再启动已安装的可执行文件；启动失败会恢复页面以供重试。目录替换和失败恢复遵循上文描述的安装流程。首次启动的配置档案准备仍属于独立的 Desktop 操作。

Windows 打包使用 Visual C++ Build Tools 和 Windows SDK 编译 x86 Win32/GDI+ 辅助库；签名构建通过已配置的 Windows 签名器对该库签名。准备钩子在所有平台上均由 electron-builder 继续负责收集生产依赖。[安装界面决策](../../.agents/notes/implemented/architecture/2026-09-10-windows-native-installer-pages.zh.md)记录 NSIS 接入方式和发布验证要求。

在有交互式桌面的 Windows x64 上，从仓库根目录运行 `pnpm --dir apps/desktop run test:installer`，可将小型原生测试载荷接入正式安装配置并执行验证。每次运行使用独立产品身份，依次验证仅英文和仅中文的安装器变体，并根据实际显示的欢迎页按钮选择测试文案。两个变体均安装到私有目录并在测试后卸载；截图和结果保留在 `.desktop-build/installer-tests/` 下。检查包含末尾带分隔符的已登记路径升级，以及磁盘根目录拒绝。可选的 `--signed` 标志使用下文的 Windows EV 配置，在嵌入前对测试程序和辅助库签名；它不会启用更新源。

### Windows EV 签名

Windows 签名构建在编译或准备依赖前执行受监督的签名预检。静态配置、证书有效期、审计存储、编译器可用性及遗留签名锁的检查不访问 Token。本地 .NET Framework C# 编译器生成一个专用小探针，由正式签名器仅签名一次，随后必须验出配置的证书和时间戳才能继续构建。探针绝不执行。预检超过 60 秒、签名报错或验签失败都会停止本轮流程，不重试。成功只证明当前签名路径可用，不证明 PIN 已独立认证：SafeNet 可能复用登录状态。不要为了验证 PIN 而注销或重复认证。`--check`、仅准备和 `--unsigned` 模式不执行此硬件预检；未签名产物仍不能发布上传。自动回归测试使用假签名器，真实硬件由发布操作人员单独验收。

Windows NSIS 上传要求安装包旁存在生成的非空 `.exe.blockmap`。blockmap 先于通道 YAML 上传；NSIS 安装包元数据不要求另一种 web-installer 格式使用的内嵌 `blockMapSize`。文件清单测试使用固定版本构建器的 blockmap 生成器，而不是手工编造内嵌映射字段。

签名 Windows 配置从同一份公开证书的 `CN`、`O` 和 `C` 属性生成 updater 的 `publisherName`。每个属性都必须存在、非空且只有一个值。这些身份属性允许证书续期，无需固定叶证书指纹。已安装应用的 `app-update.yml` 保存预期发布者，下载的清单不能选择该身份。未签名测试构建省略 updater 配置。真实文件验证及其限制见[签名验收记录](tests/README.zh.md)。

本项目使用的 SafeNet Token 出现 `SignTool Error: No private key is available.` 时，说明 PIN（密码）错误。立即停止所有签名尝试，等待用户处理 PIN 后再继续。PIN 输错达到五次会锁定 Token。遇到该错误后，不得重试打包或签名探针。签名器串行执行 Token 操作，首次失败后拒绝所有排队任务。

Windows 打包命令通过 `DESKTOP_PACKAGING_RECORD` 输出 `.desktop-build/packaging-runs/` 下的唯一目录。每次运行保留 `run.json`、带时间戳的 `events.jsonl`、脱敏后的 `stdout.log` 和 `stderr.log`，以及 `result.json`。签名失败还会写入 `fatal.json` 并通过 stderr 通知父进程；监督程序立即请求终止当前阶段的进程树并等待退出。失败阶段不能启动后续阶段或生成发布完成记录。日志写入失败也会停止运行。终止错误仍按失败处理，需要操作者检查；缺少最终记录表示尚未确认完成。

硬件签名必须属于受监督的打包运行。调用命令解释器前，签名器原子获取 `%USERPROFILE%/.dsh-desktop-signing/attempt.json` 并记录本次尝试。只有签名成功才释放该文件。失败、中断、已有锁定文件或审计存储不可用都会阻止再次访问硬件，包括同一 Windows 账户下的另一个签名器实例、进程或代码检出目录。没有定时恢复或自动重试。管理员必须检查保留的证据及令牌状态，再明确授权恢复锁定状态；登录令牌或替换 PIN 文件不会清除它。记录区分签名意图、命令解释器 PID 和完成结果，不计量 CSP／令牌内部的认证次数。不记录命令参数、PIN 或凭据环境。其他 Windows 账户及无关签名程序不在此锁定机制的保护范围内。

Windows 打包将 7-Zip 过滤器固定为 `BCJ`，以兼容内置的 NSIS 解码器。这样可以保留 x64 安装包中由依赖携带的 ARM64 二进制文件；自动 ARM64 过滤会生成该解码器无法解压的条目。

NSIS 在安装阶段清理临时解压目录，完成后才显示完成页或自动启动应用。已安装的生产依赖保持为普通文件；启动时不会再次解压。安装仍会写入完整的应用目录树。

在 `.env.windows` 中填写 `DSH_DESKTOP_WINDOWS_CER_FILE`（公开 EV 叶证书）、`DSH_DESKTOP_WINDOWS_SIGNTOOL`（SafeNet 兼容的 SignTool）、`DSH_DESKTOP_WINDOWS_KEY_CONTAINER`（匹配的私钥容器）和 `DSH_DESKTOP_WINDOWS_TOKEN_PIN`（Token Password）。私钥仍保留在 USB Token；不要把证书或本地凭据文件提交到 Git。

```sh
pnpm run package:desktop:win:x64
```

打包前插入并解锁 Token。electron-builder 钩子把每个产物交给采用 CRLF 的 `scripts/windows-sign.cmd`；该 CMD 只调用一次已配置的 SignTool，并指定 `/f`、SafeNet `/kc "[{{PIN}}]=容器"`、`/csp "eToken Base Cryptographic Provider"`、SHA-256 文件摘要和 DigiCert SHA-256 RFC 3161 时间戳。钩子不会改用 electron-builder 内置的 SignTool，也不会重试失败的签名请求。SignTool、证书、容器、PIN、Token 或签名不可用时，Windows 发布打包会失败，不会生成未签名产物。

PIN 不能包含 `]`、引号或换行，因为这些字符用于分隔 SafeNet `/kc` 值或对应的 CMD 参数。CMD 会禁用延迟展开，因此包含 `!` 的 PIN 可以原样到达 SafeNet。打包流程不会把任何 `DSH_DESKTOP_WINDOWS_*` 字段传给构建与 运行时准备子进程；它只向签名预检、独立的第一方运行时签名阶段与 electron-builder 提供四个配置输入，在其他字段已经清理的环境中只向签名 CMD 提供经过校验的签名字段，在 SignTool 启动前清除这些字段，并遮盖 SignTool 诊断。SafeNet 仍要求 PIN 出现在 SignTool 进程命令行中。本地 `.env.windows` 明文保存 PIN，应限制文件访问权限；CI 使用临时文件并在任务结束后删除。不要提交或分享文件内容，也不要把凭据写入日志。配置检查不会消耗 Token 的 PIN 尝试次数；签名仍在首次失败后停止整批任务。

使用对应的 `:dir` 命令可以生成可直接运行的应用目录，而不是安装包，例如：

```sh
pnpm run package:desktop:dir
pnpm run package:desktop:mac:arm64:dir
```

需要检查或诊断为宿主目标准备的资源而不调用 electron-builder 时，可以让同一流水线在准备完成后停止：

```sh
pnpm run prepare:desktop
```

这条诊断命令是另一种停止位置，并非两条命令构建流程的前半段。之后执行 `package:desktop*` 时仍会重新完成正式构建与准备，避免使用陈旧的 dsh 包、运行时文件或 dsh 内容。

每条打包命令都会构建仓库，打包以 dsh 和私有 Desktop Host 为根的第一方生产依赖闭包，并准备目标专用的 Electron 分发包与 pnpm CLI。`prepare:dsh` 在构建时安装一次生产依赖图，准备物化包供 electron-builder 归档到 `app.asar/dsh`，移除包管理器元数据，并生成包含共享包版本和最终文件哈希的 `desktop-runtime.json`。在 macOS 上，它先签名并验证原生文件，再生成清单；electron-builder 不对已签名的此目录重复进行嵌套签名。资源映射明确包含默认根目录过滤器会忽略的 `dsh/node_modules`；准备完成的运行时清单在原生签名后检查。原生可执行文件及库解包到 ASAR 旁；Python、独立 Node 和 pnpm 保留在外部 runtime 资源中。签名安装包、公证、已安装应用升级和各目标原生模块的验收需要发布环境。

macOS 打包在组装 App 时、代码签名前写入 `Contents/Resources/app-update.yml`，供并行 ZIP 与 DMG 路线使用的目录构建也执行此操作。签名钩子验证准确的更新源和 updater 缓存目录。写入发布完成记录前，流程会再次检查两条路线的副本和最终移入的 App；配置缺失或不匹配会阻止移入产物，因而也会阻止上传。

未压缩产物包含 Electron、物化后的 dsh 生产依赖树、pnpm，以及壳应用。安装包大小与文件系统占用不同；发布验收需要测量两者，以及 profile 插件存储和首次启动耗时。此布局用更多应用内文件换取消除用户机器上的核心包安装过程。

## 更新

打包应用在启动后异步检查固定 Nightly。常规轮询以十分钟为基础间隔，每次独立采样 ±20% 的随机抖动。每次检查失败将基础延迟翻倍，上限为一小时；成功后重置。随机延迟不超过该上限，并从全部复用调用结算后开始计时。本地化的“检查更新…”菜单项（Windows 可从顶栏的“应用”菜单进入）立即执行，并复用正在进行的检查。回到前台和系统恢复时遵守相同的单调时钟截止时间。新收到的强更策略也会立即请求检查更新清单。自动检查从不弹窗或下载安装包。手动检查显示正在检查、失败或包含已安装版本号的无更新反馈。

`DSH_DESKTOP_UPDATE_CHECK_INTERVAL_MS` 配置常规基础间隔，`DSH_DESKTOP_UPDATE_CHECK_MAX_BACKOFF_MS` 配置上限；两者均接受 1000 至 2147483647 的整数毫秒数，且上限不能小于间隔。省略上限时取一小时与间隔中的较大值。`DSH_DESKTOP_UPDATE_CHECK_JITTER` 配置 0 至 1 的抖动比例，默认 `0.2`；最终延迟至少一秒，且不超过上限。这些配置不改变强更策略轮询，也不授权下载重试。

左下角账户行显示本地化的更新可用状态、加载图标与下载百分比、验证、就绪状态，或带可访问提示的持久红色重试操作。嵌入 Web 界面的文案跟随应用内当前语言；原生弹窗使用 Desktop 壳语言。侧栏收起时，顶部展开按钮显示圆点。连接状态优先展示。选择可用版本即开始下载。准备成功后自动打开壳拥有的重启确认；关闭后保留就绪状态，不重复弹窗。选择就绪入口可再次打开确认。运行中的 agent、排队输入，以及运行中或停止中的后台任务都会在该确认中触发中断警告。仅有 API 请求不会触发警告。用户批准后，Host 锁定新请求，等待已接收的请求结束，再检查任务，包括已接收写操作创建的工作。等待超过控制请求截止时间时，拒绝安装并解除准入锁。任务状态未知、未获中断授权的新任务，或未成功完成正常收尾，都会阻止安装。常规退出会在停止 Host 前隐藏产品窗口，在收尾期间忽略新的聚焦请求，且从不安装更新。下次启动通过已有的启动与恢复流程校准版本绑定的运行时。

若任务收尾失败但已确认 Host 退出，安装会被拒绝，壳会在允许再次确认重启前恢复当前版本的 Host。Host 正常停止后的安装器启动失败使用同一恢复路径。替代 Host 启动并完成认证后，壳重新加载原有应用地址，让 Web 页面获取当前端口、Cookie 和启动注入数据；页面加载失败时打开原生致命故障恢复弹窗。未确认进程退出时，绝不允许启动替代 Host。已下载目标保留以供重试。已知强更策略在恢复过程中继续阻塞；Host 恢复失败打开原生致命故障恢复弹窗。

已确认 Host 退出但任务未成功收尾时，常规与强更弹窗均展示本地化恢复提示。两种语言都根据类型化的准备失败原因选择提示，翻译文案变化不会改变失败分类。“查看技术详情”默认折叠，仅展示退出状态、信号、关闭确认和截止时间事实，不展示插件 stderr。展开详情既不重试，也不授权安装。

### 强制更新策略

[强更客户端决策](../../.agents/notes/implemented/feature/2026-09-11-desktop-mandatory-update-client.zh.md)负责策略查询和阻塞窗口。打包读取 `.env.windows` 或 `.env.macos`：`DSH_DESKTOP_AUTO_UPDATE_ENV=test`（默认值）选择 `DSH_DESKTOP_MANDATORY_UPDATE_TEST_ORIGIN`；`production` 选择 `DSH_DESKTOP_MANDATORY_UPDATE_PROD_ORIGIN`。模板分别使用 `https://harness-test.deepseek.com` 和 `https://harness.deepseek.com`。在准备产物或签名前，所选源站必须配置，包括未签名和仅准备构建；未选环境的源站可不填。这些配置不会回退到父进程环境或另一部署环境。打包将选定策略与应用 ID 写入元数据；打包应用忽略运行时覆盖。

可选的 `DSH_DESKTOP_MANDATORY_UPDATE_CONFIG` JSON 提供轮询和下载页面选项；打包拒绝其中的 `origin` 和 `authentication`。页面白名单默认只包含所选服务源站；需要其他已批准下载页面源站时应显式配置。测试包选择 `feishu-test`，正式包选择 `anonymous`。策略请求拒绝重定向；仅测试鉴权携带网关 Cookie。未打包开发模式则从此变量读取完整策略 JSON，并要求 `DSH_DESKTOP_APP_ID`；缺少 JSON 会禁用开发模式策略查询，仅匿名开发允许 HTTP `127.0.0.1`。用户发起常规检查时会并发触发策略检查，但不会等待或展示策略失败。只有已确认的强更决定可以关闭常规弹窗。测试环境鉴权会等待当前常规弹窗结束，取消或失败不会丢弃 updater 结果。

| 解析后的策略字段 | 含义与默认值 |
|---|---|
| `origin` | 必填 HTTPS API 源站，不含凭据、路径、查询或片段；请求使用 `/api/v0/check_client_update` |
| `allowedPageOrigins` | 非空的精确 HTTPS 源站数组；打包时默认只包含所选 API 源站；不隐含子域名或其他端口 |
| `authentication` | 打包时测试环境选择 `feishu-test`，正式环境选择 `anonymous`；未打包开发模式默认为 `anonymous` |
| `intervalMs` | 轮询间隔；默认 `600000` |
| `timeoutMs` | 请求截止时间；默认 `15000` |
| `maxBackoffMs` | 含抖动的失败请求最大间隔；默认 `3600000`，不小于 `intervalMs` |
| `jitter` | 随机增加的间隔比例；默认 `0.2`，范围为 `0` 至 `1` |

时长必须是 1000 至 2147483647 毫秒的整数。启动与定时轮询独立于业务请求；前台／恢复检查遵守下次到期时间，手动检查绕过该时间并复用在途请求。客户端发送已安装平台、架构、完整壳与内置 dsh 版本、应用 ID、语言和固定 Nightly。不使用业务登录凭据或安装 ID。

启用 `feishu-test` 时，包含 `error.code: "UNAUTHENTICATED"` 的 HTTP 401 JSON 响应会在用户主动检查和打包应用首次启动检查时提供登录入口，不等待本地后端就绪。本地化说明指出这是测试版、需要飞书鉴权，且登录不会下载或安装更新。确认后先关闭说明，再打开配置源站根路径的沙箱窗口，不使用响应中的登录 URL。并发检查复用整个确认／登录流程，并聚焦已有窗口。在测试环境登录窗口按 F12 可打开独立的 DevTools 进行排查。取消后，定时或前台检查不会反复弹窗；用户可手动重试。

登录和策略请求共用内存 Session，与产品窗口及 updater 隔离；应用重启后需要重新登录。关闭窗口取消登录，导航失败提供本地化重试提示。返回服务后重新查询策略；重定向、Cookie 或 HTTP 422 都不是有效策略决定。取消、登录过期及无效响应均保留已知强更阻塞。固定登录结果写入进程诊断及可选更新日志；登录控制器不记录 Cookie、OAuth 参数或远程错误原文。真实 Harness 网关/API 联调及 macOS 登录验收仍未完成。

扁平化的 `40005` 打开壳拥有的模态窗口，并拒绝后续插件修改，不停止现有 Host 任务。服务端标题与详情是可选纯文本，缺失时使用客户端兜底文案；缺少下载地址或地址未获批准时隐藏外部页面操作，不解除阻塞。Windows 强更窗口使用原生标题栏，可拖动、调整大小和最大化。关闭窗口会在完成清理后退出应用，不会解除更新要求；Esc 不会关闭窗口。批准安装后，安装器接管的退出流程会在 Electron 关闭窗口前释放模态窗口。下载、含准备步骤的文件校验、任务检查和安装确认共用同一弹窗。只有第二次用户批准才允许任务收尾和安装；稍后更新保留阻塞与安装包。仅存在受影响任务时，重启文案才提示正在停止任务。策略不跨应用重启持久化，策略响应也不作废或替换 updater 产物。

失败时在同一弹窗内保留阻塞、本地化重试提示和折叠诊断。白名单下载页面操作只在恢复状态出现，不与正常下载或安装并列。请求打开浏览器后立即提供复制替代入口，即使系统请求尚未返回；请求成功不证明网页已打开。复制失败时展示完整、只读的地址供手动复制。浏览器与剪贴板结果不覆盖 updater 错误。只有新的有效无需强更响应才解除阻塞；阻塞期间仍可使用顶部菜单检查。

后台强更安装确认请求 Windows 任务栏提醒或 macOS 信息级 Dock 弹跳，并在每轮就绪时尝试一次无声通知，不还原窗口或抢焦点。点击通知只返回当前确认界面。回到前台、安装、策略解除和退出时清理提醒。系统权限和专注模式可能抑制通知；仍需完成 Windows 与 macOS 安装包通知验收。

### 本地 updater 验证

常规更新 HTTP 请求具有逐连接的无活动截止时间：`60000` 毫秒内未收到响应头或后续响应字节会使操作失败。`DSH_DESKTOP_UPDATE_HTTP_IDLE_TIMEOUT_MS` 接受 `1000` 至 `2147483647` 的整数进行调整；活跃下载没有总时长限制。下载失败保留重试提示，并要求用户再次操作。

在已安装工作区依赖的 Windows 上，从仓库根目录运行：

```sh
node apps/desktop/node_modules/pnpm/bin/pnpm.mjs --dir apps/desktop run test:updates:local
```

此命令构建 Desktop 壳，让其协调器通过真实 Electron HTTP 请求和 `NsisUpdater` 访问私有回环服务器。它验证用户授权的完整下载、SHA-512 拒绝、显式重试、并发请求合并、清单替换和安装交接。它还打开使用沙箱预加载的真实强更页面，检查按钮操作、关闭／Esc 拦截、纯文本内容、策略请求停滞和策略解除。成功时打印 `LOCAL_UPDATER_RESULT` 并以零退出码结束；功能失败时返回非零退出码。每次调用独占随机端口和临时用户数据／缓存目录，关闭监听器、等待 Electron 退出，并移除临时文件。报告和可用截图保存在唯一的 `.desktop-build/qualification/local-updater-*` 目录中。截图失败单独记录，绝不当作视觉验收通过。不需要 COS 或签名凭据。

下载内容是不可执行的测试字节，安装调用仅记录而不执行。测试替换浏览器打开与剪贴板写入，避免外部导航和剪贴板修改。它不启动完整产品工作区，不验证真实安装器或重启，不验证发布者签名，也不覆盖差分更新或 macOS。停滞的策略请求、清单请求和负载传输会执行真实截止时间及恢复。真实常规弹窗验证隔离预加载、卡片尺寸、背景模糊、取消、任务警告选项与显式安装批准；账户行组件测试另行提供证据。[本地验证决策](../../.agents/notes/implemented/testing/2026-09-10-desktop-local-updater-qualification.zh.md)和[验证记录](tests/README.zh.md)保留这些限制；生产发布要求保持不变。

## 底层开发覆盖项

未打包的 Electron 进程使用应用目录下的 `.desktop-build/development/project` 作为开发项目。`DSH_DESKTOP_PNPM_ENTRY` 和 `DSH_DESKTOP_DSH_DIR` 用于选择明确的运行时资源。打包应用会忽略这些变量，从 `process.resourcesPath` 解析签名资源，并使用受管 Desktop profile。

## 已知限制

- 发布签名、公证、更新托管和跨上一版本的已安装产物验证需要生产发布环境。
- 依赖的生命周期脚本遵循 pnpm 的构建权限；Desktop 不提供单独的审批对话框。
- 桌面壳与 CLI dsh 共享 `$DSH_HOME` 下的会话、设置、凭据、工作区和存储，但可执行包、插件激活和锁文件彼此隔离。

## 开发备注

上线前 CDN 与容量决策见[桌面更新提案](../../.agents/notes/proposed/feature/2026-09-08-desktop-update-policy-and-installation.zh.md#cdn-and-capacity-qualification)。
