import { describe, expect, it } from "vitest";
import { buildDraftPanelDescriptor } from "@/panels/draft-panel-descriptor";

function TestIcon() {
  return null;
}

const COPY = {
  newAgent: "New Agent",
  creatingAgent: "Creating agent",
};

describe("buildDraftPanelDescriptor", () => {
  it("uses the initial prompt title and running loader bucket during create", () => {
    const descriptor = buildDraftPanelDescriptor({
      isCreating: true,
      pendingPrompt: "Build the dashboard",
      icon: TestIcon,
      copy: COPY,
    });

    expect(descriptor).toMatchObject({
      label: "Build the dashboard",
      subtitle: "Creating agent",
      titleState: "ready",
      statusBucket: "running",
    });
  });

  it("falls back to the draft title for empty create prompts", () => {
    const descriptor = buildDraftPanelDescriptor({
      isCreating: true,
      pendingPrompt: "   ",
      icon: TestIcon,
      copy: COPY,
    });

    expect(descriptor.label).toBe("New Agent");
  });

  it("keeps ordinary draft tabs labeled as new agents", () => {
    const descriptor = buildDraftPanelDescriptor({
      isCreating: false,
      icon: TestIcon,
      copy: COPY,
    });

    expect(descriptor).toMatchObject({
      label: "New Agent",
      subtitle: "New Agent",
      titleState: "ready",
      statusBucket: null,
    });
  });
});
