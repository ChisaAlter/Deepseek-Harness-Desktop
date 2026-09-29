'use strict';

/** Runs inside the real welcome renderer before smoke is allowed to dismiss it. */
function assertWelcomePresentation() {
  if (document.readyState !== 'complete' || !document.querySelector('.welcome')) return false;
  const failures = [];
  const root = document.getElementById('root');
  const page = document.querySelector('.welcome');
  const bounds = root.getBoundingClientRect();
  if (getComputedStyle(root).display !== 'flex' || getComputedStyle(page).display !== 'grid'
      || Math.abs(bounds.width - innerWidth) > 2 || Math.abs(bounds.height - innerHeight) > 2) {
    failures.push('page layout does not fill the welcome window');
  }
  if ([...document.querySelectorAll('link[rel="stylesheet"]')].some(link => !link.sheet)) {
    failures.push('stylesheet failed to load');
  }
  const brand = document.querySelector('img.brand');
  if (!brand || !brand.complete || brand.naturalWidth === 0) failures.push('brand image failed to load');
  for (const id of ['api-key', 'skip-key']) {
    const control = document.getElementById(id);
    if (!control || control.closest('[hidden]')) continue;
    const rect = control.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const hit = document.elementFromPoint(x, y);
    if (rect.width <= 0 || rect.height <= 0 || x < 0 || x >= innerWidth || y < 0 || y >= innerHeight
        || !hit || !control.contains(hit)) failures.push(`${id} is not reachable`);
  }
  if (failures.length) throw new Error(`Welcome presentation invalid: ${failures.join('; ')}`);
  return true;
}

module.exports = { assertWelcomePresentation };
