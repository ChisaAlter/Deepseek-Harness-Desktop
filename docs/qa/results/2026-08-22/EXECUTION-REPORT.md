# 生产验收执行报告 · 2026-08-22

**结论：NSIS Setup 已打出并完成对本机 8/20 安装的静默覆盖升级；冷启动写出 `%APPDATA%\Deepseek-Harness-Desktop\dsh-home`，壳层 `credentials.json` / `config.json` 仍在。应用内附录工具卡未跑。vendor Phase A 已吸收 7 份 replay 失败；仍红 `built-boot.snapshot.ts` 与 `approval-composer.e2e.ts`。**

Touching: `dsh-home`

落地提交：`4f76c3cd34` `feature(dsh-home): 桌面 Harness 家目录与官方 ~/.dsh 隔离`；`f54e96cb54` 记下 vendor 测试债计划。

后续补测（同日深夜）：根因是 pnpm 隔离的 `app-builder-lib` 解析到 `@electron/get@3.0.0`（无 `ElectronDownloadCacheMode`）。钉到 `5.1.0` 后 `npm run dist` **PASS**，产物 `dist/Deepseek-Harness-Desktop-Setup-0.2.6.exe`（约 469 MB）。对本机 `%LOCALAPPDATA%\Programs\Deepseek-Harness-Desktop\` 静默 `/S` 覆盖：exe 时间 2026-08-23 00:06；首次启动约 2s 创建 `dsh-home/profiles/web`；credentials/config 仍在；官方 `~/.dsh` 仍在。vendor Phase D 装配快照 **88 passed / 33 skipped**；Phase B6 sdk/server 判定为 waitFor flake，**keep** `assertToolTranscriptValid`。Phase A 首轮 9 红 / 76 绿；吸收 SettingsSelect 金标、win32 bash/`run_code`、trajectory 滚动上限、workspace hover `force` click、smoke-real 180s 后 7 文件重跑绿。仍红：`built-boot.snapshot.ts`（需完整 `pnpm run build` 记录）、`approval-composer.e2e.ts`（win32 无 bash，无审批面板；未在代码里 skip）。未跑 `hmr-live` / `cordis-tool-round`。

Remote QA 日志改为 `summarizeRemoteQaDetail`，不再 `JSON.stringify` pairing token。

---

## 0. 环境与产物

| 项 | 值 |
| --- | --- |
| 日期 | 2026-08-22 |
| 测的是什么 | 源码 + `win-unpacked` + 当日 NSIS Setup 覆盖本机安装 |
| HEAD | `4f76c3cd34`（dsh-home）+ `f54e96cb54`（vendor 测试债计划） |
| package.json | `0.2.6` |
| 已装 Setup | `%LOCALAPPDATA%\Programs\Deepseek-Harness-Desktop\`，exe 时间 **2026-08-23 00:06**（覆盖升级后，含 dsh-home） |
| `dist/win-unpacked` | 2026-08-22 23:29，含隔离；`smoke:packaged` PASS |
| OS | Windows 10.0.26200 x64 |
| 模型网关 | `https://ayase.cn/v1` / `grok-4.6`（附录 A；密钥未入本报告） |
| 证据目录 | `docs/qa/results/2026-08-22/` |

测前结束了占用产品 `userData` 的源码 `electron .`（单实例锁）。密钥未写入本报告与结果 JSON 的明文字段。Remote pairing token 已从结果日志脱敏。

---

## 1. 执行手段

| 批次 | 命令/方式 | 结果 |
| --- | --- | --- |
| A | `npm test` | **PASS**（落地后 686；钉 NSIS 后 **688 / 688**） |
| B | TC-INST-011 毒化 `~/.dsh/profiles/web` 后源码冷启动 | **PASS**（隔离；标题栏 Git 菜单冒烟仍 flake，不计入本条） |
| C | `DSH_SMOKE_KEEP=1 npm run qa:source` | **PASS**（必过步骤全绿，含 Surfaces / 终端 / Browser URL） |
| D | `DSH_SMOKE_KEEP=1 npm run qa:composer` | **PASS**（11/11；Remote 已监听） |
| E | `scripts/run-acceptance-appendix-a.mjs`（网关多轮） | **PASS**（5/5） |
| F | `npm run pack` + `smoke:packaged` | **PASS**（解包隔离） |
| F2 | `npm run dist`（NSIS Setup） | **PASS**（钉 `@electron/get@5.1.0` 后） |
| F3 | 覆盖升级 TC-INST-009 | **PASS**（`/S` 覆盖；`dsh-home` 新建；壳层凭据仍在） |
| G | 应用内附录 A 工具卡（读文件 / 跑命令 / 审批） | **未做** |

