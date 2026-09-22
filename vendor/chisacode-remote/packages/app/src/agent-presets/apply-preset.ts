import type { AgentPreset } from "@chisacode/protocol/agent-presets";

export interface AgentPresetDraft {
  provider?: string | null;
  modeId?: string | null;
  model?: string | null;
  systemPrompt?: string;
  samplePrompt?: string;
}

export type AgentPresetUnappliedField = "provider" | "mode" | "model" | "skillIds" | "mcpServerIds";

export interface AgentPresetAvailability {
  providerIds?: ReadonlySet<string>;
  modeIds?: ReadonlySet<string>;
  modelIds?: ReadonlySet<string>;
}

export interface AgentPresetApplication {
  draft: AgentPresetDraft;
  unappliedFields: AgentPresetUnappliedField[];
}

function isUnavailable(value: string, availableValues?: ReadonlySet<string>): boolean {
  return availableValues ? !availableValues.has(value) : false;
}

function resolvePresetSelection(input: {
  current: string | null;
  requested?: string;
  availableValues?: ReadonlySet<string>;
  blocked: boolean;
}): { value: string | null; unapplied: boolean } {
  if (!input.requested || input.blocked) {
    return { value: input.current, unapplied: false };
  }
  if (isUnavailable(input.requested, input.availableValues)) {
    return { value: input.current, unapplied: true };
  }
  return { value: input.requested, unapplied: false };
}

function collectReferenceWarnings(preset: AgentPreset): AgentPresetUnappliedField[] {
  const warnings: AgentPresetUnappliedField[] = [];
  if (preset.skillIds?.length) {
    warnings.push("skillIds");
  }
  if (preset.mcpServerIds?.length) {
    warnings.push("mcpServerIds");
  }
  return warnings;
}

export function resolveAgentPresetApplication(input: {
  draft: AgentPresetDraft;
  preset: AgentPreset;
  availability?: AgentPresetAvailability;
}): AgentPresetApplication {
  const { draft, preset, availability } = input;
  const requestedProvider = preset.provider === "default" ? draft.provider : preset.provider;
  const providerUnavailable =
    preset.provider !== "default" && isUnavailable(preset.provider, availability?.providerIds);
  const providerChanged = Boolean(
    !providerUnavailable && requestedProvider && requestedProvider !== draft.provider,
  );
  const mode = resolvePresetSelection({
    current: providerChanged ? null : (draft.modeId ?? null),
    requested: preset.modeId,
    availableValues: availability?.modeIds,
    blocked: providerUnavailable,
  });
  const model = resolvePresetSelection({
    current: providerChanged ? null : (draft.model ?? null),
    requested: preset.model,
    availableValues: availability?.modelIds,
    blocked: providerUnavailable,
  });
  const unappliedFields = collectReferenceWarnings(preset);
  if (providerUnavailable) unappliedFields.unshift("provider");
  if (mode.unapplied) unappliedFields.push("mode");
  if (model.unapplied) unappliedFields.push("model");

  return {
    draft: {
      ...draft,
      provider: providerUnavailable ? draft.provider : requestedProvider,
      modeId: mode.value,
      model: model.value,
      systemPrompt: preset.systemPrompt,
      samplePrompt: draft.samplePrompt?.trim()
        ? draft.samplePrompt
        : (preset.samplePrompts?.[0] ?? draft.samplePrompt),
    },
    unappliedFields,
  };
}

export function applyAgentPresetToDraft(
  draft: AgentPresetDraft,
  preset: AgentPreset,
): AgentPresetDraft {
  return resolveAgentPresetApplication({ draft, preset }).draft;
}
