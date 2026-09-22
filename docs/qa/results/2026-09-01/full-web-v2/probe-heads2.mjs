import { desktop, desktopSessions, sleep } from './lib.mjs';

const { browser, page } = await desktop();
await desktopSessions(page);
const dump = await page.evaluate(() => {
  // What does a workspace/folder head look like now?
  const folders = [...document.querySelectorAll('[class*="folder" i]')].slice(0, 12).map((el) => ({
    cls: String(el.className).slice(0, 50),
    text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40),
    tag: el.tagName,
  }));
  const wsLabels = [...document.querySelectorAll('[class*="workspace" i]')].slice(0, 12).map((el) => ({
    cls: String(el.className).slice(0, 50),
    text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40),
  }));
  // Archived section rows and their action buttons.
  const archived = [...document.querySelectorAll('[aria-expanded]')]
    .filter((n) => /已归档/.test(n.textContent || ''))
    .map((n) => ({ expanded: n.getAttribute('aria-expanded'), text: (n.textContent || '').slice(0, 30) }));
  const actionButtons = [...document.querySelectorAll('button')]
    .map((b) => b.getAttribute('aria-label') || '')
    .filter((a) => /的操作|归档|archive/i.test(a))
    .slice(0, 15);
  return { folders, wsLabels, archived, actionButtons };
});
console.log(JSON.stringify(dump, null, 2));
browser.disconnect();
