/**
 * Probe the running desktop dsh web DOM over CDP 9229 (read-only).
 * Finds sidebar session rows, workspace heads, model/access aria, git titlebar.
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const puppeteer = require('puppeteer-core');

const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9229', defaultViewport: null });
const pages = await browser.pages();
const page = pages.find((p) => p.url().includes('127.0.0.1:3080'));
if (!page) throw new Error(`no 3080 page: ${pages.map((p) => p.url()).join(' | ')}`);

const probe = await page.evaluate(() => {
  const out = {};
  const attrs = new Set();
  for (const el of document.querySelectorAll('*')) {
    for (const a of el.attributes) {
      if (a.name.startsWith('data-') && attrs.size < 400) attrs.add(a.name);
    }
  }
  out.dataAttrs = [...attrs].sort();
  const grab = (sel, n = 6) => [...document.querySelectorAll(sel)].slice(0, n).map((el) => ({
    tag: el.tagName,
    cls: String(el.className).slice(0, 80),
    aria: el.getAttribute('aria-label') || '',
    text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60),
  }));
  out.sessionish = grab('[data-session-id], [data-sessionid], [data-agent-id]');
  out.workspaceish = grab('[data-workspace-id], [data-workspace]');
  out.sidebarButtons = [...document.querySelectorAll('button')]
    .filter((el) => /新会话|new session|展开|已归档|archived/i.test((el.getAttribute('aria-label') || '') + (el.textContent || '')))
    .slice(0, 12)
    .map((el) => ({ aria: el.getAttribute('aria-label') || '', text: (el.textContent || '').replace(/\s+/g, ' ').slice(0, 50) }));
  const model = [...document.querySelectorAll('button')].find((el) => /选择模型|select model/i.test(el.getAttribute('aria-label') || ''));
  out.modelAria = model ? model.getAttribute('aria-label') : null;
  const access = [...document.querySelectorAll('button')].find((el) => /访问模式|access mode/i.test(el.getAttribute('aria-label') || ''));
  out.accessAria = access ? access.getAttribute('aria-label') : null;
  out.gitButtons = [...document.querySelectorAll('button')]
    .filter((el) => /branch|git|commit|push|pull|publish|分支/i.test((el.getAttribute('aria-label') || '') + (el.textContent || '')))
    .slice(0, 14)
    .map((el) => ({ aria: (el.getAttribute('aria-label') || '').slice(0, 90), text: (el.textContent || '').replace(/\s+/g, ' ').slice(0, 50) }));
  return out;
});
console.log(JSON.stringify(probe, null, 2));
browser.disconnect();
