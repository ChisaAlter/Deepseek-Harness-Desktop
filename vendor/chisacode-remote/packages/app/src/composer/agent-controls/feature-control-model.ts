import type { AgentFeature } from "@chisacode/protocol/agent-types";

export type FeatureControlSelector = `feature-${string}`;

export function resolveFeatureControlSelector(featureId: string): FeatureControlSelector {
  return `feature-${featureId}`;
}

export function resolveFeatureDisplayLabel(feature: AgentFeature): string {
  if (feature.type !== "select") {
    return feature.label;
  }
  return feature.options.find((option) => option.id === feature.value)?.label ?? feature.label;
}
