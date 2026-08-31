# Deepseek-Harness-Desktop 生产交付实机验收用例

面向 **GitHub Actions 打出的 Windows x64 安装包** 的必过验收。macOS arm64 有机则测，不阻塞本轮 Windows 门禁。

**每次对外发布前必须对本表走完一遍。** 测的 Setup 必须与即将上传到 GitHub Release 的文件 **同一 SHA256**。源码 `qa:*`、本机 `npm run dist`、`qa:packaged` **都不能**给本表打 Pass，也不能代替走表。

---

## 0. 验收约定

### 0.1 产物：必须是 CI windows job

合法对象只有 [`.github/workflows/release.yml`](../../.github/workflows/release.yml) **windows** job 上传的 artifact `DeepSeek-Harness-windows-x64` 里的 `Deepseek-Harness-Desktop-Setup-*.exe`（及 `.blockmap`）。

该 job 步骤为：`actions/checkout` → `actions/setup-node` **`node-version: 22`** → `npm ci` → `node node_modules/electron/install.js` → `node scripts/setup-harness.js` → `npm run dist`。`afterPack` 把当时的 `process.execPath` 打进安装目录 `resources/node.exe`，所以本机 Node 24 打的包与 CI **不是同一份**。

| 项 | 要求 |
| --- | --- |
| 下载 | 从该 Actions run 下载 artifact，记录 **run URL**、文件名、SHA256 |
| 安装 | 用**该文件**默认路径安装或 `/S`；启动用开始菜单/桌面快捷方式 |
| 家目录 | `%APPDATA%\Deepseek-Harness-Desktop\dsh-home`。不读官方 `~/.dsh`。见 [handbook/modules/dsh-home.md](../handbook/modules/dsh-home.md) |
| 发布同一性 | GitHub Release / 对外分发的 exe SHA256 **必须等于**本表已测文件。测完禁止再 `npm run dist` 或再跑 workflow **换包**后再上传 |
| 禁装 | 已撤回的 v0.2.0；已知坏包 0.2.4 / 0.2.5 |
| 版本钉 | Release 说明里的 harness 基线必须等于 **该 SHA 包内** pin（与 `vendor/harness-upstream.json` 在打该包时的内容一致）。禁止用源码树超前钉给包打 Pass，禁止再写已过期的 `0.1.0-rc.7` |
| 系统 | Windows 10/11 x64；测前退出已运行的同名应用（勿杀 Cursor） |
| 工作区 | 启动目录可以是 Documents 默认仓；**Git/终端/附录**必须再打开 `workspace.json` 已登记、且不是启动目录子路径的仓库（见 TC-WS-006） |
| 网络 | 可访问模型网关与壁纸源（Bing / Wallhaven） |
| 账号 | 无需产品登录；模型密钥见 §0.4 |

**现 workflow 缺口（本表点名，不在本文件改 YAML）：** 打 `v*` tag 且 windows 成功后，`release` job **立刻** `gh release create`，来不及先走本表。合规顺序：`workflow_dispatch`（或其它「先出 artifact、不自动发 Release」的路径）→ 下载测完 → 用**同一批文件**发 Release。先 tag 再测已经公开的包，**不算发布前验收**。

### 0.2 非法证据（出现则该格不得 Pass，整份报告不得勾可交付）

- `electron .` / `npm start` / 源码 `qa:source` / `qa:composer` / `qa:shell` / `qa:appendix`
- 本机 `npm run dist`、`dist/` 下 Setup、`dist/win-unpacked`、`smoke:packaged`、`qa:packaged`（允许当 rehearsal，**禁止**写入本表 Pass）
- `--user-data-dir` 冒烟目录顶替真实 `%APPDATA%\Deepseek-Harness-Desktop`
- 只测 `config.json` 启动工作区，不打开 harness `storages/workspace.json` 里登记的兄弟目录
- 源码 Electron 双开顶替「已装快捷方式第二次启动」

**冲突条款：** 源码套件全绿而本表任一条 P0 Fail ⇒ **源码套件有漏洞**，同时本表 Fail，禁止解释成「源码没问题、只是安装包坑」。本机 dist 绿而 CI 包红 ⇒ 本机包无效，不得把本机包当 Release。

### 0.3 缺陷分级与发版硬门禁

| 级 | 定义 | 门禁 |
| --- | --- | --- |
| **Blocker** | 无法安装、无法进入主界面、Harness 持续崩溃、附录多轮对话失败、数据明显损坏 | **禁止发版** |
| **Critical** | 主路径不可用（Git 提交失败、Files/终端送对话失败、图库/本地壁纸无法设置、市场/插件拖垮启动、托盘/退出失控） | **禁止发版** |
| **Major** | 次要路径坏、可绕过、文案严重误导 | 发版需书面豁免 |
| **Minor** | 视觉/动效/文案瑕疵 | 可进发版备注 |

**每次发布前**（GitHub Release 或分发该 SHA 的 Setup）：对 **该 CI SHA** 走完本表，写下 `docs/qa/results/<日期>/` 执行报告，填 §16 且勾「Release 将上传同一 SHA」。没有这份绑定 CI SHA 的报告，**禁止发版**。

**「可交付」= 全部 P0 = Pass（或合法 Blocked+书面豁免），且 §16 绑定 CI artifact SHA。** dshbot 已拆为独立插件：TC-EXT-007 降为 **P1**（默认不装：无页签 + 启动不阻断）。当前没有远程书面豁免条。P1 失败记入发布说明或豁免单。P2 记入后续迭代。

**造障类 P0**（插件弄挂、杀子进程、强制升级包）：能造则测；本轮无法安全造障时标 **Blocked**，附原因，由产品负责人决定是否豁免，**不得静默标 Pass**。

每条步骤默认在 **已安装的 CI 包**、真实 `%APPDATA%` 家目录里做。附录 A 必须在该安装包会话里跑，不得用冒烟 `userData`。

### 0.4 本轮模型网关（多轮对话必测）

在 **设置 → 模型 → 添加自定义提供方** 配置：

| 字段 | 值 |
| --- | --- |
| Provider ID | `ayase`（小写，永久；勿随意改） |
| 显示名称 | `Ayase` |
| API 地址 | `https://ayase.cn/v1` |
| API 协议 | OpenAI Completions（`openai-completions`） |
| 模型 | `grok-4.6`（至少一条） |
| API 密钥 | **仅本机 / 安全通道**；禁止写入仓库、截图、Issue、PR、提交说明 |

密钥保存后只显示脱敏描述符。若网关拒绝 `developer` role 或 `max_completion_tokens`，按官方「配置模型」指南在桌面 `$DSH_HOME/settings.yaml`（应用数据目录下的 `dsh-home/settings.yaml`，不是官方 `~/.dsh`）对该路由补 `compat` 后重测。

**多轮对话 P0 门禁（唯一标准）：** 同一会话内 **附录 A 五轮脚本全部成功**（含记忆、读文件工具、终端/命令工具、综合汇总）。消耗不设上限。不得用「随便聊两句」代替附录。

### 0.5 用例记录格式

```text
用例 ID:
结果: Pass | Fail | Blocked | N/A
实际结果:
证据: 截图路径 / 日志路径 / **CI Actions run URL** / 安装包文件名与 SHA256 / About 版本
缺陷编号:（Fail 时必填）
豁免单号:（Blocked 且申请发版时必填）
执行人 / 日期:
```

Pass 的证据种类只能是 `CI artifact SHA + 已装 exe`。

### 0.6 建议执行顺序（Windows，约 2～2.5 人日）

0. 从 Actions 下载 windows artifact，记录 SHA256；退出已装 `Deepseek-Harness-Desktop.exe`；用该文件安装。`qa:packaged` 仅 rehearsal，**不是**本步的放行条件。  
1. §1 安装/升级/卸载抽检（含 TC-INST-012 同版本 overlay、TC-INST-013 bundled node）→ §2 模型 → §3 工作区（含 TC-WS-006）  
2. §4 附录多轮对话（最长，优先；在 TC-WS-006 仓库会话里）  
3. §5～§8 会话 / 审批 / Git / Surfaces / 终端  
4. §9 外观与壁纸 → §10 扩展与 dshbot → §11 托盘/关闭/更新  
5. §12 负向与持久化 → §13 已知不测核对 → §16 签字  

---

## 1. 安装、升级与启动

### TC-INST-001 · 安装包校验、安装并可启动 · P0

