import { describe, expect, it } from "vitest";
import {
  buildProviderCapabilityHintSummaryLabel,
  getProviderCapabilityHints,
  summarizeProviderCapabilityHints,
} from "./provider-capability-hints";

function supportedIds(provider: string) {
  return getProviderCapabilityHints(provider)
    .filter((hint) => hint.supported)
    .map((hint) => hint.id);
}

describe("getProviderCapabilityHints", () => {
  it("returns conservative defaults for unknown providers", () => {
    expect(supportedIds("unknown")).toEqual(["resume", "permissions", "sandbox", "headless"]);
  });

  it("applies provider-specific overrides", () => {
    expect(supportedIds("claude")).toContain("subagents");
    expect(supportedIds("claude")).toContain("mcp");
  });

  it("normalizes provider ids", () => {
    expect(supportedIds(" CODEX ")).toContain("mcp");
  });

  it("matches provider aliases embedded in adapter ids", () => {
    expect(supportedIds("claude-code")).toContain("subagents");
    expect(supportedIds("openai-compatible/opencode")).toContain("mcp");
    expect(supportedIds("codex_cli")).toContain("subagents");
  });

  it("matches common dashed provider aliases", () => {
    expect(supportedIds("open-code")).toContain("mcp");
    expect(supportedIds("local/codex-cli")).toContain("subagents");
    expect(supportedIds("workspace/claude_code")).toContain("mcp");
  });

  it("uses defaults for blank provider ids", () => {
    expect(getProviderCapabilityHints(null)).toEqual(getProviderCapabilityHints(""));
    expect(supportedIds("   ")).toEqual(["resume", "permissions", "sandbox", "headless"]);
  });

  it("summarizes supported and unsupported capability counts", () => {
    expect(summarizeProviderCapabilityHints(getProviderCapabilityHints("unknown"))).toEqual({
      supportedCount: 4,
      unsupportedCount: 2,
      totalCount: 6,
    });
    expect(summarizeProviderCapabilityHints(getProviderCapabilityHints("claude"))).toEqual({
      supportedCount: 6,
      unsupportedCount: 0,
      totalCount: 6,
    });
  });

  it("builds an accessible summary label with supported and limited capabilities", () => {
    expect(
      buildProviderCapabilityHintSummaryLabel(getProviderCapabilityHints("unknown"), {
        title: "Provider capabilities",
        supportedLabel: "Supported",
        limitedLabel: "Limited",
        formatCount: ({ supported, total }) => `Capabilities ${supported}/${total}`,
        labelForHint: (id) => id,
      }),
    ).toBe(
      "Provider capabilities Capabilities 4/6. Supported: resume, permissions, sandbox, headless. Limited: subagents, mcp",
    );
  });
});
