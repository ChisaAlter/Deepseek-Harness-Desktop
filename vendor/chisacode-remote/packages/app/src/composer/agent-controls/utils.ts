import type { AgentFeature, AgentModelDefinition } from "@chisacode/protocol/agent-types";

export type ExplainedAgentControl = "mode" | "model" | "thinking";
export type FeatureHighlightColor = "blue" | "default" | "green" | "yellow";

export function getAgentControlHint(selector: ExplainedAgentControl): string {
  switch (selector) {
    case "thinking":
      return "推理强度";
    case "model":
      return "切换模型";
    case "mode":
      return "切换权限模式";
    default:
      throw new Error("unreachable");
  }
}

export function formatCompactModelLabel(label: string): string {
  const separatorIndex = label.lastIndexOf("/");
  return separatorIndex === -1 ? label : label.slice(separatorIndex + 1);
}
export function normalizeModelId(modelId: string | null | undefined): string | null {
  const normalized = typeof modelId === "string" ? modelId.trim() : "";
  if (!normalized) {
    return null;
  }
  return normalized;
}

export function getFeatureTooltip(feature: Pick<AgentFeature, "label" | "tooltip">): string {
  return feature.tooltip ?? feature.label;
}

export function formatAgentFeatureLabel(feature: Pick<AgentFeature, "id" | "label">): string {
  switch (feature.id) {
    case "plan_mode":
      return "计划模式";
    case "fast_mode":
      return "快速模式";
    case "auto_accept":
      return "自动接受";
    default:
      return feature.label;
  }
}

export function getFeatureHighlightColor(featureId: string): FeatureHighlightColor {
  switch (featureId) {
    case "fast_mode":
      return "yellow";
    case "auto_accept":
      return "green";
    case "plan_mode":
      return "blue";
    default:
      return "default";
  }
}

export interface AgentFeatureMenuItemDescriptor {
  id: string;
  label: string;
  selected: boolean;
}

export function buildToggleFeatureMenuItems(
  features: AgentFeature[] | undefined,
): AgentFeatureMenuItemDescriptor[] {
  return (features ?? [])
    .filter((feature): feature is Extract<AgentFeature, { type: "toggle" }> => {
      return feature.type === "toggle" && feature.id === "plan_mode";
    })
    .map((feature) => ({
      id: feature.id,
      label: formatAgentFeatureLabel(feature),
      selected: feature.value,
    }));
}

interface ControlLabelInput {
  id: string;
  label?: string | null;
}

