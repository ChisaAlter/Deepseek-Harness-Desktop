import type { ComponentType } from "react";
import type { PanelDescriptor, PanelIconProps } from "@/panels/panel-registry";

export function buildDraftPanelDescriptor(input: {
  isCreating: boolean;
  pendingPrompt?: string | null;
  icon: ComponentType<PanelIconProps>;
  copy: {
    newAgent: string;
    creatingAgent: string;
  };
}): PanelDescriptor {
  const { copy, icon, isCreating, pendingPrompt } = input;
  const creatingLabel = pendingPrompt?.trim() || copy.newAgent;
  if (isCreating) {
    return {
      label: creatingLabel,
      subtitle: copy.creatingAgent,
      titleState: "ready",
      icon,
      statusBucket: "running",
    };
  }

  return {
    label: copy.newAgent,
    subtitle: copy.newAgent,
    titleState: "ready",
    icon,
    statusBucket: null,
  };
}
