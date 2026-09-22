import type { FeatureControlSelector } from "@/composer/agent-controls/feature-control-model";

export interface AgentControlOption {
  id: string;
  label: string;
}

export type AgentControlSelector =
  | "provider"
  | "mode"
  | "model"
  | "thinking"
  | FeatureControlSelector;

export type ActiveAgentControlSheet = "thinking" | "features" | null;