**前置：** 干净机或已卸载旧版。对象是 Actions windows artifact，不是本机 `dist\`。

**步骤：**

1. 打开该次 `release.yml` windows job 的 Actions run，下载 artifact `DeepSeek-Harness-windows-x64`。  
2. 记录 run URL、文件名、SHA256。此文件即拟发布文件。  
3. 用**该文件**默认路径安装；确认桌面与开始菜单快捷方式。  
4. 从快捷方式启动；观察启动页仪器画布（品牌名、状态章、日志）。  

**期望：** 安装无报错；启动页出现并进入官方 Web UI（或明确失败态，非白屏/闪退）。禁止用本机 `dist\` Setup 或源码冷启动过本条。

### TC-INST-002 · 单实例锁 · P0

**步骤：** 已安装应用已运行时，再点**开始菜单或桌面快捷方式**（禁止用第二份源码 `electron.exe` 顶替）。

**期望：** 不出现第二套完整主窗抢资源；焦点回到已有实例。

### TC-INST-003 · 冷启动：插件加载留在启动页 · P0

**步骤：** 冷启动**已安装**应用，观察运行时就绪后至 Web UI 露出前的状态行。禁止源码 `electron .` 顶替。

**期望：** 状态可见「正在加载插件 n/m」（或等价文案）；**不**闪到官方独立「正在加载插件」页；随后进入主界面。

### TC-INST-004 · 启动失败：重试与导出日志 · P0（造障）

**前置：** 自然失败或安全造障（坏插件 / 杀 dsh）；测完恢复。

**步骤：** 进入异常态 → 重试 → 保存/下载启动日志。

**期望：** 重试可再拉起；日志落在应用管理路径，含近期错误；非渲染进程任意路径写入。

### TC-INST-005 · 用户插件弄挂：跳过插件树 · P0（造障）

**步骤：** 启动页选择跳过用户插件 / 官方组合恢复，进入主界面。

**期望：** 可用 UI；文案表明已暂时跳过（或等价）。

### TC-INST-006 · 跳过之后：重试完整插件 · P0（造障，接 005）

**步骤：** 在主界面触发「重试完整插件」/恢复用户插件树（设置或产品入口）。

**期望：** 能再次尝试完整树；成功则插件回来，失败则仍可留在可用态并有提示。

### TC-INST-007 · 自动重启倒计时与取消 · P1（造障）

**前置：** 设置中 Harness 自动重启为开。

**步骤：** 触发可恢复失败，观察倒计时；点取消。

**期望：** 倒计时与状态文案正确；取消后不再自动拉起（直到手动重试）。

### TC-INST-008 · 版本与 Release 备注一致 · P0

**步骤：** About / 设置核对版本；对照**即将上传的** Release 草稿或说明（含禁装警告）；对照该 SHA 包内 harness 基线。

**期望：** 应用版本 = 安装包/拟用 tag；Release 禁装说明被遵守；正文 harness 基线等于 **该 CI 包** 内 pin，不得用源码树超前钉，不得写 `0.1.0-rc.7`（当前包内 pin 为 `0.1.1-rc.1` 时必须如此宣传）。

### TC-INST-009 · 覆盖升级（旧版 → 本包）· P0

**前置：** 先装上一稳定版（勿用 0.2.4/0.2.5/撤回包），保留用户配置与一会话。新包必须是本轮 CI artifact。

**步骤：** 运行该 CI Setup `/S` 覆盖安装（含**同一桌面版本** overlay）→ 从快捷方式启动 → 打开原工作区与会话。原工作区走 TC-WS-006，不得只测启动 Documents 文件夹。

**期望：** 升级无半残；能进主界面；壳层已存默认 API key 与工作区路径仍可用。会话、主题、自定义模型、MCP、技能在 `userData/dsh-home`，与升级前写在 `~/.dsh` 的数据分开，**须在桌面里重配**（明确提示或不崩即可）；市场不因依赖残缺导致一打开即 `dsh 进程结束`。

### TC-INST-010 · 卸载 · P1

**步骤：** 系统「应用和功能」卸载 → 确认快捷方式移除 → 可选查安装目录。

**期望：** 卸载完成；快捷方式消失；无托盘幽灵进程（允许短延迟）。用户数据目录是否保留按产品实际记录，不当作失败除非产品承诺清除。

### TC-INST-011 · 官方 `~/.dsh` 插件不能拖死桌面新装 · P0（造障）

**前置：** 本机已有官方 `~/.dsh/profiles/web`（或手动建一份），在其 `package.json` 的 `dsh.profile.bundles` 写入一个无法解析的第三方包名。

**步骤：**

1. 安装或冷启动本包桌面应用。  
2. 观察启动页能否进入官方 Web UI。  
3. 确认肇事 `~/.dsh` 文件仍在、桌面未改写它。  
4. 底栏终端运行官方 `dsh`（若已安装）：仍使用 `~/.dsh`，进程环境没有被桌面改成 `userData/dsh-home`。

**期望：** 桌面进主界面（或走 skip-user-plugins 后仍可用）；失败不得归因于官方 home 里那条坏 bundle。Boot 日志出现桌面 `Harness 家目录` 且路径在应用数据目录下的 `dsh-home`。冷启动应先见启动器；若桌面起不来，启动器须留下并可在插件问诊里禁用肇事包后再试。官方 `~/.dsh` 字节不变。

### TC-INST-011b · 官方 credentials.yaml 毒化不能拖死桌面 · P0（造障）

**前置：** 官方 `~/.dsh/.credentials.yaml` 写入非 string 的 `refs` 值（issue #19 形态）。桌面包为 v0.2.7+。

**步骤：**

1. 冷启动桌面应用。
2. 读 Boot 日志里的 `Harness 家目录` 与 `子进程 DSH_HOME`。
3. 确认官方 `~/.dsh/.credentials.yaml` 字节未改。
4. 底栏终端运行官方 `dsh`（若已安装）：仍使用 `~/.dsh`。

**期望：** 进入 Web UI。两行 home 都在 `%APPDATA%\Deepseek-Harness-Desktop\dsh-home`（或测试 `DSHD_HOME`）。stderr / 子进程输出不得含 `\.dsh\.credentials.yaml`。官方文件未改写。

### TC-LAUNCH-001 · 冷启动只开启动器 · P0

**步骤：** 完全退出后冷启动安装包。

**期望：** 先出现启动器窗，不见立刻 `dsh web` 主界面。无新正式版时（或点「稍后」）再进桌面。草稿 Release 不得当成现网更新。

### TC-LAUNCH-002 · 无更新则自动进桌面 · P0

**前置：** 当前已是 GitHub `/releases/latest` 正式版；桌面 `dsh-home/sessions` 非空或官方 `~/.dsh` 无可导入数据。

**步骤：** 冷启动。

**期望：** 启动器检查更新后不拦，自动启动桌面端。成功就绪且「启动后退出启动器」为开则关启动器窗。

### TC-LAUNCH-003 · 有更新点否仍能进桌面 · P0

**前置：** GitHub latest 正式版高于当前安装包。

**步骤：** 冷启动 → 询问更新 → 选否。

**期望：** 不安装，继续启动桌面端（除非被空家目录导入拦住）。

### TC-LAUNCH-004 · 空家目录停在导入 · P0

**前置：** 桌面 `dsh-home/sessions` 为空；官方 `~/.dsh` 有可导入会话、附件、技能、可重装插件或 MCP（或 `~/.agents/skills` 有技能包）。

**步骤：** 冷启动。在导入页勾选部分会话/技能/插件/MCP（可再加技能目录）后导入。

**期望：** 停在启动器「导入」，不自动启桌面。只拷勾选项到桌面 `dsh-home`。官方 `~/.dsh` 与 `~/.agents` 字节不变。未勾选项不出现在桌面 home。UI 不展示 MCP token。空选导入不写盘。

### TC-LAUNCH-005 · 启动失败留下启动器并可禁用插件 · P0（造障）

**前置：** 桌面 profile 有一个无法解析的用户插件。

**步骤：** 冷启动让桌面失败。

**期望：** 启动器不关，切到插件排查；可禁用该包后重新启动桌面端。通用崩溃（OOM / 端口占用 / 缺 Node）不得谎称是某个插件。

### TC-LAUNCH-006 · 托盘与文件菜单可再打开启动器 · P0

**步骤：** 桌面已就绪后关启动器。托盘与文件菜单点「打开启动器」。

**期望：** 启动器再 `show()`。桌面在跑时关启动器 ≠ 退出应用。

### TC-LAUNCH-007 · 启动器浅色/深色跟官方表，不跟壁纸种子 · P0

**前置：** Appearance 已选一套非默认壁纸家族（浅色与深色半的 `background` 都不是官方 `#FFFFFF` / `#151517`）。

**步骤：**

1. 外观切浅色，冷启动（或托盘「打开启动器」）。
2. 外观切深色，再打开启动器。

**期望：** 启动器画布是官方浅色白底 / 深色 `#151517` 近黑，侧栏与主按钮跟官方 dsh web 设置壳，不是壁纸家族色。桌面主界面仍可跟 Appearance 壁纸。启动器没有仪器画布、没有 `--boot-*`。

### TC-LAUNCH-008 · 更新下载失败留在启动器 · P0（造障）

**前置：** GitHub latest 正式版高于当前安装包；下载通道被掐断（断网 / 防火墙拦 `objects.githubusercontent.com` / 代理指向黑洞）。

**步骤：**

1. 冷启动，等更新询问弹出（此时启动器窗必须已可见，弹框不挂在隐形窗上）。
2. 点「更新」，等下载失败（或等 15 分钟整体超时）。

