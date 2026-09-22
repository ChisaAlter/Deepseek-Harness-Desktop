import type { AgentSessionConfig } from "@chisacode/protocol/agent-types";

export function buildWorkspaceDraftAgentConfig(input: {
  provider: AgentSessionConfig["provider"];
  runtimeProvider?: AgentSessionConfig["runtimeProvider"];
  cwd: string;
  modeId?: string;
  model?: string;
  thinkingOptionId?: string;
  featureValues?: Record<string, unknown>;
  systemPrompt?: string;
}): AgentSessionConfig {
  return {
    provider: input.provider,
    ...(input.runtimeProvider && input.runtimeProvider !== input.provider
      ? { runtimeProvider: input.runtimeProvider }
      : {}),
    cwd: input.cwd,
    ...(input.modeId ? { modeId: input.modeId } : {}),
    ...(input.model ? { model: input.model } : {}),
    ...(input.thinkingOptionId ? { thinkingOptionId: input.thinkingOptionId } : {}),
    ...(input.featureValues ? { featureValues: input.featureValues } : {}),
    ...(input.systemPrompt ? { systemPrompt: input.systemPrompt } : {}),
  };
}
