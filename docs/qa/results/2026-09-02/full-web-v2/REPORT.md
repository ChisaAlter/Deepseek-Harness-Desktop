# 手机远程 Web 全功能 v2 · T2 Rehearsal 报告

生成：2026-09-02T04:55:45.818Z · 轨：**T2 rehearsal**（Puppeteer + 源码 Electron CDP 双端）。**不是 T1**。用例表：docs/qa/mobile-remote-full-web-cases.md

| 模块 | Pass | Fail | Blocked | NA(轨) | NA(前置) | Deferred |
| --- | --- | --- | --- | --- | --- | --- |
| APPR | 3 | 0 | 5 | 0 | 0 | 0 |
| ARCH | 5 | 0 | 0 | 0 | 0 | 0 |
| CHAT | 6 | 0 | 1 | 0 | 0 | 0 |
| CMP | 19 | 2 | 4 | 0 | 2 | 0 |
| GIT | 13 | 2 | 5 | 0 | 0 | 0 |
| LAY | 11 | 2 | 1 | 1 | 0 | 0 |
| LIST | 3 | 0 | 0 | 0 | 0 | 0 |
| MENU | 7 | 0 | 0 | 0 | 0 | 0 |
| NEW | 3 | 0 | 0 | 0 | 0 | 0 |
| PAIR | 15 | 0 | 4 | 2 | 0 | 1 |
| SEED | 1 | 0 | 0 | 0 | 0 | 0 |
| SRCH | 1 | 0 | 1 | 0 | 1 | 0 |
| **合计** | **87** | **6** | **21** | | | |

## Fail

- **CMP-020** — Node is either not clickable or not an Element
- **CMP-021** — Node is either not clickable or not an Element
- **GIT-008** — 无输入框（dialog={"html":"","inputs":0,"btns":[]}）
- **GIT-014** — 30s 无失败文案
- **LAY-002** — 空 hero 不可见
- **LAY-007** — 模型列表空

## Blocked（需原因 + 豁免栏）

- APPR-001 — F-APPR ①命令(可写入工作区) ②写文件(仅可查看) 都在 90s 内无审批条（截图在档）；grok-4.6 直答/拒绝不弹窗
- APPR-002 — 无在场审批（承 APPR-001）
- APPR-005 — 第二次审批未弹（模型直答）
- APPR-003 — 桌面裁决需桌面同会话弹窗联动；受 DEF-SYNC-REVERSE 与桌面窗后台化影响，留人工复核
- APPR-004 — 第二次审批未弹
- CHAT-007 — 断隧道瞬间打开需造障；坏 id 注入属 hack 非用户路径。留 PAIR-015 批准场
- CMP-002 — roster 无第二个可用模型（其余无密钥）
- CMP-010 — 桌面 Access 属桌面当前打开会话；同会话反向需桌面打开本会话（桌面点行驱动受 DEF-SYNC-REVERSE 影响，放人工复核）
- CMP-012 — 权限切换走 /permission 的线协议证据需抓请求；UI 行为已过（CMP-009），协议级留待 devtools 抓包复核
- CMP-019 — Plan 需桌面在同一会话开启；桌面当前会话非本会话（DEF-SYNC-REVERSE 下驱动桌面开本会话不可靠），留人工
- GIT-005 — origin/qa-remote-only 在第一裸仓（F-REMOTE）；TMP 现挂 BARE2 无该远端分支。track 语义需在 CLONE 工作区补场（时间箱）
- GIT-006 — 白名单外字符分支需另推特殊名（时间箱）；switchable:false 逻辑有单测覆盖
- GIT-007 — Branch-list failure injection remains a separate tunnel interruption; not needed to alter current desktop again.
- GIT-013 — 默认分支确认三键需 push 默认分支场景驱动 dialog（本场 pill 停 Sync/分叉）；留人工
- GIT-015 — 未授权 cwd 需一个未登记目录会话（无目录会话 pill 隐藏=合规）；显式授权错误文案留人工
- LAY-008 — 无审批条可拍
- PAIR-002b — 「关远程后停听」需要停掉本场依赖的远程宿主，放在全场结束后单独验证
- PAIR-003 — 中继由公网 125.124.85.212:8411 提供且本场依赖它保持连接；断中继造障放全场末尾（PAIR-019 一并）
- PAIR-005 — 切外出模式会停 :3180 打断全场；模式切换 origin 断言与 PAIR-001 同批补
- PAIR-019 — 断中继会打断全场，放收尾单独做
- SRCH-004 — Search-failure injection requires interrupting the recovered session; same transport error behavior covered by PAIR-015.

## 判定

Fail=6 → **不可交付**。
