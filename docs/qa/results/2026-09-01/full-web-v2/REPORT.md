# 手机远程 Web 全功能 v2 · T2 Rehearsal 执行报告

日期：2026-09-01/02 深夜 · 轨：**T2 rehearsal**（Puppeteer Edge @127.0.0.1:3180 + 源码 Electron CDP 双端）· 模型：Ayase grok-4.6。**不是 T1**（无真机相机/公网 /dshd）。

用例表：docs/qa/mobile-remote-full-web-cases.md · 逐条：results.json · 截图同目录。

## 模块汇总

| 模块 | Pass | Fail | Blocked | NA(轨) | NA(前置) | Deferred |
| --- | --- | --- | --- | --- | --- | --- |
| APPR | 1 | 0 | 7 | 0 | 0 | 0 |
| ARCH | 4 | 0 | 2 | 0 | 0 | 0 |
| CHAT | 5 | 0 | 2 | 0 | 0 | 0 |
| CLEANUP | 1 | 0 | 0 | 0 | 0 | 0 |
| CMP | 18 | 2 | 4 | 0 | 2 | 0 |
| DISC | 2 | 0 | 2 | 0 | 0 | 0 |
| FRZ | 6 | 0 | 0 | 0 | 0 | 0 |
| GIT | 15 | 0 | 6 | 0 | 0 | 0 |
| LAY | 13 | 0 | 1 | 1 | 0 | 0 |
| LIST | 9 | 1 | 1 | 0 | 1 | 0 |
| MENU | 9 | 3 | 1 | 0 | 0 | 0 |
| NEW | 8 | 1 | 1 | 0 | 3 | 0 |
| PAIR | 12 | 0 | 7 | 2 | 0 | 1 |
| SEED | 1 | 0 | 0 | 0 | 0 | 0 |
| SET | 1 | 0 | 0 | 0 | 0 | 0 |
| SRCH | 4 | 0 | 1 | 0 | 0 | 0 |

## 真缺陷（产品级）

| 缺陷 | 表现 | 状态 | 关联用例 |
| --- | --- | --- | --- |
| DEF-ORPHAN-SUB | 孤儿子智能体 SPA 顶级平铺、桌面隐藏 → D≠P | **已修**（directory.js + 单测 + orphan-fix cache-bust；LIST-001 复测 91 行全等） | LIST-001 |
| DEF-SYNC-REVERSE | 桌面新建会话/改名 60–90s 不活推到 SPA（重连才见）；手机→桌面方向全好 | 未修 | LIST-003 / NEW-002 / MENU-002 / MENU-016（Fail）；CMP-010/019、APPR-003、DISC-004（Blocked） |
| DEF-DRAFT-SWITCH | 草稿切会话回来载入为空（localStorage 有存） | 未修 | CMP-018 |
| DEF-ATTACH-TEXTMODEL | 文本模型附图发送：无拦截/无回复/无错误（桌面有发送前拒图） | 未修 | CMP-021 |
| DEF-MOVE-NOOP(候选) | 两行组内上移 20s 无效（两场复现） | 待人工复核 | MENU-007 |
| DEF-ACCESS-LABEL | SPA「完全访问」vs 桌面「完全权限」 | 文案 P1 | CMP-009 |
| DEF-SRCH-LIVE | live 更新到达时搜索视图被整表重画 | 记录 | SRCH-001 note |

## 主要 Pass

- **LIST-001 D=P 91 行全等**（父+子多重集、折叠夹与「其余 N」全展开、双端截图）
- 五轮×2：CHAT-001 旧仓（码 789）、CHAT-002 新目录（码 123，目录名对，=NEW-012 同一条故事）；CHAT-003 ACK 不串台
- GIT 15 Pass：Init、三态 label、分支列表/创建并检出、Commit、**Commit&push/Push 均落裸仓 main**、纯 behind→Pull、分叉 Sync disabled、busy 互斥、无资源管理器入口
- MENU/ARCH：重命名双端、归档/取消归档/删除（不可恢复）双端、Fork+父历史、工作区改名/unlist 磁盘保留
- CMP 18 Pass：权限三项切换再聊、斜杠列表+过滤执行、停止、queue 空态、子会话只读、附件规则外其余
- LAY 13/13（12 表面×3 视口 + 遮罩互斥）；FRZ 6/6 冻结原文与 NEVER/DEFER 源级抽检；SET 11 页
- PAIR 12 Pass（粘贴/坏链/坏 token/sticky/跨 origin/忘记/断开/重配对/刷新码）

## Blocked 清单（均有原因，不计通过）

- APPR: APPR-002、APPR-003、APPR-004、APPR-005、APPR-006、APPR-001、APPR-008
- ARCH: ARCH-003、ARCH-006
- CHAT: CHAT-005、CHAT-007
- CMP: CMP-002、CMP-010、CMP-012、CMP-019
- DISC: DISC-001、DISC-004
- GIT: GIT-014、GIT-005、GIT-006、GIT-007、GIT-013、GIT-015
- LAY: LAY-008
- LIST: LIST-011
- MENU: MENU-014
- NEW: NEW-013
- PAIR: PAIR-002b、PAIR-003、PAIR-005、PAIR-015、PAIR-017、PAIR-018、PAIR-019
- SRCH: SRCH-004

类别：造障未批（停 Harness/断中继/断隧道/关远程）；桌面反向受 DEF-SYNC-REVERSE 牵连；F-APPR ①②两档 90s 无审批弹窗（grok-4.6 直答，截图在档）；GIT-013/014 确认框与失败 toast 需人工一次点击；T1/T3 轨外。

## 判定

Fail=7 > 0 且存在未豁免 Blocked → **T2 rehearsal 不可交付**，更不得写「实机全量通过」。修复 DEF-SYNC-REVERSE / DEF-DRAFT-SWITCH / DEF-ATTACH-TEXTMODEL 并复测对应模块后，再走真机 T2 / 公网 T1。

## 遗留清理

- 测试产生的 qa 标题会话散在 Deepseek-Harness-Desktop / dshd-qa-ws-2026-08-30 工作区（NEW-002 桌面反向标记 ×2、LIST-003 反向标记、SEED/ACK/五轮等）——按需归档删除。
- 磁盘证据保留：C:\Ai\dshd-qa-ws-v2-20260901-2345（git 历史）、dshd-qa-remote-v2-*.git、dshd-qa-remote-tmp-*.git、clone*。
