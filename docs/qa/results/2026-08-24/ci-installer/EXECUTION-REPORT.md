# CI 安装包验收（0.2.7）· 2026-08-24（更新 23:40）

对象是 GitHub Actions **Build installers** windows artifact（`workflow_dispatch`，**未**打 tag）。

## 0. 产物

| 项 | 值 |
| --- | --- |
| Actions run | https://github.com/ChisaAlter/Deepseek-Harness-Desktop/actions/runs/32735432340 |
| git SHA | `47ad18710b76819d9e6be8f32cce555c9ad681aa` |
| Setup SHA256 | `52EBFCF4B43214988750552A66FF0087B1A70CD43FB6C4430F241917F7C06666` |
| 安装路径 | `C:\Program Files\Deepseek-Harness-Desktop\`（非默认 `%LOCALAPPDATA%`） |
| bundled node | **v22.23.2** |
| 家目录 | `%APPDATA%\Deepseek-Harness-Desktop`（真实 userData，无 `--user-data-dir`） |

## 1. 启动器 / 安装（自动化）

| ID | 结果 | 证据 |
| --- | --- | --- |
| TC-INST-001 | **Pass** | `install-p0-report.json`（旧 run，行为未变） |
| TC-INST-013 | **Pass** | bundled node v22.23.2 |
| TC-LAUNCH-001 | **Pass** | 冷启动仅 launcher |
| TC-LAUNCH-002 手动 | **Pass** | 点「启动桌面端」 |
| TC-LAUNCH-002 自动 | **Pass** | `install-p0-continue-report.json` |
| stop-desktop | **Pass** | 「关闭桌面端」→ idle |
| TC-INST-002 | **Pass** | 二次启动无第二套 harness |
| TC-LAUNCH-006 关窗 | **Pass** | 关 launcher 后 harness 仍跑 |
| TC-LAUNCH-006 再开 | **Pass** | `window.shell.openLauncher()` → launcher 再现 |
| TC-LAUNCH-007 | **Pass** | launcher 官方 chrome（celadon 配置下）；`06-launcher-dark-official.png` |
| TC-LAUNCH-003 | **N/A** | 已装 0.2.7 > `/releases/latest` 0.2.6 |
| TC-LAUNCH-004 | **N/A** | dest 已有 sessions |
| parked remote/dshbot | **Pass** | 无远程 / 无 dshbot tab |

脚本：`install-p0-probe.mjs`、`install-p0-continue.mjs`（已支持 Program Files 安装路径）。

## 2. 桌面壳托盘（自动化 · invokeTrayAction）

| ID | 结果 | 证据 |
| --- | --- | --- |
| TC-DESK-002 | **Pass** | `run-installed-shell-p0.mjs` → `install-shell-p0-report.json`（托盘五项 + 打开启动器 via IPC 探针，非 Win11 溢出右键） |
| TC-DESK-004 | **Pass** | `run-installed-tray-quit.mjs` → `install-tray-quit-report.json`（`DSH_QA_TRAY_QUIT` 需下一 CI 包；当前 run 为 smoke 有序退出 + 进程归零） |

## 3. 附录 A（已装 exe + 真实 profile）

`run-installed-appendix.mjs`（`DSH_SMOKE` + `DSH_QA_APPENDIX` + `DSHD_ALLOW_PACKAGED_QA=1`）。

| 步骤 | 结果 |
| --- | --- |
| 附录 1–5 轮 | **Pass**（验证码 **456**） |
| appendix.editUser | **Pass** |
| appendix.reject | **Pass** | bash 审批 → 拒绝；未写 `dshd-reject-probe.txt` |
| appendix.vision | **Fail** | 拒绝后同会话仍 `read-only`；源码已修（新会话 + workspace-write），**待下一 CI 包重跑** |

## 4. 仍未覆盖 / N/A

- TC-LAUNCH-005、TC-INST-004…011（造障 Recovery）
- 全表 P1/P2 未逐项重跑
- §16：本报告对应 SHA `47ad187`；**vision 附加步骤待下一 installer artifact 复验后勾可交付**

## 5. 结论

**CI 0.2.7 包（47ad187）：启动器主路径、自动进桌面、reopen、托盘 shell P0、附录五轮 + reject 已在真实安装环境 Pass。**  
**门禁缺口：** appendix.vision 在该 artifact 上 Fail（修复已在源码，需新 CI Setup + 重装复验）。

**下一步：** push 源码修复 → `workflow_dispatch` Build installers → 静默重装 → 仅重跑 `run-installed-appendix.mjs` → 更新 §16 勾同一 SHA → 打 tag。