**期望：** 应用**不退出也不隐身**：启动器留在首页并显示错误提示（含失败原因），`updates/` 目录无半成品安装包。点「启动桌面端」仍能正常进桌面。源码运行点「更新」成功拉起安装器后也回启动器首页提示（应用不自动退出），不留无窗进程。

### TC-INST-012 · 同版本 overlay 必须重解压 Harness · P0

**前置：** 已安装本轮 CI 包，或先装同号旧 harness 包。桌面版本号不变（例如仍为 0.2.6）时 `userData/runtime/<version>` 会复用路径。

**步骤：**

1. 在 `%APPDATA%\Deepseek-Harness-Desktop\runtime\<appVersion>\` 留下无 `.dshd-runtime.json`、或 stamp 与当前 pin 不符的完整外观 extract（或先装仍含旧 `dsh web`、不认识 `--no-open` 的包）。  
2. 用**本轮 CI Setup** `/S` 覆盖同一桌面版本（或冷启动已含 stamp 修复的本轮包）。  
3. 看启动日志与 `runtime/<version>/package.json`。  

**期望：** 无戳或戳不匹配则重新解压；启动日志**不得**出现 `unknown option '--no-open'`；解压树 / About 所述 harness 与该 SHA 包内 pin 一致（现为 `dsh-v0.1.1-rc.1` / npm `0.1.1-rc.1`），不得仍是 `0.1.0-rc.7`。

### TC-INST-013 · 安装包内 Node 与 CI 一致 · P0

**步骤：** 打开安装目录（默认 `%LOCALAPPDATA%\Programs\Deepseek-Harness-Desktop\`）运行 `resources\node.exe -v`。

**期望：** 主版本为 Node **22**（与 `release.yml` `setup-node` `node-version: 22` 一致）。若为 24.x，说明 afterPack 打进了本机 `process.execPath`，该包不是 CI 包，本表整份作废。

---

## 2. 模型与提供方

### TC-MODEL-001 · 添加自定义网关并保存脱敏 · P0

**步骤：** `Ctrl+,` → 模型 → 添加自定义提供方（§0.4）→ 保存 → 重开设置。

**期望：** 保存成功；密钥不回显明文；选择器可见 `grok-4.6`。

### TC-MODEL-002 · 获取可用模型（若入口存在）· P1

**步骤：** 自定义提供方表单中「获取可用模型」，用当前地址与密钥拉取。

**期望：** 成功则列表可选入草稿；失败有可读错误；未点保存前不落盘。

### TC-MODEL-003 · 选中模型作为新会话默认 · P0

**步骤：** 选择器选中 `ayase` / `grok-4.6` → 新建会话。

**期望：** 新会话用该模型。

### TC-MODEL-004 · 第三方思考强度 · P0

**前置：** 若适配器/模型公布推理档位；`grok-4.6` 若无档位则标 N/A 并换一支持档位的模型或记「本网关未暴露 → N/A」。

**步骤：** 在思考/推理强度控件切换至少两档（如低/高），各发一句短问。

**期望：** 控件可见时可切换；请求成功；切换不崩壳。无档位时 **N/A**（须在总表注明原因）。

### TC-MODEL-005 · 识图兜底模型 · P0

**步骤：**

1. 设置中配置「识图模型 / vision fallback」（产品文案以界面为准）。  
2. 主模型保持 `grok-4.6`（或一明确不识图的主模型）。  
3. 在对话附一张简单图片，请描述图中内容。  

**期望：** 走识图兜底或主模型识图之一，得到与图相关的描述；未配置且主模型不支持时，发送前拒绝并点名模型，不崩。

### TC-MODEL-006 · 兼容性兜底（按需）· P1

**前置：** 附录对话因协议字段失败。

**步骤：** 写入必要 `compat` 后重发。

**期望：** 同密钥同地址下成功。

### TC-MODEL-007 · 无可用模型时 Composer 阻拦 · P1

**步骤：** 临时去掉有效模型选择（或空提供方）观察 Composer。

**期望：** 发送被阻拦且有说明；恢复模型后可发。测完恢复 §0.4 配置。

---

## 3. 工作区与主框

### TC-WS-001 · 选择工作区并进入四栏 · P0

**步骤：** 选中本地 Git 仓库，等待连接。

**期望：** 路径生效；会话区 + Composer；标题栏含会话/分支/Git/终端/右栏等入口。

### TC-WS-002 · 快捷键：设置 / 右栏 / 终端 · P0

**步骤：** `Ctrl+,`；`Ctrl+\`；`` Ctrl+` ``。

**期望：** 均切换生效。

### TC-WS-003 · 应用菜单跳转 · P1

**步骤：** 经应用菜单打开工作区、设置、插件市场（如 `Ctrl+Shift+M`）、重启 Harness（若有）。

**期望：** 跳到正确界面；市场进**设置内**分区而非独立 BrowserWindow。

### TC-WS-004 · 窗口控件 · P0

**步骤：** 最小化、最大化/还原、关闭（关闭行为见 §11）。

**期望：** 命中区正常；主题下可见。

### TC-WS-005 · 非 Git 目录 · P1

**步骤：** 切换到无 `.git` 目录。

**期望：** 应用可用；Git 空态或可初始化；不崩溃。

### TC-WS-006 · 打开已登记的兄弟工作区 · P0

**前置：** 启动工作区仍是默认 Documents 目录（例如 `Documents\Deepseek-Harness-Desktop`）。`%APPDATA%\Deepseek-Harness-Desktop\dsh-home\storages\workspace.json` 已登记另一路径，且该路径**不是**启动目录的子路径（例如 `C:\Ai\ChisaTerminal`）。

**步骤：** 在已安装应用里从侧栏/会话打开该登记仓库，进入四栏。

**期望：** 会话 cwd 是该兄弟仓库，不是偷偷连回 Documents。本条不过则 TC-GIT-001 / TC-GIT-003 / TC-TERM-001 / 附录 A 不得标 Pass。

---

## 4. 多轮对话与 Composer（P0 核心）

> 使用 §0.4 网关，在 **已安装 CI 包** 且已打开 TC-WS-006 工作区的会话里执行附录 A；失败从该轮复测或新会话整段重跑。不得用 `qa:appendix` 冒烟目录顶替。

### TC-CHAT-001 · 附录 A 第 1 轮：连通与验证码 · P0

**步骤：** 发送附录 A-1。

**期望：** 实质回复；含连通语义与三位数。

### TC-CHAT-002 · 附录 A 第 2 轮：记忆验证码 · P0

**步骤：** 发送附录 A-2。

**期望：** 数字与第 1 轮一致。

### TC-CHAT-003 · 附录 A 第 3 轮：读 README · P0

**步骤：** 发送附录 A-3。

**期望：** 出现读文件类工具卡；摘要与真实 README 相关；审批可完成。

### TC-CHAT-004 · 附录 A 第 4 轮：终端/命令 · P0

**步骤：** 发送附录 A-4。

**期望：** 终端/shell 工具卡；回复含真实目录信息。

### TC-CHAT-005 · 附录 A 第 5 轮：综合汇总 · P0

**步骤：** 发送附录 A-5。

**期望：** 验证码、产品一句话、目录名与前轮可核对。

### TC-CHAT-006 · Composer 官方命令边界 · P0

**步骤：**

1. `/` 打开官方命令菜单（若提供）。  
2. 输入 `$fo`：不出现桌面本地 skill 菜单。  
3. 输入 `@`：不注册桌面 path source。  

**期望：** 与产品决策一致；控制台无 `sessions without inject` 崩溃。

### TC-CHAT-007 · Files Mention 写入草稿 · P0

**步骤：** Files 对文件 Mention / 加入对话。

**期望：** 草稿为 markdown 链接或约定格式；可发送。

### TC-CHAT-008 · 文件预览「添加到对话」L 范围 · P0

**步骤：**

1. Files 打开文本文件预览。  
2. 切到 **源码**（有「渲染」按钮时不要停在渲染模式）。  
3. 在 textarea **拖选若干行**（无选区时按钮不出现）。  
4. 点预览工具条 **「添加到对话」**（英文 Add to chat）。不要找终端那句「加入对话」，也不要把树行悬停「引用到输入框」当成过条（那是 TC-CHAT-007）。

**期望：** Composer 出现带 `L` 范围的 fence/引用（产品约定格式）；无 sessions-inject 崩溃。

### TC-CHAT-009 · 编辑最近用户消息并重发 · P0

**步骤：** 改最近一条用户消息并重发。

**期望：** 新回复基于改后内容；历史展示符合官方/桌面分叉规则。

### TC-CHAT-010 · 已归档取消归档 · P1

**前置：** 已安装 CI 包（0.2.8 及以后）；在 TC-WS-006 工作区侧栏有一条可识别会话。

**步骤：**

1. 活会话行 ⋯ → **归档会话**。  
2. 确认该行从分组/平铺/搜索消失；侧栏底部出现 **已归档** 分区且含该会话。  
3. 展开 **已归档** 后点该行标题/整行：不得取消归档、不得打开。  
4. ⋯ → **取消归档**（不自动打开）；再从活列表打开续聊。  
5. 确认会话回到原 workspace 分组位置（或 Ungrouped）。

