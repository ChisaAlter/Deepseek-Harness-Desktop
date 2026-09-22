import { describe, expect, test } from "vitest";
import { IMPORTABLE_PROVIDERS } from "./importable-providers.js";
import { AGENT_PROVIDER_IDS, BUILTIN_PROVIDER_IDS } from "./provider-manifest.js";

describe("provider manifest compatibility", () => {
  test("exposes the complete built-in and importable provider contracts", () => {
    expect(BUILTIN_PROVIDER_IDS).toEqual([
      "claude",
      "codex",
      "opencode",
      "pi",
      "kimi",
      "grokbuild",
      "dsh",
    ]);
    expect(IMPORTABLE_PROVIDERS).toEqual(["claude", "codex", "opencode", "pi"]);
  });

  test("keeps AGENT_PROVIDER_IDS as the legacy alias for built-in providers", () => {
    expect(AGENT_PROVIDER_IDS).toBe(BUILTIN_PROVIDER_IDS);
  });
});
