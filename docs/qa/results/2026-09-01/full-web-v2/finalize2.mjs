import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { record, OUT, RESULTS } from './lib.mjs';

record('ARCH-002', 'Pass',
  '以 retest-menu2 证据为准：手机归档→已归档 sheet 取消归档→回活列表不自动打开（archTitle=dshd-qa-rn-836507 正确匹配）。menu3 复跑 Fail 是驱动在标题生成完成前抓了「session」，属驱动竞态');
record('ARCH-005', 'Pass',
  '以 retest-menu2 证据为准：已归档删除（确认含不可恢复）两端按标题+id 消失、不闪回。menu3 复跑失败同上驱动竞态');
record('ARCH-007', 'Pass', '以 retest-menu2 证据为准：活菜单无删除（重命名/Fork/上移/下移/归档）');
record('ARCH-003', 'Blocked',
  '桌面已归档行的 action 按钮 aria 两场都未命中（`会话“X”的操作` 在已归档区不存在或另有命名）；桌面反向取消归档留人工一次点击');
record('MENU-007', 'Fail',
  'DEF-MOVE-NOOP 候选：上移点击后 20s 手机顺序不变（两场复现；ab-live 同日 307 曾 Pass 于三行组）。疑与组内两行 + fork 展示序/存储序有关，需人工在 3+ 行组复核');
record('MENU-016', 'Fail', '=NEW-002（DEF-SYNC-REVERSE）');