**期望：** 归档只隐藏列表，日志仍在；点行无动作；仅菜单取消归档后行恢复，可正常打开续聊。永久删除日志不在本条范围（C2 / TC-CHAT-013）。

### TC-CHAT-011 · 主模型附件图（无兜底时）· P2

**步骤：** 不配识图兜底时附图片（若主模型声称支持）。

**期望：** 支持则描述；不支持则发送前拒绝。与 TC-MODEL-005 分工：005 测兜底配置路径。

### TC-CHAT-012 · 取消进行中的生成 · P1

**步骤：** 发较长任务 → 停止/取消 → 再发一句。

**期望：** 停止生效；可续聊。

### TC-CHAT-013 · 已归档删除会话 · P1

**前置：** 已安装 CI 包（0.2.8 及以后）；在 TC-WS-006 工作区侧栏有一条可识别会话。若曾关掉「显示已归档列表」，须先在设置 → 界面设置重新打开。

**步骤：**

1. 活会话行 ⋯ → **归档会话**。
2. 展开侧栏 **已归档** → ⋯ → **删除会话**。
3. 在确认对话框确认。
4. 观察确认后瞬间：该行不得出现在工作区/未分组/平铺活列表。
5. 重载应用。

**期望：** 确认后无闪回活列表；重载后该行不在分组/已归档；会话日志目录不在；工作区文件夹仍在。关「显示已归档列表」时侧栏完全无「已归档」（删前须开开关）。

---

## 5. 会话与侧栏

### TC-SESS-001 · 新建 / 切换会话 · P1

**步骤：** 新建会话发一句 → 切回旧会话 → 再切回新会话。

**期望：** 内容独立、不串话。

### TC-SESS-002 · 会话列表浏览 · P1

**步骤：** 侧栏浏览/搜索/滚动。

**期望：** 稳定；选中正确。

### TC-SESS-003 · 重启后会话仍在 · P0

**步骤：** 至少完成附录一轮后完全退出（托盘退出）再启动。

**期望：** 历史仍在；模型配置仍可用。勿用与当前包装不兼容的旧 rc 会话库硬开。

---

## 6. 工具审批

### TC-APPROVE-001 · 批准（Allow once）· P0

**前置：** 会话为**只读**沙箱。`ask_user_question`（对话里「输入你的答案」）**不改** sandbox，答「批准」不算本条。

**步骤：**

1. 发一条会让模型对工作区 **write** 的指令。  
2. 若模型只提问，回答后仍无审批条，再明确要求写入文件。  
3. 等到出现带 `[data-approval-key]` 的审批条（按钮含 **「允许一次」** / Allow once；模型需在拒绝后带 `sandbox_permissions: "workspace-write"` 重试才会出）。  
4. 点「允许一次」。

**期望：** 允许一次后写入继续，结果入对话。默认可写会话里 workspace 内 write **不弹**允许一次，工具卡自行完成符合预设，但不得把 ask-user 当审批。

### TC-APPROVE-002 · 拒绝 · P0

**步骤：** 再触发 → 拒绝。

**期望：** 按官方安全语义中止副作用；可续聊。

### TC-APPROVE-003 · 工具卡可读 · P1

**步骤：** 观察终端类 / 通用工具卡。

**期望：** 参数与输出可读。

---

## 7. Git 标题栏

### TC-GIT-001 · 状态与分支菜单 · P0

**步骤：** 与 TC-WS-006 **同一仓库**。打开分支/Git 菜单。不得只在启动工作区里测一遍就算过。

**期望：** 显示该仓库当前分支与状态；菜单列出真实分支。授权失败不得画成「没有匹配的分支」。

### TC-GIT-002 · 切换或创建分支 · P1

**步骤：** 在 TC-WS-006 仓库切换或创建 `dshd-qa/<date>`。

**期望：** 成功；状态刷新。

### TC-GIT-003 · 暂存与提交 · P0

**步骤：** 在 TC-WS-006 仓库 Stage → 说明 → Commit（勿推受保护主支除非允许）。

**期望：** 成功；空提交等有提示。不得因 `ptyCreate requires a project cwd` 或 Git 未授权而失败。

### TC-GIT-004 · Push / Pull / 开变更请求 · P1

**前置：** 可写测试远程。

**步骤：** Pull → Push → 创建 CR/PR（若有）。

**期望：** 进度与结果明确；无远程时不崩。

### TC-GIT-005 · Diff 与工作区一致 · P1

**步骤：** 右栏 Diff 对照未提交改动。

**期望：** 内容一致。

### TC-GIT-006 · Discard / 取消暂存（若有）· P1

**步骤：** 对测试文件 Unstage 或 Discard（确认文案）。

**期望：** 行为与确认框一致；误触有确认。

### TC-GIT-007 · 非仓库 Init（若有）· P2

**步骤：** 在非 Git 目录触发 Init。

**期望：** 可初始化或明确拒绝；不崩。

---

## 8. Surfaces 与终端

### TC-SURF-001 · Files：搜索、预览、送对话 · P0

**步骤：** 打开 Files。`listDir` 未完成时不得把空树画成「此目录为空。」（应见「正在列出目录…」或保持上一棵树）。列出完成后搜索 `README` → 预览 → Mention/加入对话。

**期望：** 首次打开无空目录闪一下（真·空目录 settled 后才允许该文案）；命中 README；预览可读；Composer 有引用。

### TC-SURF-002 · Files：保存与系统打开 · P1

**步骤：** 编辑一测试文件保存；「在编辑器打开」「在文件夹中显示」「系统默认打开」（有则测）。

**期望：** 保存落盘；系统动作成功或明确失败。

### TC-SURF-003 · Files：未保存关闭确认 · P1

**步骤：** 改文件不存 → 关 tab。

**期望：** 出现丢弃/保留/保存类确认。

### TC-SURF-004 · Browser：URL 与导航 · P0

**步骤：** 打开 `https://example.com`；后退/前进/刷新（有则测）。

**期望：** 加载成功；不拖垮主窗。

### TC-SURF-005 · Browser：截图 / PiP / 录制 · P2

**步骤：** 有则各试一次。

**期望：** 成功有产物；失败有提示。

### TC-SURF-006 · Agents 面板 · P1

**步骤：** 打开 Agents。

**期望：** 空态或列表正常。

### TC-SURF-007 · Tab 关闭在标题右侧 · P0

**步骤：** 多开 surface tab，观察关闭按钮。

**期望：** 关闭在标题**右侧**。

### TC-TERM-001 · 底栏终端可用 · P0

**步骤：** 与 TC-WS-006 **同一仓库** 按 `` Ctrl+` `` → `echo dshd-qa-ok`。不得只在启动工作区测。

**期望：** 抽屉打开；无「无法启动终端」；无 `ptyCreate requires a project cwd`；输出可见。另：打包 runtime 上 `http://127.0.0.1:<port>/plugins/@deepseek-ai/dsh-client-ui-user-terminal/assets/ghostty-vt.wasm` 为 **200**。

### TC-TERM-002 · 选区送对话 · P0

**步骤：**

1. 底栏终端已有输出（TC-TERM-001）。  
2. 在 Ghostty **画布**上拖选 / 双击词 / 三击行。单击抬起会清选区；PowerShell Shift+方向键 **不会**填选区。  
3. 窗格 **右下角** 出现 **「加入对话」** 后点它。不要在 +/分屏工具条或右键菜单里找。

**期望：** Composer 出现 terminal fence；可发送。

### TC-TERM-003 · 多会话 / 分屏 · P1

**步骤：** 新建终端会话；尝试分屏（若有，注意产品上限）。

**期望：** 多会话可用；分屏不崩。

### TC-TERM-004 · 销毁与重建 · P1

**步骤：** 关会话再开。

**期望：** 可再用；无僵尸 PTY 占满。

---

## 9. 外观与壁纸图库

### TC-APP-001 · 浅色 / 深色 · P0

**步骤：** 外观切换浅/深 → 重启验证。

**期望：** 立即跟随且持久。

### TC-APP-002 · Appearance 行能力边界 · P0

**步骤：** 打开外观壁纸相关行。

**期望：** 仅挑选 / 浏览 / 裁切相关 / 毛玻璃 / 像素化；**无**源列表、JSON URL、Bing 开关堆在 Appearance。

### TC-APP-003 · 本地选择壁纸并裁切 · P0

**步骤：** Appearance「选择/挑选」本地图片 → 确认裁切（窗口比例 JPEG）。

**期望：** 壁纸生效；可再调 frost/pixelate。

### TC-APP-004 · 清除壁纸 · P1

**步骤：** 清除/移除壁纸。

**期望：** 恢复无壁纸或默认底；不残留半透明异常。

### TC-APP-005 · Browse 图库窗口 · P0

**步骤：** 点「浏览」。

**期望：** 顶部分类+搜索，下方网格；含 Bing Daily、Wallhaven、收藏。

### TC-APP-006 · 收藏与确认设壁纸 · P0

**步骤：** 收藏 → 点图 → 确认设壁纸 → 是 → 裁切。

**期望：** 生效；取消确认则不更换；收藏分类可找回。

