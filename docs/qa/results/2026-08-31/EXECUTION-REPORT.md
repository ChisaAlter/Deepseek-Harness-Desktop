# CI 安装包验收（0.2.7）· 2026-08-31 / 2026-09-01

对象是 GitHub Actions **Build installers** windows artifact（`workflow_dispatch`，**未**打 tag，**未**发 Release）。  
**发版 SHA** 是 **§7**：CI Node 22 包 `F2C571D2…`（run `33455954068`，树 `cc430e8562`）。  
§6 是此前本机 Node 24 pack，**不要**当发版文件。首包 `45EEC4AA`（run `33398643700`）已被覆盖。

测的是 **已装 exe + 真实 `%APPDATA%\Deepseek-Harness-Desktop`**，不是 `qa:packaged` / `win-unpacked` 直跑。

**不得**把 2026-08-23/24 旧 SHA 的 Pass 抄进本轮。

## 0. 产物

| 项 | 值 |
| --- | --- |
| Actions run（发版包） | https://github.com/ChisaAlter/Deepseek-Harness-Desktop/actions/runs/33455954068 |
| Setup SHA256 | `F2C571D285B68E730FEFF5E8FB1362F48484761278D939D84E2BFD1298562856` |
| 树 | `cc430e856207129dfe2eebf0549492bd4bd6efa5` |
| Setup | `Deepseek-Harness-Desktop-Setup-0.2.7.exe` |
| 安装路径 | `%LOCALAPPDATA%\Programs\Deepseek-Harness-Desktop\` |
| bundled node | **v22.22.2** |
| harness pin | `dsh-v0.1.2-alpha.2` / npm `0.1.2-alpha.2` / sha `0a53fb55bea101816fa226bb964ae2bed71c343b` |
| 家目录 | `%APPDATA%\Deepseek-Harness-Desktop`（无 `--user-data-dir`） |
| 本机 HEAD pack（非发版） | SHA256 `49BD62B56D47FE0AD312B9E4C684D3070AFF81D6086595F55C80FB28C403FECA` · Node **v24.15.0** |
| 首包 CI（已覆盖） | run `33398643700` · SHA256 `45EEC4AA…` |

脚本与 JSON 证据：`docs/qa/results/2026-08-31/ci-installer/`。

## 7. CI Node 22 · 已装全套（2026-09-01）

`workflow_dispatch` 打出本树 Setup，`/S` overlay 后 `run-installed-full.mjs` 第一轮 **exit 0**（release / composer / appendix / remote / shell / packagedP0 全绿）。第二轮 persist 打包 walker 只数 `session.jsonl`，live 是 `session.jsonl.zstd`（**85** 个），packed `persist.sessions` Fail、`persistExit.code=1`；host 复核后 `install-full-report.json` **`pass: true`**（`persistOverride`）。`run-installed-tray-quit.mjs` **`pass: true`**，进程 0。

| 空 P0 | 本 SHA |
| --- | --- |
| TC-MODEL-004 | **Pass** `composer.thinkingSwitch` `switched Low → Default` |
| TC-SESS-003 | **Pass** 85 × `session.jsonl.zstd`；persist workspace/theme/model |
| TC-TERM-002 | **Pass** `case.terminal.addToChat` 终端 fence |
| TC-NEG-005 | **Pass** midnight / ChisaTerminal / grok-4.6 Default / wallpaper / closeToTray |

其余此前卡住的 P0（wasm、Lexical、Session 日志、Git subject、mention、市场、识图、附录 README、reject、vision）本 SHA 仍绿。DESK-003/004 本 SHA tray-quit 绿。

测后 live `config.json` 已改回 `theme=deepseek`、`workspace=C:\Ai\Deepseek-Harness-Desktop`。`dshd-reject-probe.txt` 未写入。

§16 已填该 SHA 并勾「Release 将上传同一 SHA」。**未** tag、**未** `gh release create`、**未**升版。造障项仍 Blocked。产品负责人未签。

## 6. HEAD 本机 Setup · 已装全套（2026-08-31 夜）

`run-installed-full.mjs` **`pass: true`**，`exit.code=0`。证据当时写在 `install-full-report.json`（已被 §7 同路径覆盖为 CI SHA）。本机 pack SHA `49BD62B5…`，bundled node **v24.15.0**，**不是**发版文件。

| 原 Fail | 当时本机 SHA |
| --- | --- |
| Ghostty wasm HTTP 404 | **Pass** `200` `.../ghostty-vt.wasm` |
| Lexical / mention | **Pass** `files.mentionAppended`=`[note.md](note.md)`；composer official 全绿 |
| Session 日志 | **Pass** 标题栏 `Session 日志` |
| git.commit 撞旧 subject | **Pass** `qa: commit note.md 1788206709410` |
| 附录第 3 轮未读 README | **Pass** tool-card + ChisaTerminal 产品句 |
| appendix.reject | **Pass** 只读沙箱弹出审批条后点拒绝；`dshd-reject-probe.txt` 未写入 |
| appendix.vision | **Pass** `当前模型不支持图片，请切换支持图片的模型` |
| market.discover / visionPicker | **Pass** |

pwsh/bash：模型经常带 `sandbox_permissions` 却省略 `justification`。本树在两工具里用必填 `description` 补审批理由，审批条才能出现（`tool-pwsh` 62/62 vitest）。

首包 CI SHA（`45EEC4AA…`）的启动器/托盘记录仍见下方 §1–§2。§3–§5 是该首包当时的 Fail 账，已被 §6/§7 覆盖。

## 1. 启动器 / 安装

| ID | 结果 | 证据 |
| --- | --- | --- |
| TC-INST-001 | **Pass** | 该 CI Setup `/S` 落到 LocalAppData；可启动 |
| TC-INST-002 | **Pass** | `install-p0-continue-report.json`：二次 spawn 仍一条 harness URL |
| TC-INST-012 | **Pass** | 同号 0.2.7 `/S` overlay；`silent-install-report.json` |
| TC-INST-013 | **Pass** | `resources\node.exe` → v22.22.2 |
| TC-LAUNCH-002 自动 | **Pass** | autoStart → `desktop.state=ready` + `127.0.0.1:3080` |
| TC-LAUNCH-006 关窗 | **Pass** | 关 launcher 后 harness 仍在 |
| TC-LAUNCH-006 再开 | **Pass** | `window.shell.openLauncher()` → launcher 再现 |
| TC-LAUNCH-007 | **Pass** | celadon 配置下 launcher 官方白底；无青瓷种子 |
| TC-LAUNCH-003 | **N/A** | 已装 0.2.7 即 `/releases/latest`，无「有更新点否」路径 |
| TC-LAUNCH-004 | **N/A** | dest sessions 非空 |
| 造障 INST-004/005/006/011/LAUNCH-005/008 | **Blocked** | 本轮未安全造障 |
| TC-INST-010 | 未测 | 本轮不卸载 |

源码 `electron .` 曾与已装 exe 争同一 `appId` + `%APPDATA%`。`killProduct` 现会结束该仓库的 `electron.exe` 树和孤儿 `dsh web`，不会 `taskkill /IM electron.exe`（避免误杀 Cursor）。

## 2. 桌面壳 / 托盘

| ID | 结果 | 证据 |
| --- | --- | --- |
| TC-DESK-001 / 002 | **Pass** | `install-full-report.json` shell：关进托盘、托盘五项、打开启动器 |
| TC-DESK-003 / 004 | **Pass** | `install-tray-quit-report.json`：`exit.code=0`，进程数 0 |
| TC-WS-002 / 004 | **Pass** | Ctrl+, / 右栏 / 终端快捷键；最小化最大化可点 |
| 远程 | **N/A（停放）** | `parked.unavailable` / 无入口 / 不听；`REMOTE_FEATURE_ENABLED=false` |

Shell persist 探针会把主题写成 `midnight`。测后已把 live `config.json` 的 `theme` 改回 `deepseek`。

## 3. 附录 A（已装 exe + ChisaTerminal）

烘焙的 `DSH_QA_APPENDIX` 仍往 `[data-composer-card] textarea` 打字；0.1.2-alpha.2 composer 是 Lexical `[data-composer-input]`。因此 **`run-installed-full.mjs` 的附录套件 Fail**（`appendix.model` 停在 glm-5.3-flash，prompt 写不进）。

改用 CDP `Input.insertText` 驱动已装 exe：`run-installed-appendix-ce.mjs` → `install-appendix-ce-report.json`。

| 步骤 | 结果 |
| --- | --- |
| 模型 | **Pass** grok-4.6 @ ayase |
| 附录 1 | **Pass** 验证码 **456** |
| 附录 2 | **Pass** 456 |
| 附录 3 | **Fail（表）** 有工具卡，但模型声称根目录没有 README.md；仓内实际有 `C:\Ai\ChisaTerminal\README.md` |
| 附录 4 | **Pass** `C:\Ai\ChisaTerminal` |
| 附录 5 | **Pass** 456 + 目录名；产品句沿用第 3 轮误述 |
| reject / vision / editUser | **未测** 本轮 CDP 驱动只跑了五轮 |

TC-WS-006：**Pass**（侧栏会话 cwd 为已登记兄弟仓 `C:\Ai\ChisaTerminal`，不是启动仓子路径）。

## 4. 走表套件（`DSH_QA` 烘焙 walker）

`install-full-report.json` / `install-full-log.txt`。Git 标题栏在本 SHA **已绿**（`titlebar.branchMenu` / `gitMenu` opened；smoke hits surfaces/branch/git = 1）。

**Pass（抽样）：** 四栏、Appearance 无源列表、本地裁切、Bing 设壁纸、Wallhaven SFW、毛玻璃/像素化、终端抽屉、Files 搜索/README、Browser URL、tab 关闭在标题侧、用量统计分区、dshbot 默认无页签、MCP/技能入口、市场分区存在、自定义提供方表单（会在 live 设置里留下 `Dshd QA` 占位提供方，可手工删）。

**Fail：**

| 点 | 说明 |
| --- | --- |
| walker `textarea` | `workspace.connected` / `composer.textarea` / mention / git.commit 打字全挂。产品 composer 已是 contenteditable |
| `git.commit` | HEAD 仍是上次 QA 的 `qa: dshd production walk note`；提交框没打开 |
| Ghostty wasm | `GET /plugins/@deepseek-ai/dsh-client-ui-user-terminal/assets/ghostty-vt.wasm` **404**（`lib/assets/` 同样 404）。磁盘上 `runtime\0.2.7\...\lib\assets\ghostty-vt.wasm` **在**。终端抽屉能开、PTY echo 过 |
| `titlebar.sessionLog` | 标题栏按钮只有分支 / Commit / Git / 终端 / 右栏，无「会话日志」 |
| `models.visionPicker` | 设置 → 模型 无「识图模型」文案 |
| `market.discover` / `installed` | 市场分区在，发现/已安装标签 walker 未点到 |

## 5. 首包结论（已被 §6 覆盖）

当时 CI SHA **不可交付**（wasm 404、walker textarea、附录 README、reject/vision 未测）。那些 Fail 已在 HEAD 本机 Setup 关闭，见 **§6**。
