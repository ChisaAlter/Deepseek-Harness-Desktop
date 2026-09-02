/**
 * Final record fixes + TMP unlist + report generation from results.json.
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import {
  launchSpa, pairInto, pairingUrl, record, runCase, sleep, waitFor,
  openDrawer, dismissOverlays, clickSheet, spaSessions, OUT, RESULTS,
} from './lib.mjs';

record('GIT-013', 'Blocked',
  '默认分支确认：bare HEAD 已切 main、seed 已备，但 SPA 的 isDefaultRef 依赖 git-fetch-status 周期，60s 内确认框未弹（推送最终未发生）。maybeConfirm(Continue/Abort) 有单测；实机一步留人工点一次');
record('GIT-014', 'Blocked',
  '坏 remote 失败 toast 未在 30s 捕获（Push 点击在 013 残留状态下未发起动作）。此前 retest-git2 中同路径 push 到坏 remote 的 git 层报错可见于终端；SPA toast 呈现留人工一次点击核');
record('DISC-001', 'Blocked',
  'Puppeteer offline 模拟不掐已建立的 SSE/隧道，6s 内无断线横幅可拍；草稿保留已证（DISC-003）。横幅需真机关 Wi-Fi 复核');
record('DISC-003', 'Pass',
  '离线点发送：无新用户气泡、草稿保留（提示文案空=横幅未触发，同 DISC-001 模拟限制）');
record('DISC-002', 'Pass', '恢复在线后列表 98 行重载、会话可继续；横幅路径同上留真机');
record('PAIR-002b', 'Blocked', '「关远程停听」将放到全场收尾手工做（停掉会断本报告所有后续用例）');
record('CMP-021', 'Fail',
  'DEF-ATTACH-TEXTMODEL：附图+文本模型发送后无新用户轮/无回复/无可见拒绝（90s）。桌面附录 vision extra 有「模型不支持图片」发送前拦截，SPA 缺该 parity。复现截图 cmp-021-attach.png');
record('CMP-018', 'Fail',
  'DEF-DRAFT-SWITCH：输入草稿→切走→切回后 #draft 为空，但 localStorage dsh-chisacode-drafts:srv_* 里草稿在（保存对、载入丢）。真缺陷，待修');
record('LAY-009', 'Pass', 'Git 胶囊 sheet 三视口（run-lay 已拍 lay-git-*；GIT 场又有 010-014 截图）');

// unlist TMP workspace (cleanup per spec).
const url = await pairingUrl();
const { browser, page } = await launchSpa();
try {
  await pairInto(page, url);
  await runCase('CLEANUP(unlist TMP)', async () => {
    const TMP_NAME = 'dshd-qa-ws-v2-20260901-2345';
    await dismissOverlays(page);
    await openDrawer(page);
    const ok = await page.evaluate((want) => {
      const head = [...document.querySelectorAll('#session-list .workspace-head')]
        .find((n) => (n.querySelector('b')?.textContent || '').includes(want));
      head?.querySelector('[aria-label="工作区操作"]')?.click();
      return Boolean(head);
    }, TMP_NAME);
    if (!ok) return { status: 'Pass', note: 'TMP 已不在列表' };
    await clickSheet(page, '从列表移除', { exact: true });
    await waitFor(page, () => (document.querySelector('.dialog')?.textContent || '').includes('移除工作区'), 'confirm', 8_000);
    await page.evaluate(() => {
      [...document.querySelectorAll('.dialog button')].find((b) => (b.textContent || '').trim() === '移除')?.click();
    });
    await sleep(2000);
    return { status: 'Pass', note: 'TMP unlist；磁盘保留（含 git 历史证据）' };
  });
} finally {
  await browser.close().catch(() => {});
}

// ---- report ----
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
lines.push(`日期：2026-09-01/02 深夜 · 轨：**T2 rehearsal**（Puppeteer Edge + 127.0.0.1:3180 + 源码 Electron CDP 双端对照）· 桌面：源码 dev 实例 · 模型：Ayase grok-4.6`);
lines.push('');
lines.push('**本报告不是 T1**（无真机相机、未走公网 /dshd）。用例表：docs/qa/mobile-remote-full-web-cases.md。逐条结果：results.json；截图同目录。');
lines.push('');
lines.push('## 模块汇总');
lines.push('');
lines.push('| 模块 | Pass | Fail | Blocked | NA(轨) | NA(前置) | Deferred |');
lines.push('| --- | --- | --- | --- | --- | --- | --- |');
for (const [m, t] of Object.entries(tally).sort()) {
  lines.push(`| ${m} | ${t.Pass || 0} | ${t.Fail || 0} | ${t.Blocked || 0} | ${t['NA-track'] || 0} | ${t['NA-pre'] || 0} | ${t.Deferred || 0} |`);
}
lines.push('');
lines.push('## 真缺陷（产品，非驱动）');
lines.push('');
lines.push('| ID | 缺陷 | 状态 |');
lines.push('| --- | --- | --- |');
lines.push('| DEF-ORPHAN-SUB | 孤儿子智能体（父已删）在 SPA 顶级平铺、桌面隐藏 → D≠P | **已修**（groupSessionRows 隐藏 + 单测 + cache-bust orphan-fix），LIST-001 复测 91 行全等 |');
lines.push('| DEF-SYNC-REVERSE | 桌面侧新建会话/重命名不活推到已配对 SPA（60–90s 不到；重连 baseline 才见）| **未修**。LIST-003 / NEW-002 / MENU-002 / MENU-016 Fail；殃及 CMP-010/019、APPR-003、DISC-004（Blocked） |');
lines.push('| DEF-DRAFT-SWITCH | 草稿切会话后载入丢失（localStorage 里在）| **未修**（CMP-018 Fail） |');
lines.push('| DEF-ATTACH-TEXTMODEL | 文本模型附图发送无拦截、无回复、无错误（桌面有发送前拒图 parity）| **未修**（CMP-021 Fail） |');
lines.push('| DEF-ACCESS-LABEL | 权限预设文案两端不一致：SPA「完全访问」vs 桌面「完全权限」| 记录（P1 文案） |');
lines.push('| DEF-SRCH-LIVE | live 刷新到达时搜索结果被整表重画 | 记录（复现两次，静态 20 行正常） |');
lines.push('');
lines.push('## 主要 Pass（证据在 results.json + png）');
lines.push('');
lines.push('- LIST-001 D=P **91 行全等**（父+子多重集，双端截图）');
lines.push('- CHAT-001 旧仓五轮（码 789）、CHAT-002 新目录五轮（码 123、目录名对）=NEW-012 同一条故事、CHAT-003 ACK 不串台');
lines.push('- GIT：Init→main、状态三态、分支列表/创建并检出（git 实仓核对）、Commit、**Commit&push / Push 推到裸仓 main**、纯 behind→Pull、分叉 Sync branch disabled、busy 互斥、溢出无「资源管理器」');
lines.push('- MENU：重命名双端全等、归档双端、Fork 双端+父历史、工作区改名/unlist（磁盘保留）');
lines.push('- ARCH：点行不打开、活菜单无删除、删除含「不可恢复」双端消失（menu2 场）');
lines.push('- CMP：权限三项切换后再聊、斜杠 6 条+过滤执行、停止、空草稿、queue 无假 dock、子会话只读+斜杠关');
lines.push('- FRZ：文件/更改/MCP/技能冻结条原文；NEVER/DEFER 源级抽检全绿；SET 11 页无红条');
lines.push('- PAIR：粘贴/坏链/坏 token/sticky/跨 origin 隔离/忘记/断开/重配对');
lines.push('');
lines.push('## Blocked（全部有原因；不计入通过）');
lines.push('');
for (const [m, t] of Object.entries(tally).sort()) {
  if (t.ids.Blocked.length) lines.push(`- ${m}: ${t.ids.Blocked.join('、')}`);
}
lines.push('');
lines.push('主要类别：造障类（停 Harness/断中继/断隧道）未获单独批准；桌面反向驱动受 DEF-SYNC-REVERSE 牵连；审批 F-APPR ①②两档 90s 无弹窗（grok-4.6 直答）；GIT-013/014 确认框与失败 toast 需人工一次点击。');
lines.push('');
lines.push('## 判定');
lines.push('');
const fails = Object.values(tally).reduce((n, t) => n + (t.Fail || 0), 0);
lines.push(`Fail=${fails} > 0 → **本轨不可交付**；且存在未豁免 Blocked。不得写「实机全量通过」。T1/T3 未测。`);
writeFileSync(path.join(OUT, 'REPORT.md'), `${lines.join('\n')}\n`);
console.log(`report written; fails=${fails}`);
console.log(JSON.stringify(Object.fromEntries(Object.entries(tally).map(([m, t]) => [m, { P: t.Pass, F: t.Fail, B: t.Blocked }])), null, 0));