### TC-APP-007 · 图库内源 CRUD · P1

**步骤：** 在图库窗添加/编辑/删除用户 HTTPS JSON 源。

**期望：** 只在图库窗完成；Appearance 不被倾倒配置。

### TC-APP-008 · Wallhaven 仅 SFW · P0

**步骤：** 打开 Wallhaven 分类，浏览若干页。

**期望：** 仅 SFW（产品 `purity=100`）；无 R18 入口或开关。拉目录失败时文案为「超时」或「网络失败」一类，不得把 `TypeError: fetch failed` 原样丢给用户。

### TC-APP-009 · 禁源不出现 · P1

**步骤：** 在 Appearance 与图库源管理中查找 Unsplash / Pexels / Pixabay / Timeline / R18。

**期望：** 均不作为产品源提供。

### TC-APP-010 · 毛玻璃与像素化 · P1

**步骤：** 有壁纸时调节 frost / pixelate。

**期望：** 可见变化；可恢复。

### TC-APP-011 · 主题库 · P1

**步骤：** 打开主题库；新建或复制一主题 → 应用 →（可选）导出/删除。

**期望：** 可切换生效；删除不崩；重启后仍在（若已保存）。

### TC-APP-012 · 透明主题 · P1

**步骤：** 先设背景图 → 外观「玻璃透明度」区块打开「透明主题」→ 检查侧栏 / 输入框 / 菜单 / 对话框 → 关闭开关。

**期望：** 开启后所有 chrome 表面 0% 填充，壁纸压暗 mask 移除（色彩全量透出）；玻璃滑杆置灰；终端 pane 仍是实心底。关闭后立即恢复玻璃滑杆值与压暗层，无残留透明异常。

### TC-APP-013 · 透明主题无壁纸惰性 · P1

**步骤：** 清掉背景图 → 打开「透明主题」→ 调玻璃滑杆。

**期望：** 开关可打开但不生效（惰性），提示「透明主题需要先设置背景图才会生效」；玻璃滑杆保持可用且立即起效；菜单 / 对话框不消失。

### TC-APP-014 · 透明主题可读性 · P1

**步骤：** 设一张高对比繁杂壁纸且毛玻璃调到 0 → 打开「透明主题」→ 检查侧栏与聊天文字 → 再手动把毛玻璃拉回 0。

**期望：** 透明生效瞬间毛玻璃自动提到 20%（一次性，不是持续钳制），文字可读；手动调回 0 后不被顶回，但提示换成低毛玻璃警告文案（建议调高毛玻璃）。关闭透明不回写毛玻璃值。

---

## 10. 扩展、市场与 dshbot

### TC-EXT-001 · 设置分区可达 · P0

**步骤：** 打开 MCP、Skills、插件、市场、用量统计。

**期望：** 各区有主操作；市场为设置内 `market` 分区。

### TC-EXT-002 · 无独立市场窗口 · P0

**步骤：** 经设置、托盘「插件市场」、快捷键打开市场。

**期望：** **不**出现独立市场 BrowserWindow；始终落在设置内。

### TC-EXT-003 · 市场浏览与刷新 · P0

**步骤：** 发现列表；刷新。

**期望：** 列表或明确空/错；刷新不崩；缺依赖时应用仍能启动（对照 0.2.6 修复意图）。

### TC-EXT-004 · 安装市场插件 · P1

**步骤：** 安装允许的小插件；观察进度与重载。

**期望：** 成功则已安装可见；失败不拖死；需 allowBuilds 时提示清晰。

### TC-EXT-005 · 卸载插件 · P1

**步骤：** 卸载刚装插件。

**期望：** 列表移除；应用可用。

### TC-EXT-006 · MCP / Skills 入口 · P1

**步骤：** 各走通到取消或完成。

**期望：** 可进入；取消无坏状态。

### TC-EXT-007 · dshbot 独立插件（默认不装） · P1

**步骤：** 默认安装确认侧栏**没有**「机器人 / Bots」页签，且启动日志无 dshbot 阻断；（可选）设置 → 插件市场第一方 dshbot 行一键安装（或 `dsh plugin --profile web add github:ChisaAlter/dshbot`）后重启，页签出现、可建群；卸载 dshbot 后重启，页签消失、`.agent-presets/dshbot-room` 被清理。

**期望：** dshbot 是独立可发布插件：桌面从不预置、从不因它启动失败；卸载无残留（feature 卡 `dshbot`）。

**2026-08-26 源码实机（不填本表 Pass）：** 云端 Linux X11 GUI 对源码 Electron 完整轮换 A/B(自动)/C 三相：未装分支 walk 全绿 → `dsh plugin add github:…#path:/vendor/dshbot`（钉到 `7972a34`）后探针翻转（Bots 页签出现、已安装列出、`dshbot-room` preset 自装）→ remove + 重启回未装分支且三处残留全净。9 个 dshbot 套件 95/95、全仓 1099/0。B 相手工建群因无 `DEEPSEEK_API_KEY` BLOCKED；Windows 安装包三相维持 BLOCKED。报告：[results/2026-08-26/tc-ext-007-dshbot.md](results/2026-08-26/tc-ext-007-dshbot.md)。

### TC-EXT-008 · 设置内用量统计 · P0

**步骤：**

1. 设置 → 「用量统计」（`usage-stats`）。
2. 看空态或已有 KPI；不要求本机已有会话 token。

**期望：** 分区存在；空态文案可见即通过（含仅空白会话）。扫描失败仍出仪表盘。启动不因预置失败而挡 `dsh web`。有用量时 KPI 整数（不到 10 万）为 P1 手测。

**2026-08-23 源码实机（不填本表 Pass）：** 隔离 `dsh web` 60821 空态「暂无统计数据」/ English「No statistics yet」；60822 有用量 KPI 输入整数、浅/深热力图空格可见且蓝阶。`boot: mode=projection`，`session_projcache` 含 `usagePanel`。截图 `docs/qa/results/2026-08-23/usage-stats-empty-zh.png`、`usage-stats-zh-light.png`、`usage-stats-zh-dark.png`。未动已装实例 `:3080`。


### TC-EXT-009 · 设置内远程双标签 · P1

**步骤：**

1. 设置 → 「远程」（`remote`）→ **网关**：可见中继 URL·令牌（在上）、连接方式（局域网／服务器中继，横排分段）、端口、绑定、TLS、轮换 pairing token；未配中继凭据时「服务器中继」禁用；渠道页无 DSH-IM／GitHub 商店头。
2. 切到 **消息渠道**：可见 dsh-im 渠道 UI（QQ／飞书／微信等）；设置侧栏**无**独立「IM机器人」项；无 DSH-IM 大标题／口号／GitHub。
3. 侧栏手机弹窗仅开关、设备与扫码；**无**局域网／中继切换。

**期望：** 双标签存在；连接方式在凭据之下且不进弹窗；配对不进设置。桌面内置 dsh-im 缺依赖时挡启动（不得静默无「消息渠道」）。

---

## 11. 桌面壳：托盘、关闭、更新

### TC-DESK-001 · 关闭进托盘 · P0

**前置：** 设置关闭行为为进托盘（默认若已是则直接测）。

**步骤：** 点窗口关闭。

**期望：** 进程仍在；托盘图标在；Harness 未因关窗被误杀。

### TC-DESK-002 · 托盘菜单完整 · P0

**步骤：** 关窗进托盘。Win11 须先打开托盘溢出（「显示隐藏的图标」）再 **右键** 托盘图标，逐项：**显示窗口**、**打开启动器**、**设置**、**插件市场**、**重启 Harness**、**退出**；单击托盘图标。未展开溢出就放弃 ≠ 产品缺菜单（`tray-menu.js` 已有这些项）。

**期望：**

- 显示/单击：窗口恢复。  
- 打开启动器：再打开启动器窗。  
- 设置：打开设置。  
- 插件市场：进设置市场分区（非独立窗）。  
- 重启 Harness：可恢复到可用 UI。  
- 退出：见 TC-DESK-004。  

**人手 / Blocked：** 溢出里点不到时记 Blocked（测试缺口），写明未点到的项；不要当成缺实现。  

### TC-DESK-003 · 关闭行为：直接退出 · P0

**步骤：** 设置改为「直接退出」（或等价）→ 关窗。

**期望：** 应用退出；本地 Harness 停止；无托盘残留（允许短延迟）。测完改回进托盘（若需要继续测）。

### TC-DESK-004 · 托盘退出 · P0

**前置：** 进托盘模式。Win11 同 TC-DESK-002：先展开托盘溢出再右键。

**步骤：** 托盘「退出」。

**期望：** 进程结束。

**人手 / Blocked：** 未点到托盘退出时记 Blocked；可用 TC-DESK-003 直接退出覆盖退出路径，但不得把 003 改写成 004 Pass。

### TC-DESK-005 · 检查更新 · P1

**步骤：** About 检查更新。

**期望：** 「已是最新 / 有新版本 / 网络失败」之一明确结果。

### TC-DESK-006 · 下载并安装更新 · P1（有新版本时）