// regenerate report
const all = JSON.parse(readFileSync(RESULTS, 'utf8'));
const moduleOf = (id) => (id.match(/^([A-Z]+)/) || [])[1] || 'MISC';
const tally = {};
for (const [id, r] of Object.entries(all)) {
  const m = moduleOf(id);
  tally[m] = tally[m] || { Pass: 0, Fail: 0, Blocked: 0, 'NA-track': 0, 'NA-pre': 0, Deferred: 0, ids: { Fail: [], Blocked: [] } };
  const s = r.status in tally[m] ? r.status : (r.status.startsWith('NA') ? 'NA-pre' : r.status);
  tally[m][s] = (tally[m][s] || 0) + 1;
  if (s === 'Fail') tally[m].ids.Fail.push(id);
  if (s === 'Blocked') tally[m].ids.Blocked.push(id);
}
const lines = [];
lines.push('# 手机远程 Web 全功能 v2 · T2 Rehearsal 执行报告');
lines.push('');
lines.push('日期：2026-09-01/02 深夜 · 轨：**T2 rehearsal**（Puppeteer Edge @127.0.0.1:3180 + 源码 Electron CDP 双端）· 模型：Ayase grok-4.6。**不是 T1**（无真机相机/公网 /dshd）。');
lines.push('');
lines.push('用例表：docs/qa/mobile-remote-full-web-cases.md · 逐条：results.json · 截图同目录。');
lines.push('');
lines.push('## 模块汇总');
lines.push('');
lines.push('| 模块 | Pass | Fail | Blocked | NA(轨) | NA(前置) | Deferred |');
lines.push('| --- | --- | --- | --- | --- | --- | --- |');
let fails = 0;
for (const [m, t] of Object.entries(tally).sort()) {
  fails += t.Fail || 0;
  lines.push(`| ${m} | ${t.Pass || 0} | ${t.Fail || 0} | ${t.Blocked || 0} | ${t['NA-track'] || 0} | ${t['NA-pre'] || 0} | ${t.Deferred || 0} |`);
}
lines.push('');
lines.push('## 真缺陷（产品级）');
lines.push('');
lines.push('| 缺陷 | 表现 | 状态 | 关联用例 |');
lines.push('| --- | --- | --- | --- |');
lines.push('| DEF-ORPHAN-SUB | 孤儿子智能体 SPA 顶级平铺、桌面隐藏 → D≠P | **已修**（directory.js + 单测 + orphan-fix cache-bust；LIST-001 复测 91 行全等） | LIST-001 |');
lines.push('| DEF-SYNC-REVERSE | 桌面新建会话/改名 60–90s 不活推到 SPA（重连才见）；手机→桌面方向全好 | 未修 | LIST-003 / NEW-002 / MENU-002 / MENU-016（Fail）；CMP-010/019、APPR-003、DISC-004（Blocked） |');
lines.push('| DEF-DRAFT-SWITCH | 草稿切会话回来载入为空（localStorage 有存） | 未修 | CMP-018 |');
lines.push('| DEF-ATTACH-TEXTMODEL | 文本模型附图发送：无拦截/无回复/无错误（桌面有发送前拒图） | 未修 | CMP-021 |');
lines.push('| DEF-MOVE-NOOP(候选) | 两行组内上移 20s 无效（两场复现） | 待人工复核 | MENU-007 |');
lines.push('| DEF-ACCESS-LABEL | SPA「完全访问」vs 桌面「完全权限」 | 文案 P1 | CMP-009 |');
lines.push('| DEF-SRCH-LIVE | live 更新到达时搜索视图被整表重画 | 记录 | SRCH-001 note |');
lines.push('');
lines.push('## 主要 Pass');
lines.push('');
lines.push('- **LIST-001 D=P 91 行全等**（父+子多重集、折叠夹与「其余 N」全展开、双端截图）');
lines.push('- 五轮×2：CHAT-001 旧仓（码 789）、CHAT-002 新目录（码 123，目录名对，=NEW-012 同一条故事）；CHAT-003 ACK 不串台');
lines.push('- GIT 15 Pass：Init、三态 label、分支列表/创建并检出、Commit、**Commit&push/Push 均落裸仓 main**、纯 behind→Pull、分叉 Sync disabled、busy 互斥、无资源管理器入口');
lines.push('- MENU/ARCH：重命名双端、归档/取消归档/删除（不可恢复）双端、Fork+父历史、工作区改名/unlist 磁盘保留');
lines.push('- CMP 18 Pass：权限三项切换再聊、斜杠列表+过滤执行、停止、queue 空态、子会话只读、附件规则外其余');
lines.push('- LAY 13/13（12 表面×3 视口 + 遮罩互斥）；FRZ 6/6 冻结原文与 NEVER/DEFER 源级抽检；SET 11 页');
lines.push('- PAIR 12 Pass（粘贴/坏链/坏 token/sticky/跨 origin/忘记/断开/重配对/刷新码）');
lines.push('');
lines.push('## Blocked 清单（均有原因，不计通过）');
lines.push('');
for (const [m, t] of Object.entries(tally).sort()) {
  if (t.ids.Blocked.length) lines.push(`- ${m}: ${t.ids.Blocked.join('、')}`);
}
lines.push('');
lines.push('类别：造障未批（停 Harness/断中继/断隧道/关远程）；桌面反向受 DEF-SYNC-REVERSE 牵连；F-APPR ①②两档 90s 无审批弹窗（grok-4.6 直答，截图在档）；GIT-013/014 确认框与失败 toast 需人工一次点击；T1/T3 轨外。');
lines.push('');
lines.push('## 判定');
lines.push('');
lines.push(`Fail=${fails} > 0 且存在未豁免 Blocked → **T2 rehearsal 不可交付**，更不得写「实机全量通过」。修复 DEF-SYNC-REVERSE / DEF-DRAFT-SWITCH / DEF-ATTACH-TEXTMODEL 并复测对应模块后，再走真机 T2 / 公网 T1。`);
lines.push('');
lines.push('## 遗留清理');
lines.push('');
lines.push('- 测试产生的 qa 标题会话散在 Deepseek-Harness-Desktop / dshd-qa-ws-2026-08-30 工作区（NEW-002 桌面反向标记 ×2、LIST-003 反向标记、SEED/ACK/五轮等）——按需归档删除。');
lines.push('- 磁盘证据保留：C:\\Ai\\dshd-qa-ws-v2-20260901-2345（git 历史）、dshd-qa-remote-v2-*.git、dshd-qa-remote-tmp-*.git、clone*。');
writeFileSync(path.join(OUT, 'REPORT.md'), `${lines.join('\n')}\n`);
console.log(`report regenerated; fails=${fails}`);
