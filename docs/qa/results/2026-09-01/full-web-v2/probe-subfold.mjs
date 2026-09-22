import { desktop, desktopSessions } from './lib.mjs';

const { browser, page } = await desktop();
await desktopSessions(page); // ensure folders + 其余 expanded
const dump = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('[class*="sessionRow"]')];
  const withButtons = rows.map((r) => ({
    title: (r.querySelector('[class*="title"]')?.textContent || '').trim().slice(0, 24),
    btns: [...r.querySelectorAll('button, [role="button"]')].map((b) => ({
      aria: (b.getAttribute('aria-label') || '').slice(0, 30),
      text: (b.textContent || '').trim().slice(0, 12),
      expanded: b.getAttribute('aria-expanded'),
    })),
  })).filter((r) => r.btns.length);
  const toggles = [...document.querySelectorAll('[aria-expanded]')].map((el) => ({
    tag: el.tagName,
    aria: (el.getAttribute('aria-label') || '').slice(0, 40),
    expanded: el.getAttribute('aria-expanded'),
    text: (el.textContent || '').trim().slice(0, 24),
  })).filter((t) => t.expanded === 'false').slice(0, 20);
  return { withButtons: withButtons.slice(0, 10), collapsedToggles: toggles };
});
console.log(JSON.stringify(dump, null, 2));
browser.disconnect();