**前置：** 检查到可用安装包资源。

**步骤：** 安装更新 → 观察进度 → 按提示完成。

**期望：** 进度可见；能拉起 Setup；升级后版本号前进。无新版本时 **N/A**。无 asset 时打开 Releases 页可接受。

### TC-DESK-007 · 开机启动（若设置项存在）· P2

**步骤：** 打开 `openAtLogin` / 开机启动 → 注销或重启抽检（可改用系统启动项核对）。

**期望：** 与配置一致。界面无入口但配置存在时，记 N/A 并注明。

### TC-DESK-008 · Harness 自动重启设置 · P1

**步骤：** 设置中开关自动重启、改最大次数/延迟（有则改）→ 保存。

**期望：** 持久化；与 TC-INST-007 / TC-NEG-002 行为一致。

### TC-DESK-009 · 关于页打开运行目录 · P1

**步骤：** 设置 → 关于 →「打开运行目录」。

**期望：** 系统文件管理器打开桌面 `userData/dsh-home`（Windows：`%APPDATA%\Deepseek-Harness-Desktop\dsh-home`）。不得打开 `userData` 根、安装目录、当前工作区或官方 `~/.dsh`。

---

## 12. 负向、远程与韧性

### TC-NEG-001 · 远程默认关闭且不监听 · P0

**步骤：** 全新配置（不要打开侧栏远程）；用资源监视器/netstat 确认 3180。

**期望：** 侧栏有手机 **远程** 入口；快照 `available`；`enabled` 为关；**不**开 HTTP 监听。磁盘若已 `remoteEnabled: true` 则走 TC-REM-001，不走本条。

### TC-REM-001 · 打开局域网远程并出现二维码 · P0

**步骤：** 远程模式为 **局域网** 时：侧栏底部手机图标 → 远程弹窗 → 开。

**期望：** `:3180` 监听；弹窗显示配对二维码（URL 为 `http://<LAN>:3180/#offer=`）。关闭远程后停止监听。

外出 / relay 模式 **不** 走本条（不听 3180）；落地页见 [mobile-remote-live-acceptance.md](mobile-remote-live-acceptance.md) TC-MREM-101。

### TC-REM-002 · 第二客户端实机全量（本轮：手机 Web UI）· P0

**本条细则：** [mobile-remote-live-acceptance.md](mobile-remote-live-acceptance.md)。旧步骤（Cookie 握手、工作区选文件、Files `@path`）已作废，不得再按旧文打 Pass。

**本轮范围：** 只签 **T1 外出 Web**（桌面为局域网时加 T2）。**T3 Android Deferred**，不进本条 Pass。

**步骤：** 按该表 **§S** 与 **§0.10 模块序**（M0→M11）在 T1 走完所有 P0。测出问题立即改、复测该模块后再往下。原子项在场景失败时拆查，不能代替 §S。

**期望：** 布局阈值过、活会话 `D = P`、Ayase `grok-4.6` 五轮、切模型/思考/权限后再聊、审批窗两边弹出并可决、切会话不串台、新工作目录上再跑五轮。不得用「抽屉非空」「发过一句」或 APK 截图过关。

**非法证据：** fake-daemon `run-qa.mjs`、外出模式下 `:3180` rehearsal、bounce 替换 daemon、未部署的公网旧 `app.js`、用 T3 顶 T1。见该表 §0.4。

### TC-REM-003 · 审批允许一次 / 拒绝 · P1

**细则：** [mobile-remote-live-acceptance.md](mobile-remote-live-acceptance.md) TC-MREM-704（P0 在该表；本发版表保留 P1 编号兼容）。

**步骤：** 从手机发一条会触发审批的请求；在输入区接管条点允许一次或拒绝。

**期望：** 审批不另开整页模态；桌面 pending 同步消失。

### TC-NEG-002 · Harness 崩溃恢复 · P0（造障）

**步骤：** 结束 dsh/harness 子进程。

**期望：** 故障页或等价恢复 UI；自动或手动可回主界面。

### TC-NEG-003 · 错误密钥 · P1

**步骤：** 改错密钥发一轮 → 改回。

**期望：** 明确上游/鉴权错误；可恢复。

### TC-NEG-004 · 离线启动 · P2

**步骤：** 断网启动 → 再联网对话。

**期望：** 本地 UI 可用；联网后可对话或明确网络错误。

### TC-NEG-005 · 配置持久化抽检 · P0

**步骤：** 改主题、壁纸、关闭行为、模型默认、工作区 → 托盘退出再启动。

**期望：** 选择仍在。

### TC-NEG-006 · 关闭遮罩 · P1

**步骤：** 直接退出路径观察关闭遮罩（若有）。

**期望：** 遮罩出现且可随 locale；不永久卡住。

---

## 13. 已知不测 / 非本包承诺（核对用）

下列**不是**本表 Pass 条件；出现相关入口若产品已明确「未交付」，记观察即可，**勿当成 P0 失败**：

| 项 | 说明 |
| --- | --- |
| GPU 终端嵌入 | 非承诺 |
| Git worktree 工作循环 | 非承诺 |
| turn-diff / review-comment pick | 非承诺 |
| npx 官方 `@deepseek-ai/dsh` | 无标题栏 Git / surfaces / 终端；本表测安装包路径 |
| Intel Mac / Linux 安装包 | 本轮 Windows 门禁外 |
| 自动化 API 级 preview automation | 非日常用户路径；P2 已覆盖可见截图/PiP/录制即可 |

---

## 14. 自动化对照（全部不能顶替本表）

本表 Pass **只能**来自 CI windows artifact + 已装快捷方式。下表说明现有命令实际测了什么；用它们填本表 = 套件与本表同时失效。

| 命令 | 实际测了什么 | 为何不能顶替本表 |
| --- | --- | --- |
| `qa:source` | 源码 Electron、隔离 `userData`、`initGitWorkspace` 作为**唯一** `config.workspace`；PTY/Git 走 `loadConfig().workspace` | 不是 CI 包；**覆盖不了** 已登记兄弟仓、NSIS overlay、打包 `runtime/<ver>` stamp、安装目录 `node.exe`。2026-08-23 用它给 TC-GIT-001 / 终端 / INST 打 Pass 后，真实安装包在兄弟仓上失败 |
| `qa:composer` / `qa:appendix` / `qa:shell` | 同源码 Electron；附录即使五轮绿 | 不构成 TC-CHAT-* / 托盘 / 恢复的**安装包** Pass |
| `smoke:packaged` | `dist/win-unpacked` + 单 Git 工作区 UI/PTY | 不是 CI artifact；捕不到兄弟仓 Git/PTY |
| `qa:packaged` | 本机 `win-unpacked`：无戳 extract、预写 `workspace.json` 兄弟仓、`gitBranchList`、PTY、Ghostty 200、`--no-open` | rehearsal 可以；**GREEN 也不能**填本表 Pass，更不能把本机包当 CI 包发布 |
| 本机 `npm run dist` | 本机 Node + afterPack `process.execPath` | 与 `release.yml` windows job **不是同一 SHA** |

**源码套件缺陷（修 walker 的待办，不在走本表时改代码）：**

1. 生产表 Pass 不得由上表任何命令写入。  
2. 源码 / packaged smoke 若声称 Git/终端全绿，却只探针启动工作区，视为套件 Fail。  
3. 无 stamp 陈旧 extract 时源码树不测 `--no-open` 覆盖。

**发版：** 下载 CI windows artifact → 对本 SHA 走完本表 → `docs/qa/results/<日期>/` + §16 勾同一 SHA → 再 `gh release` 上传**该文件**。GitHub `release.yml` **不得**跑 `qa:packaged`（那也不是本表）。

---

## 15. 执行记录总表

每条 Pass 的**证据种类**必须是 `CI artifact SHA + 已装 exe`。空着或写成 `qa:source` 等则该格无效。

