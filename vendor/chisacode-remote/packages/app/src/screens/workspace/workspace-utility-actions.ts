import { buildProviderCommand } from "@/utils/provider-command-templates";

interface ResumeCommandAgent {
  provider: string;
  runtimeInfo?: { sessionId: string | null };
  persistence?: { sessionId: string | null } | null;
}

export type AgentResumeCommandResolution =
  | { ok: true; command: string }
  | { ok: false; reason: "session-unavailable" | "command-unavailable" };

export function resolveAgentResumeCommand(
  agent: ResumeCommandAgent | null,
): AgentResumeCommandResolution {
  const providerSessionId = agent?.runtimeInfo?.sessionId ?? agent?.persistence?.sessionId ?? null;
  if (!agent || !providerSessionId) {
    return { ok: false, reason: "session-unavailable" };
  }
  const command = buildProviderCommand({
    provider: agent.provider,
    id: "resume",
    sessionId: providerSessionId,
  });
  return command ? { ok: true, command } : { ok: false, reason: "command-unavailable" };
}
