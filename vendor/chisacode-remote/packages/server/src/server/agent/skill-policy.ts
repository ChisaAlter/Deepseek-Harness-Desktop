import type { MutableDaemonConfig } from "@chisacode/protocol/messages";
import type { AgentSkillEffectivePolicy } from "./agent-sdk-types.js";

function uniqueSorted(values: readonly string[] | undefined): string[] {
  return [...new Set(values ?? [])].filter((value) => value.length > 0).sort();
}

export function resolveAgentSkillPolicy(
  config: MutableDaemonConfig,
  agentId: string,
  provider?: string | null,
): AgentSkillEffectivePolicy {
  const providerPolicy = provider ? config.skills.providers[provider] : undefined;
  const agentPolicy = config.skills.agents[agentId];
  return {
    globalDisabledSkillNames: uniqueSorted(config.skills.global.disabledSkillNames),
    providerEnabledSkillNames: uniqueSorted(providerPolicy?.enabledSkillNames),
    providerDisabledSkillNames: uniqueSorted(providerPolicy?.disabledSkillNames),
    agentEnabledSkillNames: uniqueSorted(agentPolicy?.enabledSkillNames),
    agentDisabledSkillNames: uniqueSorted(agentPolicy?.disabledSkillNames),
  };
}

export function isSkillEnabledByPolicy(
  skillName: string,
  policy: AgentSkillEffectivePolicy,
): boolean {
  if (policy.agentDisabledSkillNames?.includes(skillName)) return false;
  if (policy.agentEnabledSkillNames?.includes(skillName)) return true;
  if (policy.providerDisabledSkillNames?.includes(skillName)) return false;
  if (policy.providerEnabledSkillNames?.includes(skillName)) return true;
  return !policy.globalDisabledSkillNames?.includes(skillName);
}
