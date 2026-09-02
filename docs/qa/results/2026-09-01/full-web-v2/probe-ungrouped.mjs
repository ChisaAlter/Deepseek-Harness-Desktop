import { desktop } from './lib.mjs';

const { browser, page } = await desktop();
const dump = await page.evaluate(() => {
  const hit = [...document.querySelectorAll('*')].filter((el) => el.children.length === 0
    && /会话B标记句|糖果最少取数/.test(el.textContent || '')).slice(0, 2).map((el) => {
    const chain = [];
    let cur = el;
    for (let i = 0; i < 8 && cur; i += 1) {
      chain.push(`${cur.tagName}.${String(cur.className).split(/\s+/).slice(0, 2).join('.')}`);
      cur = cur.parentElement;
    }
    return chain;
  });
  const sections = [...document.querySelectorAll('[class*="groupSection"], [class*="ungrouped"], [class*="Ungrouped"]')]
    .map((el) => ({
      cls: String(el.className).slice(0, 60),
      rows: el.querySelectorAll('[class*="sessionRow"]').length,
      head: (el.querySelector('[class*="workspaceLabel"], [class*="label"]')?.textContent || '').slice(0, 30),
    }));
  const expandButtons = [...document.querySelectorAll('button')]
    .filter((b) => /展开|收起|其余/.test(b.textContent || ''))
    .map((b) => (b.textContent || '').trim().slice(0, 30));
  const allRowCount = document.querySelectorAll('[class*="sessionRow"]').length;
  return { hit, sections, expandButtons, allRowCount };
});
console.log(JSON.stringify(dump, null, 2));
browser.disconnect();