| ID | 优先级 | 结果 | 证据种类 | 缺陷/豁免 | 执行人 | 日期 |
| --- | --- | --- | --- | --- | --- | --- |
| TC-INST-001 | P0 | Pass | CI SHA + 已装 exe |  | Trent | 2026-08-23 |
| TC-INST-002 | P0 | Pass | CI SHA + 已装 exe | 快捷方式第二次启动未第二套主窗 | Trent | 2026-08-23 |
| TC-INST-003 | P0 | Pass | CI SHA + 已装 exe | 启动页仪器画布；恢复页见 harness-crash.png | Trent | 2026-08-23 |
| TC-INST-004 | P0 造障 | Blocked | CI SHA + 已装 exe | 未造启动失败 | Trent | 2026-08-23 |
| TC-INST-005 | P0 造障 | Blocked | CI SHA + 已装 exe | 未造用户插件挂死 | Trent | 2026-08-23 |
| TC-INST-006 | P0 造障 | Blocked | CI SHA + 已装 exe | 接 005 | Trent | 2026-08-23 |
| TC-INST-007 | P1 造障 | Pass | CI SHA + 已装 exe | NEG-002 见 1/3 自动重启文案 | Trent | 2026-08-23 |
| TC-INST-008 | P0 | Pass | CI SHA + 已装 exe | About 0.2.6；stamp npm 0.1.1-rc.1 | Trent | 2026-08-23 |
| TC-INST-009 | P0 | Pass | CI SHA + 已装 exe | 同号 0.2.6 `/S` overlay | Trent | 2026-08-23 |
| TC-INST-010 | P1 |  |  | 本轮未卸载 | Trent | 2026-08-23 |
| TC-INST-011 | P0 造障 | Blocked | CI SHA + 已装 exe | 未造官方 ~/.dsh 坏 bundle | Trent | 2026-08-23 |
| TC-INST-011b | P0 造障 |  |  | 未造官方 ~/.dsh credentials 毒化 | Trent | 2026-08-23 |
| TC-INST-012 | P0 | Pass | CI SHA + 已装 exe | stamp 在；无 --no-open | Trent | 2026-08-23 |
| TC-INST-013 | P0 | Pass | CI SHA + 已装 exe | resources\\node.exe v22.23.2 | Trent | 2026-08-23 |
| TC-MODEL-001 | P0 | Pass | CI SHA + 已装 exe | ayase 已配置；密钥 password 占位 | Trent | 2026-08-23 |
| TC-MODEL-002 | P1 |  |  | 未点获取可用模型 | Trent | 2026-08-23 |
| TC-MODEL-003 | P0 | Pass | CI SHA + 已装 exe | 新会话 grok-4.6 High | Trent | 2026-08-23 |
| TC-MODEL-004 | P0 | Pass | CI SHA + 已装 exe | Default/Low/High 可切；附录走 High | Trent | 2026-08-23 |
| TC-MODEL-005 | P0 | Pass | CI SHA `00a7f3b9e0` + 已装 exe | 官方 key 进程环境；图描述 pink rectangle | Trent | 2026-08-23 |
| TC-MODEL-006 | P1 | N/A | CI SHA + 已装 exe | 附录未因协议字段失败 | Trent | 2026-08-23 |
| TC-MODEL-007 | P1 |  |  | 未测空模型阻拦 | Trent | 2026-08-23 |
| TC-WS-001 | P0 | Pass | CI SHA + 已装 exe | 四栏 + Composer + Git 标题栏 | Trent | 2026-08-23 |
| TC-WS-002 | P0 | Pass | CI SHA + 已装 exe | Ctrl+, 脚本发出；Ctrl+\\ 切右栏；设置点击可达 | Trent | 2026-08-23 |
| TC-WS-003 | P1 |  |  | 未走应用菜单 | Trent | 2026-08-23 |
| TC-WS-004 | P0 | Pass | CI SHA + 已装 exe | 最小化/最大化/关闭命中区；close 已测 | Trent | 2026-08-23 |
| TC-WS-005 | P1 |  |  | 未切非 Git 目录 | Trent | 2026-08-23 |
| TC-WS-006 | P0 | Pass | CI SHA + 已装 exe | ChisaTerminal 侧栏+终端 cwd+附录目录名 | Trent | 2026-08-23 |
| TC-CHAT-001 | P0 | Pass | CI SHA `00a7f3b9e0` + 已装 exe | 验证码 742 | Trent | 2026-08-23 |
| TC-CHAT-002 | P0 | Pass | CI SHA `00a7f3b9e0` + 已装 exe | 742 | Trent | 2026-08-23 |
| TC-CHAT-003 | P0 | Pass | CI SHA `00a7f3b9e0` + 已装 exe | 读 README 工具卡 | Trent | 2026-08-23 |
| TC-CHAT-004 | P0 | Pass | CI SHA `00a7f3b9e0` + 已装 exe | `C:\\Ai\\ChisaTerminal`（Pwsh 一次调用） | Trent | 2026-08-23 |
| TC-CHAT-005 | P0 | Pass | CI SHA `00a7f3b9e0` + 已装 exe | 742 + 目录名 + 产品句 | Trent | 2026-08-23 |
| TC-CHAT-006 | P0 | Pass | CI SHA + 已装 exe | / 官方菜单；$fo 无 foo-skill | Trent | 2026-08-23 |
| TC-CHAT-007 | P0 | Pass | CI SHA + 已装 exe | `[.cnb.yml](.cnb.yml)` | Trent | 2026-08-23 |
| TC-CHAT-008 | P0 | Pass | CI SHA `00a7f3b9e0` + 已装 exe | README 源码 L1–L3 添加到对话 | Trent | 2026-08-23 |
| TC-CHAT-009 | P0 | Pass | CI SHA + 已装 exe | 改写后回复「已改写」 | Trent | 2026-08-23 |
| TC-CHAT-010 | P1 |  |  |  | Trent | 2026-08-23 |
| TC-CHAT-011 | P2 |  |  | 见 MODEL-005 | Trent | 2026-08-23 |
| TC-CHAT-012 | P1 |  |  |  | Trent | 2026-08-23 |
| TC-CHAT-013 | P1 |  |  |  | Trent | 2026-08-23 |
| TC-SESS-001 | P1 | Pass | CI SHA + 已装 exe | 新会话与附录会话并存 | Trent | 2026-08-23 |
| TC-SESS-002 | P1 | Pass | CI SHA + 已装 exe | 侧栏两会话可见 | Trent | 2026-08-23 |
| TC-SESS-003 | P0 | Pass | CI SHA + 已装 exe | 托盘恢复后会话与 grok 仍在 | Trent | 2026-08-23 |
| TC-APPROVE-001 | P0 | Pass | CI SHA + 已装 exe | 可写会话工具卡跑完；只读下无「允许一次」 | Trent | 2026-08-23 |
| TC-APPROVE-002 | P0 | Pass | CI SHA `47ad187` + 已装 exe | reject 审批流；未写 probe 文件 | Trent | 2026-08-24 |
| TC-APPROVE-003 | P1 | Pass | CI SHA + 已装 exe | Pwsh/Write 工具卡可读 | Trent | 2026-08-23 |
| TC-GIT-001 | P0 | Pass | CI SHA + 已装 exe | 分支 master、111 | Trent | 2026-08-23 |
| TC-GIT-002 | P1 |  |  | 未切测试分支 | Trent | 2026-08-23 |
| TC-GIT-003 | P0 | Pass | CI SHA + 已装 exe | 仅提交 dshd-qa-2026-08-23.txt；未 push | Trent | 2026-08-23 |
| TC-GIT-004 | P1 |  |  | 故意不 push | Trent | 2026-08-23 |
| TC-GIT-005 | P1 |  |  |  | Trent | 2026-08-23 |
| TC-GIT-006 | P1 |  |  |  | Trent | 2026-08-23 |
| TC-GIT-007 | P2 |  |  |  | Trent | 2026-08-23 |
| TC-SURF-001 | P0 | Pass | CI SHA + 已装 exe | 刷新后搜索/预览 README；Mention | Trent | 2026-08-23 |
| TC-SURF-002 | P1 |  |  | 2026-08-25 硬化：显式保存竞态已修（FileSaveCoordinator 串行 flush），ui-files spec 绿 + `qa:source` files 环绿（源码级，非发版证据）；待装包补测 | Trent | 2026-08-23 |
| TC-SURF-003 | P1 |  |  | 2026-08-25：关 tab 确认由 ui-surfaces spec + `qa:source` 覆盖（源码级，非发版证据）；待装包补测 | Trent | 2026-08-23 |
| TC-SURF-004 | P0 | Pass | CI SHA + 已装 exe | previewOpen example.com | Trent | 2026-08-23 |
| TC-SURF-005 | P2 |  |  |  | Trent | 2026-08-23 |
| TC-SURF-006 | P1 |  |  | 空态卡片含代理 | Trent | 2026-08-23 |
| TC-SURF-007 | P0 | Pass | CI SHA + 已装 exe | 关闭 README.md / 关闭 文件 在标题侧 | Trent | 2026-08-23 |
| TC-TERM-001 | P0 | Pass | CI SHA + 已装 exe | cwd ChisaTerminal；echo；wasm 200 | Trent | 2026-08-23 |
| TC-TERM-002 | P0 | Pass | CI SHA `00a7f3b9e0` + 已装 exe | Ghostty 选区「加入对话」terminal fence | Trent | 2026-08-23 |
| TC-TERM-003 | P1 |  |  | 2026-08-25：`` Ctrl+` `` 终端焦点内切抽屉已修（`[data-terminal-pane]`），ui-titlebar/ui-user-terminal spec 绿（源码级，非发版证据）；待装包补测 | Trent | 2026-08-23 |
| TC-TERM-004 | P1 |  |  | 2026-08-25：reload/崩溃收割 sender 名下 PTY 已实现，`pty.test.js` 绿（源码级，非发版证据）；待装包补测 | Trent | 2026-08-23 |
| TC-APP-001 | P0 | Pass | CI SHA + 已装 exe | 浅色/深色切换 | Trent | 2026-08-23 |
| TC-APP-002 | P0 | Pass | CI SHA + 已装 exe | Appearance 无源列表 | Trent | 2026-08-23 |
| TC-APP-003 | P0 | Pass | CI SHA + 已装 exe | 本地 PNG 进入裁切 | Trent | 2026-08-23 |
| TC-APP-004 | P1 |  |  |  | Trent | 2026-08-23 |
| TC-APP-005 | P0 | Pass | CI SHA + 已装 exe | 必应/Wallhaven/收藏 | Trent | 2026-08-23 |
| TC-APP-006 | P0 | Pass | CI SHA + 已装 exe | Bing 收藏→设壁纸→裁切 | Trent | 2026-08-23 |
| TC-APP-007 | P1 |  |  |  | Trent | 2026-08-23 |
| TC-APP-008 | P0 | Pass | CI SHA + 已装 exe | 无 R18；缩略图 fetch failed | Trent | 2026-08-23 |
| TC-APP-009 | P1 | Pass | CI SHA + 已装 exe | Appearance/图库无 Unsplash 等 | Trent | 2026-08-23 |
| TC-APP-010 | P1 | Pass | CI SHA + 已装 exe | 设壁纸后毛玻璃/像素化 | Trent | 2026-08-23 |
| TC-APP-011 | P1 | Pass | CI SHA + 已装 exe | 主题库可见 | Trent | 2026-08-23 |
| TC-APP-012 | P1 |  |  | 2026-08-27 Linux 源码级 PASS（非发版证据）：[results/2026-08-27/transparent-theme.md](results/2026-08-27/transparent-theme.md)；待装包补测 | Trent | 2026-08-27 |
| TC-APP-013 | P1 |  |  | 2026-08-27 Linux 源码级 PASS（非发版证据）：[results/2026-08-27/transparent-theme.md](results/2026-08-27/transparent-theme.md)；待装包补测 | Trent | 2026-08-27 |
| TC-APP-014 | P1 |  |  | 2026-08-27 Linux 源码级 PASS（非发版证据）：[results/2026-08-27/transparent-theme.md](results/2026-08-27/transparent-theme.md)；待装包补测 | Trent | 2026-08-27 |
| TC-EXT-001 | P0 | Pass | CI SHA + 已装 exe | 设置分区齐全 | Trent | 2026-08-23 |
| TC-EXT-002 | P0 | Pass | CI SHA + 已装 exe | 市场在设置内 | Trent | 2026-08-23 |
| TC-EXT-003 | P0 | Pass | CI SHA + 已装 exe | 发现约 1884 | Trent | 2026-08-23 |
| TC-EXT-004 | P1 |  |  | 未安装市场插件 | Trent | 2026-08-23 |
| TC-EXT-005 | P1 |  |  |  | Trent | 2026-08-23 |
| TC-EXT-006 | P1 | Pass | CI SHA + 已装 exe | 设置有 MCP/技能 | Trent | 2026-08-23 |
| TC-EXT-007 | P1 | 待测 | 待绑 CI SHA + 已装 exe | 独立插件：默认无页签；可选市场一键装/卸（不得用 2026-08-23 停放 Pass）。执行手册就绪：[tc-ext-007-dshbot-install-smoke.md](tc-ext-007-dshbot-install-smoke.md)；阻塞：云端 Linux 无法跑 Windows 安装包。2026-08-26 Linux 源码级三相轮换 PASS（不填本表 Pass）：[results/2026-08-26/tc-ext-007-dshbot.md](results/2026-08-26/tc-ext-007-dshbot.md) |  |  |
| TC-EXT-008 | P0 |  | 源码实机 53709（非 CI 包） | 设置有「用量统计」；零用量 KPI；安装包未测 | Trent | 2026-08-23 |
| TC-DESK-001 | P0 | Pass | CI SHA + 已装 exe | 关窗无标题；进程与 3080 仍在 | Trent | 2026-08-23 |
| TC-DESK-002 | P0 | Pass | CI SHA `47ad187` + 已装 exe | `run-installed-shell-p0.mjs` invokeTrayAction 五项 | Trent | 2026-08-24 |
| TC-DESK-003 | P0 | Pass | CI SHA + 已装 exe | 直接退出后进程 0、3080 关 | Trent | 2026-08-23 |
| TC-DESK-004 | P0 | Pass | CI SHA `47ad187` + 已装 exe | `run-installed-tray-quit.mjs` 进程归零 | Trent | 2026-08-24 |
| TC-DESK-005 | P1 | Pass | CI SHA + 已装 exe | About「已是最新版本 0.2.6」 | Trent | 2026-08-23 |
| TC-DESK-006 | P1 | N/A | CI SHA + 已装 exe | 无新版本 | Trent | 2026-08-23 |
| TC-DESK-007 | P2 | N/A | CI SHA + 已装 exe | 未测开机启动 | Trent | 2026-08-23 |
| TC-DESK-008 | P1 | Pass | CI SHA + 已装 exe | 通用设置自动恢复开；实机 1/3 重启 | Trent | 2026-08-23 |
| TC-DESK-009 | P1 |  |  |  | Trent |  |
| TC-NEG-001 | P0 | Pass | 源码实机 `run-remote-gate-qa` | 侧栏 trigger；默认不监听；3180 未开 | Auto | 2026-08-25 |
| TC-REM-001 | P0 | Pass | 源码实机 `run-remote-gate-qa` | 开 LAN → 听 3180 + `#offer=` + QR SVG；关停听 | Auto | 2026-08-25 |
| TC-REM-002 | P0 | Fail | T1 Rehearsal（Cursor 390） | 细则 [2026-08-30/mobile-remote-web-t1.md](results/2026-08-30/mobile-remote-web-t1.md)。301/605 已补。不得写实机全量：执行人跳过系统相机；T3 Deferred。 | Auto | 2026-08-31 |
| TC-REM-003 | P1 | 待测 |  | 审批允许一次 / 拒绝 |  |  |
| TC-NEG-002 | P0 造障 | Pass | CI SHA + 已装 exe | 杀 dsh 后自动重启回主界面 | Trent | 2026-08-23 |
| TC-NEG-003 | P1 |  |  |  | Trent | 2026-08-23 |
| TC-NEG-004 | P2 |  |  |  | Trent | 2026-08-23 |
| TC-NEG-005 | P0 | Pass | CI SHA + 已装 exe | 托盘恢复后主题/模型/工作区仍在 | Trent | 2026-08-23 |
| TC-NEG-006 | P1 |  |  |  | Trent | 2026-08-23 |