function sentenceCase(value: string): string {
  if (!value) {
    return value;
  }
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

function splitCompactLabel(value: string, splitHyphen: boolean): string {
  const separatorPattern = splitHyphen ? /[_-]+/g : /_+/g;

  return value
    .replace(separatorPattern, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
}

function formatControlLabel(option: ControlLabelInput, splitHyphen: boolean): string {
  const rawLabel = (option.label ?? option.id).trim();
  return sentenceCase(splitCompactLabel(rawLabel, splitHyphen));
}

function compactLabel(value: string): string {
  return value.replace(/[\s_-]+/g, "").toLowerCase();
}

const AGENT_MODE_LABELS: Record<string, string> = {
  acceptedits: "接受文件编辑",
  alwaysask: "每次询问",
  auto: "默认权限",
  automode: "自动模式",
  autoreview: "自动审核",
  build: "构建",
  bypass: "跳过权限",
  bypasspermissions: "跳过权限",
  default: "每次询问",
  defaultpermissions: "默认权限",
  fullaccess: "完全访问",
  loadtest: "负载测试",
  plan: "计划模式",
  planmode: "计划模式",
};

const THINKING_OPTION_LABELS: Record<string, string> = {
  extrahigh: "超高",
  high: "高",
  low: "低",
  medium: "中",
  none: "无",
  thinkhard: "深度思考",
  xhigh: "超高",
};

export function formatAgentModeLabel(mode: ControlLabelInput): string {
  const rawLabel = (mode.label ?? mode.id).trim();
  const localizedLabel =
    AGENT_MODE_LABELS[compactLabel(rawLabel)] ?? AGENT_MODE_LABELS[compactLabel(mode.id)];
  if (localizedLabel) {
    return localizedLabel;
  }

  return formatControlLabel(mode, mode.label == null);
}

export function formatThinkingOptionLabel(option: ControlLabelInput): string {
  const rawLabel = (option.label ?? option.id).trim();
  const localizedLabel =
    THINKING_OPTION_LABELS[compactLabel(rawLabel)] ??
    THINKING_OPTION_LABELS[compactLabel(option.id)];
  if (localizedLabel) {
    return localizedLabel;
  }

  return formatControlLabel(option, true);
}

function findModelById(
  models: AgentModelDefinition[] | null,
  modelId: string | null,
): AgentModelDefinition | null {
  if (!models || !modelId) {
    return null;
  }
  return models.find((model) => model.id === modelId) ?? null;
}

function getFallbackModel(models: AgentModelDefinition[] | null): AgentModelDefinition | null {
  return models?.find((model) => model.isDefault) ?? models?.[0] ?? null;
}

function resolvePreferredModelId(
  runtimeSelectedModel: AgentModelDefinition | null,
  normalizedConfiguredModelId: string | null,
  normalizedRuntimeModelId: string | null,
): string | null {
  return runtimeSelectedModel?.id ?? normalizedConfiguredModelId ?? normalizedRuntimeModelId;
}

function pickSelectedModel(
  models: AgentModelDefinition[] | null,
  preferredModelId: string | null,
  fallbackModel: AgentModelDefinition | null,
): AgentModelDefinition | null {
  if (!models || !preferredModelId) {
    return fallbackModel;
  }
  return findModelById(models, preferredModelId) ?? fallbackModel;
}

function resolveThinkingId(
  explicitThinkingOptionId: string | null | undefined,
  selectedModel: AgentModelDefinition | null,
): string | null {
  if (explicitThinkingOptionId && explicitThinkingOptionId !== "default") {
    return explicitThinkingOptionId;
  }
  return selectedModel?.defaultThinkingOptionId ?? null;
}

type ThinkingOption = NonNullable<AgentModelDefinition["thinkingOptions"]>[number];

function resolveEffectiveThinking(
  thinkingOptions: ThinkingOption[] | null,
  resolvedThinkingId: string | null,
): ThinkingOption | null {
  const selectedThinking =
    thinkingOptions?.find((option) => option.id === resolvedThinkingId) ?? null;
  return selectedThinking ?? thinkingOptions?.[0] ?? null;
}

function resolveModelDisplay(
  selectedModel: AgentModelDefinition | null,
  preferredModelId: string | null,
  fallbackModel: AgentModelDefinition | null,
): { activeModelId: string | null; displayModel: string } {
  return {
    activeModelId: selectedModel?.id ?? preferredModelId ?? null,
    displayModel: selectedModel?.label ?? preferredModelId ?? fallbackModel?.label ?? "未知模型",
  };
}

function resolveThinkingDisplay(
  effectiveThinking: ThinkingOption | null,
  selectedThinkingId: string | null,
): string {
  if (effectiveThinking) {
    return formatThinkingOptionLabel(effectiveThinking);
  }

  if (selectedThinkingId) {
    return formatThinkingOptionLabel({ id: selectedThinkingId });
  }

  return "未知";
}

export function resolveAgentModelSelection(input: {
  models: AgentModelDefinition[] | null;
  runtimeModelId: string | null | undefined;
  configuredModelId: string | null | undefined;
  explicitThinkingOptionId: string | null | undefined;
}) {
  const { models, runtimeModelId, configuredModelId, explicitThinkingOptionId } = input;
  const normalizedRuntimeModelId = normalizeModelId(runtimeModelId);
  const normalizedConfiguredModelId = normalizeModelId(configuredModelId);

  const runtimeSelectedModel = findModelById(models, normalizedRuntimeModelId);
  const preferredModelId = resolvePreferredModelId(
    runtimeSelectedModel,
    normalizedConfiguredModelId,
    normalizedRuntimeModelId,
  );
  const fallbackModel = getFallbackModel(models);
  const selectedModel = pickSelectedModel(models, preferredModelId, fallbackModel);

  const { activeModelId, displayModel } = resolveModelDisplay(
    selectedModel,
    preferredModelId,
    fallbackModel,
  );

  const thinkingOptions = selectedModel?.thinkingOptions ?? null;
  const resolvedThinkingId = resolveThinkingId(explicitThinkingOptionId, selectedModel);
  const effectiveThinking = resolveEffectiveThinking(thinkingOptions, resolvedThinkingId);
  const selectedThinkingId = effectiveThinking?.id ?? null;
  const displayThinking = resolveThinkingDisplay(effectiveThinking, selectedThinkingId);

  return {
    selectedModel,
    activeModelId,
    displayModel,
    thinkingOptions,
    selectedThinkingId,
    displayThinking,
  };
}
