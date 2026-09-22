import { describe, expect, it } from "vitest";
import { ACP_PROVIDER_CATALOG } from "@/data/acp-provider-catalog";
import { buildAcpProviderConfigPatch, getAcpProviderCatalog } from "./use-acp-provider-catalog";

function findProvider(id: string) {
  const entry = getAcpProviderCatalog().find((provider) => provider.id === id);
  if (!entry) {
    throw new Error(`Missing provider catalog entry: ${id}`);
  }
  return entry;
}

describe("provider catalog", () => {
  it("keeps only the supported built-in agent providers", () => {
    expect(getAcpProviderCatalog().map((entry) => entry.id)).toEqual([
      "claude",
      "codex",
      "opencode",
      "pi",
      "kimi",
      "grokbuild",
      "dsh",
    ]);
  });

  it("vendors provider entries with unique ids and concrete commands", () => {
    const ids = new Set<string>();

    for (const entry of ACP_PROVIDER_CATALOG) {
      expect(ids.has(entry.id)).toBe(false);
      ids.add(entry.id);
      expect(entry.title).not.toBe("");
      expect(entry.description).not.toBe("");
      expect(entry.installLink).toMatch(/^https:\/\//);
      expect(entry.command.length).toBeGreaterThan(0);
      expect(entry.command[0]).not.toBe("");
    }
  });

  it("maps a catalog entry to a supported daemon provider config patch", () => {
    expect(buildAcpProviderConfigPatch(findProvider("kimi"))).toEqual({
      providers: {
        kimi: {
          enabled: true,
          label: "Kimi Code",
          description: "Moonshot AI's open-source terminal coding agent via ACP",
          command: ["kimi", "acp"],
          env: {},
        },
      },
    });
    expect(buildAcpProviderConfigPatch(findProvider("grokbuild"))).toEqual({
      providers: {
        grokbuild: {
          enabled: true,
          label: "Grok Build",
          description: "xAI's terminal coding agent via ACP",
          command: ["grok", "agent", "stdio"],
          env: {},
        },
      },
    });
  });
});
