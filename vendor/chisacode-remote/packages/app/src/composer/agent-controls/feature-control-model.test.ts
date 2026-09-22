import type { AgentFeature } from "@chisacode/protocol/agent-types";
import { describe, expect, it } from "vitest";

import { resolveFeatureControlSelector, resolveFeatureDisplayLabel } from "./feature-control-model";

describe("feature control helpers", () => {
  it("derives stable selectors and selected option labels", () => {
    const feature: AgentFeature = {
      id: "profile",
      type: "select",
      label: "Profile",
      value: "strict",
      options: [
        { id: "default", label: "Default" },
        { id: "strict", label: "Strict" },
      ],
    };

    expect(resolveFeatureControlSelector(feature.id)).toBe("feature-profile");
    expect(resolveFeatureDisplayLabel(feature)).toBe("Strict");
    expect(resolveFeatureDisplayLabel({ ...feature, value: "missing" })).toBe("Profile");
    expect(
      resolveFeatureDisplayLabel({
        id: "fast_mode",
        type: "toggle",
        label: "Fast mode",
        value: true,
      }),
    ).toBe("Fast mode");
  });
});
