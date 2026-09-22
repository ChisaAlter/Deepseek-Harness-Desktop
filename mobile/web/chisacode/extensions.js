/**
 * ChisaCode MCP / Skills read-only inventory adapters over
 * `listAgentMcpServers` / `listAgentSkills`. This phase is strictly
 * read-only: no policy patch, upsert, install, uninstall, or delete RPC is
 * called here, and management stays on the desktop.
 */

const STATUS_LABELS = {
  enabled: '已启用',
  'global-disabled': '已全局停用',
  'provider-enabled': '按提供方启用',
  'provider-disabled': '按提供方停用',
  'agent-enabled': '按会话启用',
  'agent-disabled': '按会话停用',
};

const SKILL_SOURCE_LABELS = {
  project: '项目',
  'agents-home': 'AGENTS 主目录',
  'codex-home': 'Codex 主目录',
  'claude-home': 'Claude 主目录',
  bundled: '内置',
  unknown: '未知来源',
};

/** Chinese label for a statusByScope value; unknown values stay verbatim. */
function extensionStatusLabel(status) {
  return STATUS_LABELS[status] || String(status || '');
}

/** Chinese label for a skill source type. */
function skillSourceLabel(type) {
  return SKILL_SOURCE_LABELS[type] || SKILL_SOURCE_LABELS.unknown;
}

function countOverrides(statusByScope) {
  const providers = Object.keys(statusByScope?.providers || {}).length;
  const agents = Object.keys(statusByScope?.agents || {}).length;
  return { providers, agents };
}

function stringErrors(list) {
  return (Array.isArray(list) ? list : []).filter((item) => typeof item === 'string' && item);
}

/**
 * Read-only MCP server inventory. `enabled` reflects the global scope;
 * provider / agent overrides are surfaced as counts so the phone never
 * pretends to know per-scope effective state it does not display.
 * @param {object} client DaemonClient
 * @returns {Promise<{ rows: Array<object>, errors: Array<string> }>}
 */
async function listMobileMcpServers(client) {
  const payload = await client.listAgentMcpServers();
  const servers = Array.isArray(payload?.servers) ? payload.servers : [];
  const rows = servers.flatMap((server) => {
    if (typeof server?.name !== 'string' || !server.name) return [];
    const globalStatus = server?.statusByScope?.global || '';
    return [{
      name: server.name,
      label: typeof server.label === 'string' && server.label ? server.label : server.name,
      description: typeof server.description === 'string' ? server.description : '',
      transport: typeof server?.config?.type === 'string' ? server.config.type : '',
      source: server?.source === 'system' ? 'system' : 'user',
      status: globalStatus,
      statusLabel: extensionStatusLabel(globalStatus),
      enabled: globalStatus === 'enabled',
      overrides: countOverrides(server?.statusByScope),
      errors: stringErrors(server?.errors),
    }];
  });
  return { rows, errors: stringErrors(payload?.errors) };
}

/**
 * Read-only skills inventory with per-skill sources (scope of origin).
 * @param {object} client DaemonClient
 * @returns {Promise<{ rows: Array<object>, errors: Array<string> }>}
 */
async function listMobileSkills(client) {
  const payload = await client.listAgentSkills();
  const skills = Array.isArray(payload?.skills) ? payload.skills : [];
  const rows = skills.flatMap((skill) => {
    if (typeof skill?.name !== 'string' || !skill.name) return [];
    const globalStatus = skill?.statusByScope?.global || '';
    return [{
      name: skill.name,
      description: typeof skill.description === 'string' ? skill.description : '',
      status: globalStatus,
      statusLabel: extensionStatusLabel(globalStatus),
      enabled: globalStatus === 'enabled',
      sources: (Array.isArray(skill.sources) ? skill.sources : []).flatMap((source) => {
        if (!source || typeof source.path !== 'string') return [];
        return [{
          type: typeof source.type === 'string' ? source.type : 'unknown',
          typeLabel: skillSourceLabel(source.type),
          path: source.path,
        }];
      }),
      overrides: countOverrides(skill?.statusByScope),
      errors: stringErrors(skill?.errors),
    }];
  });
  return { rows, errors: stringErrors(payload?.errors) };
}

export {
  extensionStatusLabel,
  listMobileMcpServers,
  listMobileSkills,
  skillSourceLabel,
};
