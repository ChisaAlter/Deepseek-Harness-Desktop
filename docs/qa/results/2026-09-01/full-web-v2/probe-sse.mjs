/**
 * Read the desktop harness cookie via CDP and tail /api/events.mux and
 * /api/remote.mux directly for ~20s while the desktop creates a session.
 * Cookie value is never printed.
 */
import { desktop, sleep, desktopType, desktopSend, desktopEnsureGrok } from './lib.mjs';

const { browser, page } = await desktop();
const cdp = await page.createCDPSession();
const { cookies } = await cdp.send('Network.getCookies', { urls: ['http://127.0.0.1:3080/'] });
await cdp.detach();
const cookie = cookies.map((c) => `${c.name}=${c.value}`).join('; ');
console.log('cookie names:', cookies.map((c) => c.name).join(','));

async function tail(path, ms) {
  const ac = new AbortController();
  const out = { path, status: 0, types: {}, bytes: 0, err: '' };
  const timer = setTimeout(() => ac.abort(), ms);
  try {
    const res = await fetch(`http://127.0.0.1:3080${path}`, {
      headers: { accept: 'text/event-stream', cookie, host: '127.0.0.1:3080' },
      signal: ac.signal,
    });
    out.status = res.status;
    if (!res.ok || !res.body) return out;
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      out.bytes += value.length;
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
        const line = chunk.split('\n').find((l) => l.startsWith('data: '));
        if (!line) continue;
        try {
          const env = JSON.parse(line.slice(6));
          const p = env?.payload && typeof env.payload === 'object' ? env.payload : env;
          const k = `${p?.type || env?.type || '?'}${p?.event?.type ? ':' + p.event.type : ''}${p?.key ? ':' + p.key : ''}`;
          out.types[k] = (out.types[k] || 0) + 1;
        } catch { out.types['<unparsed>'] = (out.types['<unparsed>'] || 0) + 1; }
      }
    }
  } catch (e) { out.err = String(e.message || e).slice(0, 80); }
  clearTimeout(timer);
  return out;
}

const tails = Promise.all([tail('/api/events.mux', 22_000), tail('/api/remote.mux', 22_000)]);
await sleep(2500);
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') || '') === '新建会话');
  btn?.click();
});
await sleep(1500);
await desktopEnsureGrok(page);
await desktopType(page, '请只回复一行：SSEPROBE');
await desktopSend(page);
const results = await tails;
console.log(JSON.stringify(results, null, 2));
browser.disconnect();