冒烟脚本不再向 Electron 注入 `DSH_HOME`；`dshd-smoke.json` 记录 `desktopHome`、`homeLog`、`electronEnv.DSH_HOME`。Composer 将 Remote 快照里的空字符串 `error` 视为无错误（先前假失败）。

---

## 2. 本轮相对 2026-08-21 的变化

- **`qa:source` 由 Fail 转为 Pass。** 上次失败的 `terminal.drawer` / `agents.empty` / `diff.panel` / `browser.url` / `terminal.surface` 本次均为 PASS。
- **dsh-home：** 毒化官方 `~/.dsh` 后仍 `Web UI 就绪`；桌面家目录在隔离 `userData/dsh-home`；`~/.dsh/settings.yaml` 哈希未变；测后已还原 profile manifest。
- 产品 AppData 在测前没有 `dsh-home`。覆盖升级后首次启动约 2s 写出 `%APPDATA%\Deepseek-Harness-Desktop\dsh-home\profiles\web`；壳层 `credentials.json` / `config.json` 仍在；官方 `~/.dsh` 仍在。

---

## 3. 用例结果摘要

图例：Pass / Fail / Blocked / Partial / N/A。

### 安装与启动

| ID | 结果 | 依据 |
| --- | --- | --- |
| TC-INST-001 | Pass | 源码 + `win-unpacked` + NSIS Setup；覆盖后冷启动进 Web UI |
| TC-INST-002 | N/A | 未专项双开 |
| TC-INST-003 | Pass | 冷启动进 Web UI（INST-011 + qa:source） |
| TC-INST-004～007 | Blocked | 未造恢复/倒计时障 |
| TC-INST-008 | Partial | 源码 0.2.6；未对 Release 安装包逐条核对 |
| TC-INST-009 | Pass | `/S` 覆盖 8/20 安装；exe 2026-08-23 00:06；`dsh-home` 新建（须在桌面重配会话/主题）；壳层凭据仍在；未卸载 |
| TC-INST-010 | N/A | 未卸载 |
| TC-INST-011 | Pass | 毒化 `dsh.profile.bundles` 后仍 `hasFrame` + `Web UI 就绪`；`homeLog` 指向 `userData/dsh-home`；Electron `DSH_HOME` 为空；官方 settings 未改写；测后还原。PTY 未在抽屉里实跑官方 `dsh` CLI（机制：不注入桌面 home） |

### 模型

| ID | 结果 | 依据 |
| --- | --- | --- |
| TC-MODEL-001～003 | Partial | 本机 `~/.dsh` 已有 ayase/`grok-4.6`；**新桌面 home 为空**，未在隔离 home 里走设置表单 |
| TC-MODEL-004 | N/A | 未测思考强度档 |
| TC-MODEL-005 | N/A | 未测识图 |
| TC-MODEL-006～007 | N/A | 未触发 |

### 工作区 / Composer / 对话

| ID | 结果 | 依据 |
| --- | --- | --- |
| TC-WS-001 | Pass | qa:source 选工作区进四栏 |
| TC-WS-002 | Partial | 标题栏终端/右栏可点；未系统测快捷键 |
| TC-WS-003 | N/A | 未测应用菜单 |
| TC-WS-004 | Partial | 窗口存在；未测 min/max |
| TC-WS-005 | N/A | 未测非 Git 目录 |
| TC-CHAT-001～005 | Partial | 网关附录 A 5/5；脚本向模型注入 README/cwd，**不能**代替应用内工具卡 |
| TC-CHAT-006 | Pass | `$fo` / `@` 边界 |
| TC-CHAT-007～008 | Pass | Mention + L-range preview |
| TC-CHAT-009～011 | N/A | 未测改写/取消/附图 |

### 会话 / 审批 / Git

| ID | 结果 | 依据 |
| --- | --- | --- |
| TC-SESS-* | N/A | 未测重启后会话（新 home 本就空） |
| TC-APPROVE-* | N/A | 无应用内工具轮 |
| TC-GIT-001 | Pass | qa:source 分支/Git 菜单 |
| TC-GIT-002～007 | N/A | 未写仓库 |

### Surfaces / 终端

| ID | 结果 | 依据 |
| --- | --- | --- |
| TC-SURF-001 | Pass | Files 搜索 / mention |
| TC-SURF-002～003 | N/A | 未测保存/关 tab |
| TC-SURF-004 | Pass | `browser.panel` + `browser.url` |
| TC-SURF-005 | N/A | 未测截图/PiP |
| TC-SURF-006 | Pass | Agents 面板 + empty |
| TC-SURF-007 | N/A | 未测关闭钮方位 |
| TC-TERM-001 | Pass | drawer / new / surface + PTY `echoed:ok` |
| TC-TERM-002 | Pass | composer 选区送对话 |
| TC-TERM-003～004 | N/A | 未测多分屏/销毁 |

