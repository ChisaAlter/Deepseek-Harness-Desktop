import { desktop } from './lib.mjs';

const { browser, page } = await desktop();
const dump = await page.evaluate(() => {
  const heads = [...document.querySelectorAll('[aria-expanded]')].filter((n) => /已归档/.test((n.textContent || '').trim().slice(0, 12)));
  const out = heads.map((h) => {
    const chain = [];
    let cur = h;
    for (let i = 0; i < 6 && cur; i += 1) { chain.push(`${cur.tagName}.${String(cur.className).split(/\s+/).slice(0, 2).join('.')}`); cur = cur.parentElement; }
    const next = h.nextElementSibling;
    return {
      expanded: h.getAttribute('aria-expanded'),
      chain,
      nextSibling: next ? `${next.tagName}.${String(next.className).slice(0, 40)} rows=${next.querySelectorAll('[class*="sessionRow"]').length}` : null,
      parentRows: h.parentElement ? h.parentElement.querySelectorAll('[class*="sessionRow"]').length : -1,
    };
  });
  const hit = [...document.querySelectorAll('[class*="sessionRow"]')].find((r) => /描述这张图的颜色形状/.test(r.textContent || ''));
  const hitChain = [];
  let cur = hit;
  for (let i = 0; i < 8 && cur; i += 1) { hitChain.push(`${cur.tagName}.${String(cur.className).split(/\s+/).slice(0, 2).join('.')}`); cur = cur.parentElement; }
  return { heads: out, hitChain };
});
console.log(JSON.stringify(dump, null, 2));
browser.disconnect();
