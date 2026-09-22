/**
 * Server-owned Bot identity rules.
 *
 * `name` is the stable address. `title` is display-only and never participates
 * in routing, uniqueness checks, or mention parsing.
 */

export const MAX_BOT_TITLE = 120;

/**
 * @param {object | undefined} bot
 * @returns {string}
 */
export function stableBotName(bot) {
  return String(bot?.name ?? '').trim();
}

/**
 * Rooms do not have an independent title in the server contract.
 * @param {object | undefined} bot
 * @returns {string}
 */
export function botDisplayName(bot, fallback = 'Bot') {
  const name = stableBotName(bot);
  if (bot?.kind !== 'room') {
    const title = String(bot?.title ?? '').trim();
    if (title) return title;
  }
  return name || fallback;
}

/**
 * @param {readonly object[]} items
 * @param {string | undefined} id
 * @param {string} [fallback]
 * @returns {string}
 */
export function displayNameForBotId(items, id, fallback = 'Bot') {
  const target = (Array.isArray(items) ? items : []).find((entry) => entry?.id === id);
  return botDisplayName(target, String(id ?? '').trim() || fallback);
}

/**
 * Keep the stable address visible whenever a custom title could otherwise be
 * mistaken for the routing name.
 * @param {object | undefined} bot
 * @returns {string}
 */
export function directoryBotLabel(bot) {
  const display = botDisplayName(bot, String(bot?.id ?? '').trim() || 'Bot');
  const name = stableBotName(bot);
  const id = String(bot?.id ?? '').trim();
  if (display !== name && name) return `${display} (name: ${name}; id: ${id || name})`;
  return `${display} (id: ${id || name})`;
}