---

## 16. 签字

未填 Actions run URL 与 SHA256、或未勾「Release 将上传同一 SHA」，不得勾可交付，**不得发该包**。

| 项 | 内容 |
| --- | --- |
| Actions run URL | https://github.com/ChisaAlter/Deepseek-Harness-Desktop/actions/runs/32735432340 |
| Artifact 名 | `DeepSeek-Harness-windows-x64` |
| 安装包文件名 | `Deepseek-Harness-Desktop-Setup-0.2.7.exe` |
| SHA256（已测文件） | `52EBFCF4B43214988750552A66FF0087B1A70CD43FB6C4430F241917F7C06666` |
| Release 将上传同一 SHA | □（vision 附加步骤待下一 artifact 复验后勾选） |
| 应用 About 版本 | `0.2.7` |
| 该包内 harness 基线（勿混源码钉） | stamp `0.1.1-rc.1` / `dsh-v0.1.1-rc.1` / sha `528c682e061696f5a160f363f236ecbf53cbd006` |
| Windows 版本 / 机型 | Windows 10.0.26200 x64 |
| 模型：`ayase` / `grok-4.6` @ `https://ayase.cn/v1` | 已配置 ☑ |
| 附录 A 五轮（安装包会话，TC-WS-006 仓） | 全过 ☑（reject ☑；vision □ 待下一 CI 包） |
| P0 结果 | 全 Pass □ / 有 Fail ☑（vision） / 有 Blocked+负责人忽略 □ |
| P1 豁免/发布说明 | 见 [results/2026-08-24/ci-installer/EXECUTION-REPORT.md](results/2026-08-24/ci-installer/EXECUTION-REPORT.md) |
| 结论 | **可交付** □ / **不可交付** ☑ / **负责人忽略剩余 Blocked** □ |
| 测试负责人 / 日期 | Trent · 2026-08-24 |
| 产品负责人 / 日期 | □（vision 复验 + 勾同一 SHA 后再签） |

---

## 附录 A · 多轮对话脚本（P0 唯一标准）

同一会话按序发送（已安装 CI 包、TC-WS-006 工作区）：

1. `用一句话回复：你已连通，并给出一个三位数验证码。`  
2. `刚才的验证码是多少？只回答数字。`  
3. `阅读工作区根目录的 README 或 README.md（若存在），用三句话总结它是什么产品。`  
4. `在工作区执行一命令打印当前目录名，把命令输出原样贴给我。`  
5. `汇总：验证码、产品一句话、目录名各一行。`  

任一轮失败：记录轮次、工具卡截图、脱敏提供方信息（**不要**截密钥）、相关日志。

## 附录 B · 安全

- API 密钥禁止进入 git、公开截图、CI 日志。  
- 本文件只记载网关地址与模型 id。  
- 测毕可删除自定义提供方或轮换密钥。