### 外观 / 扩展 / 桌面壳 / 负向

| ID | 结果 | 依据 |
| --- | --- | --- |
| TC-APP-001～002,005 | Pass | appearance choose/browse/noSourceDump + gallery |
| TC-APP-003,006,008 | Partial | 入口在；未走确认设壁纸 / Wallhaven 人工 SFW |
| TC-APP-004,007,009～011 | N/A | 未深测 |
| TC-EXT-001～003,007 | Pass | 设置分区 / 市场 / dshbot 侧栏缺席 |
| TC-EXT-004～006 | N/A | 未装卸插件（市场安装落点是 dsh-home 的用户路径，本轮未点安装） |
| TC-DESK-001～008 | N/A | 未测托盘/关闭/更新 |
| TC-NEG-001 | Pass | qa:source：Remote 默认关且不监听 |
| TC-REM-001 | Pass | composer：`remoteEnabled=true` 后 listening |
| TC-REM-002～003 | N/A | 未开手机 / 未点审批 |
| TC-NEG-002～004 | Blocked/N/A | 未造崩溃/错钥/离线 |
| TC-NEG-005 | Partial | 隔离 home 写出 `settings.yaml` / `profiles/web`；未做杀进程再开抽检 |
| TC-NEG-006 | N/A | 未测关闭遮罩 |

---

## 4. 门禁对照

| 门禁项 | 状态 |
| --- | --- |
| 含 dsh-home 的安装包可启动 | **解包 PASS**；NSIS Setup PASS（本地 `dist/`） |
| 源码四栏 + PTY | Pass |
| 官方 `~/.dsh` 毒化不能拖死桌面 | Pass |
| Composer 官方边界 + Mention/终端送对话 | Pass |
| Remote 默认关；开启后监听 | Pass |
| 图库/外观无源倾倒 + dshbot | Pass |
| 附录 A 网关多轮 | Pass |
| 应用内完整附录 A（含工具卡） | **未完成** |
| `qa:source` 全绿 | Pass |
| 覆盖升级须重配（TC-INST-009） | Pass（`dsh-home` 空家目录；壳层凭据仍在） |
| 托盘/卸载/识图 | 未测 |

**可交付签字：否**（Setup 与覆盖升级已过；应用内工具卡未跑；vendor 仍有 `built-boot` / `approval-composer` 红；本 Setup 是本地 `dist/`，不是 GitHub Release）。

建议下一步：

1. 应用内附录 A 第 3～5 轮（工具卡 + 审批）。  
2. vendor 完整 `pnpm run build` 后再跑 `built-boot.snapshot.ts`；`approval-composer` 需 pwsh 重录或 Trent 允许 win32 skip。  
3. Phase C：`hmr-live.e2e.ts`（勿与 replay 池并行）。  
4. GitHub Release 另走签字流程（本 Setup 未签名发布）。

---

## 5. 证据索引

| 文件 | 内容 |
| --- | --- |
| `inst-011.json` / `inst-011-smoke.json` / `inst-011.log` | 毒化官方 home 后的隔离证据 |
| `web-package.json.orig` | 官方 web profile 备份（测后已还原到 `~/.dsh`） |
| `qa-source.log` / `qa-source.png` / `qa-source-smoke.json` | release UI walk |
| `qa-composer.log` / `qa-composer.png` / `qa-composer-smoke.json` | composer official QA |
| `appendix-a-gateway.json` | 网关五轮（含注入的 README 摘录，无密钥） |

---

## 6. 签字栏（本轮）

| 项 | 内容 |
| --- | --- |
| 安装包文件名 | `dist/Deepseek-Harness-Desktop-Setup-0.2.6.exe`（本地 NSIS，未作 GitHub Release） |
| 应用 About 版本 | `0.2.6` |
| 模型 | ayase / `grok-4.6` @ `https://ayase.cn/v1` 已用于网关附录 |
| 附录 A 五轮 | 网关全过；应用内工具卡未跑 |
| P0 结果 | 解包隔离 Pass；NSIS Pass；INST-009 Pass；对话 Partial（网关） |
| 结论 | **不可按 Release 交付**（本地 Setup 与覆盖升级可通过；缺应用内工具卡与签名发布） |
| 测试执行 | 2026-08-22～23 · 源码 + unpacked + 本地 Setup 覆盖 |
