/**
 * Slash command discovery for the composer: `/` on the first token opens a
 * popup fed by the daemon's per-agent listCommands. Pure text helpers here;
 * app.js owns the DOM.
 */

const SLASH_TOKEN = /^\/([^\s/][^\s]*)?$/;

/**
 * Return the command query when the composer text is a lone leading slash
 * token (`/`, `/co`, `/commit`), otherwise null. Anything after whitespace
 * or a newline is a message, not a command lookup.
 * @param {string} text
 * @returns {string | null}
 */
function slashQuery(text) {
  if (typeof text !== 'string') return null;
  const match = SLASH_TOKEN.exec(text);
  if (!match) return null;
  return match[1] || '';
}

/**
 * Filter commands for a query: prefix matches first, then substring matches
 * on name or description. Case-insensitive.
 */
function filterSlashCommands(commands, query) {
  const list = Array.isArray(commands) ? commands : [];
  const needle = String(query || '').toLowerCase();
  if (!needle) return list;
  const prefixed = [];
  const contained = [];
  for (const command of list) {
    const name = command.name.toLowerCase();
    if (name.startsWith(needle)) {
      prefixed.push(command);
    } else if (name.includes(needle) || command.description.toLowerCase().includes(needle)) {
      contained.push(command);
    }
  }
  return [...prefixed, ...contained];
}

/**
 * Composer text after picking a command. The popup only opens while the
 * whole text is a single leading slash token, so a pick replaces that token
 * with `/name ` ready for arguments.
 */
function applySlashCommand(name) {
  return `/${name} `;
}

/**
 * Fetch the agent's slash commands from the daemon. A payload error is a
 * visible failure; entries are normalized to plain view rows.
 * @param {object} client DaemonClient
 * @param {string} agentId
 * @returns {Promise<Array<{ name: string, description: string, argumentHint: string }>>}
 */
async function listAgentCommands(client, agentId) {
  if (typeof agentId !== 'string' || !agentId) {
    throw new Error('缺少会话 ID');
  }
  const payload = await client.listCommands(agentId);
  if (typeof payload?.error === 'string' && payload.error) {
    throw new Error(payload.error);
  }
  const commands = Array.isArray(payload?.commands) ? payload.commands : [];
  return commands.flatMap((command) => {
    if (typeof command?.name !== 'string' || !command.name) return [];
    return [{
      name: command.name,
      description: typeof command.description === 'string' ? command.description : '',
      argumentHint: typeof command.argumentHint === 'string' ? command.argumentHint : '',
    }];
  });
}

export {
  applySlashCommand,
  filterSlashCommands,
  listAgentCommands,
  slashQuery,
};
