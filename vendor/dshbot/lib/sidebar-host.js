/**
 * Host sidebar capability probe for dshbot client registration.
 * Keep lockstep with the inline check in `client/client.js` `apply()`.
 */

/**
 * True when the host declares region-tab seats used by the desktop fork.
 * Official npm `@deepseek-ai/dsh-client-ui-sidebar` (≤0.1.1-rc.2) does not.
 * @param {{ spec?: (name: string) => unknown }} [slots]
 * @returns {boolean}
 */
export function hostDeclaresRegionTabs(slots) {
  if (!slots || typeof slots.spec !== 'function') return false
  try {
    return Boolean(slots.spec('sidebar.nav.tab') && slots.spec('sidebar.page'))
  } catch {
    return false
  }
}

/**
 * True when the host declares the footer-action list (official + desktop).
 * @param {{ spec?: (name: string) => unknown }} [slots]
 * @returns {boolean}
 */
export function hostDeclaresFooterAction(slots) {
  if (!slots || typeof slots.spec !== 'function') return false
  try {
    return Boolean(slots.spec('sidebar.footer.action'))
  } catch {
    return false
  }
}
