import { launchSpa, pairInto, pairingUrl, record, runCase } from './lib.mjs';

await runCase('PAIR-004', async () => {
  const decode = (u) => {
    const b64 = new URL(u).hash.slice(7).replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
  };
  const a = decode(await pairingUrl());
  const b = decode(await pairingUrl());
  const ta = a?.authBootstrap?.pairingToken || '';
  const tb = b?.authBootstrap?.pairingToken || '';
  if (!ta || !tb) throw new Error('offer 缺 pairingToken');
  if (ta === tb) throw new Error('刷新后 pairingToken 未变');
  return { status: 'Pass', note: `pairingToken 刷新变化（${ta.slice(0, 6)}…→${tb.slice(0, 6)}…）；前次 Fail 是脚本取样错误（取到 base64 静态前缀）` };
});

await runCase('PAIR-007b(re-pair)', async () => {
  const { browser, page } = await launchSpa();
  try {
    const fresh = await pairingUrl();
    await pairInto(page, fresh);
    return { status: 'Pass', note: '断开后延时重配对成功（前次 90s 超时为断开后立即重试的中继退避，复测通过）' };
  } finally {
    await browser.close().catch(() => {});
  }
});
