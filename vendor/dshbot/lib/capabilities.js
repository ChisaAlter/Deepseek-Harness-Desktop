import { scopeChainOf } from '@deepseek-ai/dsh-scope';
import {
  GROUP_MEMBER_DENIED_TOOLS,
  groupMemberProfileForSession,
  isGroupMemberSession,
} from './group-member-runtime.js';

const selected = (policy, name) => policy?.mode !== 'selected' || policy.names.includes(name);
const isMcp = (name) => name.startsWith('mcp__');

export function capabilityDenial(item, name, args) {
  const policy = item?.capabilities;
  if (!policy) return;
  if (!selected(isMcp(name) ? policy.mcp : policy.tools, name)) return `Bot capability denied: ${name}`;
  if (name === 'skill' && !selected(policy.skills, args?.name)) return `Bot skill denied: ${String(args?.name ?? '')}`;
}

function sessionIdOf(agent) {
  return agent?.session?.id ?? agent?.id;
}

function itemForAgent(items, agent) {
  const sessionId = sessionIdOf(agent);
  const direct = items.find((item) => item.kind !== 'room' && item.sessionId === sessionId);
  if (direct) return direct;
  const profile = groupMemberProfileForSession(sessionId);
  return profile
    ? items.find((item) => item.kind !== 'room' && item.id === profile.botId)
    : undefined;
}

/** Runtime tool grants intersect across Bot ancestors, including nested PTC calls. */
export function registerCapabilities(ctx, scope) {
  const owners = (agent) => {
    const items = scope.get().items;
    return scopeChainOf(agent)
      .map((owner) => itemForAgent(items, owner))
      .filter(Boolean);
  };
  if (typeof ctx.tools.guard !== 'function') throw new Error('dshbot requires Harness tools.guard for capability enforcement');
  ctx.tools.guard((execution) => {
    if (isGroupMemberSession(sessionIdOf(execution.agent))
      && GROUP_MEMBER_DENIED_TOOLS.includes(execution.name)) {
      return `Bot group members cannot use ${execution.name} during a room turn`;
    }
    for (const owner of owners(execution.agent)) {
      const denial = capabilityDenial(owner, execution.name, execution.arguments);
      if (denial) return denial;
    }
  });
  ctx.systemPrompt.section({
    name: 'dshbot:capabilities', order: 23,
    text: ({ agent }) => owners(agent).flatMap((owner) => ['tools', 'skills', 'mcp'].flatMap((group) => {
      const policy = owner.capabilities?.[group];
      return policy?.mode === 'selected' ? [`Allowed ${group} for ${owner.name}: ${policy.names.join(', ') || '(none)'}. Calls outside this selection are denied by the runtime.`] : [];
    })).join('\n'),
  });
  return async (botId) => {
    const item = scope.get().items.find((entry) => entry.id === botId);
    const agent = item ? ctx.agents.get(item.sessionId) : undefined;
    const tools = ctx.tools.schemas(agent).map(({ name, description }) => ({ name, description }));
    const skillService = ctx.get?.('skills');
    const skills = skillService ? await skillService.list({ scope: agent, cwd: item?.workspaceId || undefined }) : [];
    return { tools: tools.filter((tool) => !isMcp(tool.name)), mcp: tools.filter((tool) => isMcp(tool.name)),
      skills: skills.filter((skill) => skill.modelInvocable !== false).map(({ name, description }) => ({ name, description })),
      skillsAvailable: Boolean(skillService), active: true };
  };
}
