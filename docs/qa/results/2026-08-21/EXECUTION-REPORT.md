# 生产验收执行报告 · 2026-08-21

**结论：不可交付（有条件阻塞）。** 安装包可启动、Composer/PTY/图库/市场/dshbot/Remote 负向与网关多轮大多通过；`qa:source` 自动化仍有 Surfaces/终端抽屉失败项，且实机终端出现 `libghostty-vt (404)`，需修复或豁免后再签字。

---

## 0. 环境与产物

| 项 | 值 |
| --- | --- |
| 日期 | 2026-08-21 |
| 产物 | 本机已装 `Deepseek-Harness-Desktop`（Local\\Programs） |
| About/UA | `Deepseek-Harness-Desktop/0.2.6` · Electron 43.4.0 |
| exe SHA256 | `E96B5E3CF0B472AB6CD728393B823D58252E77C088FD99478D82EE370C01D877` |
| version 文件 | `43.4.0`（Electron 版本文件，非产品 tag 文案） |
| 模型 | `deepseek-official` / `grok-4.6` @ `https://ayase.cn/v1`（本机已有配置） |
| OS | Windows（执行机） |
| 证据目录 | `docs/qa/results/2026-08-21/` |

密钥未写入本报告与结果 JSON。

---

## 1. 执行手段

| 批次 | 命令/方式 | 结果 |
| --- | --- | --- |
| A | `npm run qa:source` | **FAIL**（8 个必过步骤） |
| B | `npm run qa:composer` | **PASS**（11/11） |
| C | `DSH_SMOKE_EXE=<安装包exe> npm run smoke:packaged` | **PASS** |
| D | `node scripts/run-acceptance-appendix-a.mjs`（网关多轮） | **PASS**（5/5） |
| E | CDP 安装包实例：Surfaces/终端探活 | 终端/差异/代理可点；Browser URL 输入未找到 |
| F | CDP 安装包实例：应用内发送一轮对话 | **PASS**（`INAPP_T1 … 456`，工具 Workspace Write，思考 High） |

---

## 2. 关键缺陷 / 风险

### DEF-001 · `qa:source` Surfaces / 终端抽屉自动化失败 · Critical（待复核）

失败步骤：`terminal.drawer`、`terminal.new`、`agents.panel`、`agents.empty`、`diff.panel`、`browser.panel`、`browser.url`、`terminal.surface`。

对照证据：

- 同日 `qa:composer` 中 `case.terminal.addToChat` **PASS**，PTY `echoed:ok`。  
- CDP 对安装包实例：终端区域可交互、Diff/Agents 可点开。  
- Browser URL 输入在 CDP 中仍 `hasUrl:false`。

**判断：** 不全是产品必挂；存在 walk 时序/选择器脆弱性。但 **Browser URL** 与 **Agents empty copy** 仍需人工点验后才能从门禁摘掉。

证据：`qa-source.log`、`qa-source.png`、`cdp-surface-probe.json`。

### DEF-002 · 终端 `Unable to load libghostty-vt (404)` · Critical

应用内对话轨迹中出现：

> Unable to load libghostty-vt (404) — close and reopen the terminal to retry.

影响终端表面可靠性（与 TC-TERM-001 / 工具终端卡相关）。

证据：`cdp-inapp-poll.json` / `.log`。

### DEF-003 · 应用内附录 A 仅完成连通轮 · Major（覆盖缺口）

CDP 完成一轮连通+验证码；工具轮（读 README / 跑命令 / 五轮汇总）未在应用内完整跑完。网关脚本 D 批 5/5 通过，**不能替代**应用内工具卡与审批。

---

## 3. 用例结果摘要（对照 `production-acceptance-test-cases.md`）

图例：Pass / Fail / Blocked / Partial / N/A（本轮未造障或未测）。

### 安装与启动

| ID | 结果 | 依据 |
| --- | --- | --- |
| TC-INST-001 | Pass | 已装 0.2.6；packaged smoke 进主界面 |
| TC-INST-002 | Partial | 未专项双开；有单实例设计证据 |
| TC-INST-003 | Pass | packaged/source smoke 进入 frame |
| TC-INST-004～007 | Blocked | 未造障 |
| TC-INST-008 | Partial | UA 0.2.6；SHA 已记；Release 文案未逐条人工核对 |
| TC-INST-009 | N/A | 未做覆盖升级 |
| TC-INST-010 | N/A | 未卸载 |

### 模型

| ID | 结果 | 依据 |
| --- | --- | --- |
| TC-MODEL-001～003 | Pass | 本机 settings 已配 ayase；默认 grok-4.6；应用内可发 |
| TC-MODEL-004 | Pass | 应用内轨迹显示 `High` 思考档 |
| TC-MODEL-005 | N/A | 未测识图 |
| TC-MODEL-006～007 | N/A | 未触发 |

### 工作区 / Composer / 对话

| ID | 结果 | 依据 |
| --- | --- | --- |
| TC-WS-001～002 | Pass | smoke + titlebar hits |
| TC-WS-003 | N/A | 未测菜单 |
| TC-WS-004 | Partial | 窗口存在；未系统测 min/max |
| TC-CHAT-001～005 | Partial | 网关附录 A 全过；应用内仅 CHAT-001 级连通+工具现身 |
| TC-CHAT-006 | Pass | qa:source `$fo` / `@` 边界 |
| TC-CHAT-007～008 | Pass | composer QA Mention + L-range preview |
| TC-CHAT-009～011 | N/A | 未测 |

### 会话 / 审批 / Git

| ID | 结果 | 依据 |
| --- | --- | --- |
| TC-SESS-* | N/A | 未测持久化切换 |
| TC-APPROVE-* | N/A | 应用内工具出现但未点审批矩阵 |
| TC-GIT-001 | Pass | titlebar branch/git 菜单 qa:source |
| TC-GIT-002～007 | N/A | 未写仓库 |

### Surfaces / 终端

| ID | 结果 | 依据 |
| --- | --- | --- |
| TC-SURF-001 | Pass | Files search/mention |
| TC-SURF-002～003 | N/A | 未测保存/关 tab |
| TC-SURF-004 | Partial | CDP 可点浏览器入口；URL 框未确认 |
| TC-SURF-005～006 | Partial | CDP Agents 可点；empty copy 自动化失败 |
| TC-SURF-007 | N/A | 未测关闭钮方位 |
| TC-TERM-001 | Fail | libghostty-vt 404（DEF-002）；PTY smoke 仍 ok |
| TC-TERM-002 | Pass | composer QA add-to-chat |
| TC-TERM-003～004 | N/A | 未测 |

### 外观 / 扩展 / 桌面壳 / 负向

| ID | 结果 | 依据 |
| --- | --- | --- |
| TC-APP-001～003,005～006,008 | Pass/Partial | qa:source appearance/gallery/noSourceDump |
| TC-APP-004,007,009～011 | N/A | 未深测清除/主题库/禁源人工 |
| TC-EXT-001～003,007 | Pass | market + dshbot tab/page |
| TC-EXT-002 | Pass | 市场在设置内（walk） |
| TC-EXT-004～006 | N/A | 未装卸插件/MCP 实装 |
| TC-DESK-001 | Partial | config `closeToTray:true`；未点关窗 |
| TC-DESK-002～008 | N/A | 托盘菜单/更新/直接退出未测 |
| TC-NEG-001 | Pass | remote unavailable + notListening（composer+source） |
| TC-NEG-002～004 | Blocked/N/A | 未造障/未断网 |
| TC-NEG-005 | N/A | 未做杀进程持久化抽检 |

---

## 4. 门禁对照

| 门禁项 | 状态 |
| --- | --- |
| 安装包可启动 + 四栏 + PTY | Pass |
| Composer 官方边界 + Mention/终端送对话 | Pass |
| Remote stub 负向 | Pass |
| 图库/外观无源倾倒 + dshbot | Pass |
| 附录 A 网关多轮 | Pass |
| 应用内完整附录 A（含工具卡） | **未完成** |
| `qa:source` 全绿 | **Fail** |
| 终端无 libghostty 错误 | **Fail** |
| 托盘/升级/卸载/识图 | 未测 |

**可交付签字：否。**

建议修复/复测优先级：

1. DEF-002 libghostty-vt 404  
2. 人工复测 Browser URL、Agents 空态、终端抽屉标题栏开关（澄清 DEF-001）  
3. 应用内跑完附录 A 第 3～5 轮（读文件 + shell + 汇总）  
4. 托盘菜单与关闭行为各 1 条  

---

## 5. 证据索引

| 文件 | 内容 |
| --- | --- |
| `qa-source.log` / `.png` | release UI walk |
| `qa-composer.log` / `.png` | composer official QA |
| `smoke-packaged.log` | 安装包 smoke |
| `appendix-a-gateway.json` | 网关五轮 |
| `cdp-surface-probe.json` | CDP Surfaces/终端 |
| `cdp-inapp-poll.json` | 应用内连通回复 + ghostty 报错 |

辅助脚本（本轮新增，非产品运行时）：`scripts/run-acceptance-appendix-a.mjs`、`scripts/run-cdp-surface-probe.mjs`、`scripts/run-cdp-inapp-chat.mjs`、`scripts/run-cdp-inapp-poll.mjs`。
