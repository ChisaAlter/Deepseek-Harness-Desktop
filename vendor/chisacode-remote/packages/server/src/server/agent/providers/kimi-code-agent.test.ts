import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { createTestLogger } from "../../../test-utils/test-logger.js";
import { buildManagedKimiConfigToml, KimiCodeAgentClient } from "./kimi-code-agent.js";

describe("buildManagedKimiConfigToml", () => {
  test("writes a Kimi config with provider credentials and model aliases", () => {
    expect(
      buildManagedKimiConfigToml({
        providerId: "chisacode",
        apiKey: "secret\nkey",
        baseUrl: "http://127.0.0.1:6767/api/model-gateways/zai/v1",
        models: [
          {
            id: "glm-5",
            label: 'GLM "5"',
            isDefault: true,
            contextWindowMaxTokens: 200_000,
            supportsImages: true,
            thinkingOptions: [{ id: "high", label: "High" }],
          },
          {
            id: "moa-coder",
            label: "MoA Coder",
          },
        ],
      }),
    ).toBe(`default_model = "glm-5"

[providers."chisacode"]
type = "openai"
api_key = "secret\\nkey"
base_url = "http://127.0.0.1:6767/api/model-gateways/zai/v1"

[models."glm-5"]
provider = "chisacode"
model = "glm-5"
max_context_size = 200000
capabilities = ["tool_use", "image_in", "thinking"]
display_name = "GLM \\"5\\""

[models."moa-coder"]
provider = "chisacode"
model = "moa-coder"
max_context_size = 262144
capabilities = ["tool_use"]
display_name = "MoA Coder"
`);
  });

  test("deduplicates model aliases before writing TOML tables", () => {
    const toml = buildManagedKimiConfigToml({
      providerId: "chisacode",
      apiKey: "secret",
      baseUrl: "http://127.0.0.1:6767/v1",
      models: [
        { id: "glm-5", label: "GLM 5", contextWindowMaxTokens: 128_000 },
        { id: "glm-5", label: "GLM 5 Updated", contextWindowMaxTokens: 200_000 },
      ],
    });

    expect(toml.match(/\[models\."glm-5"\]/gu)).toHaveLength(1);
    expect(toml).toContain('display_name = "GLM 5 Updated"');
    expect(toml).toContain("max_context_size = 200000");
  });

  test("omits tool capability for models that do not support tools", () => {
    const toml = buildManagedKimiConfigToml({
      providerId: "chisacode",
      apiKey: "secret",
      baseUrl: "http://127.0.0.1:6767/v1",
      models: [{ id: "mimo-v2.5", label: "MiMo v2.5", supportsTools: false }],
    });

    expect(toml).toContain('[models."mimo-v2.5"]');
    expect(toml).toContain("capabilities = []");
    expect(toml).not.toContain('"tool_use"');
  });
});

describe("KimiCodeAgentClient managed home", () => {
  const originalChisaCodeHome = process.env.CHISACODE_HOME;
  const tempHomes: string[] = [];

  afterEach(() => {
    if (originalChisaCodeHome === undefined) {
      delete process.env.CHISACODE_HOME;
    } else {
      process.env.CHISACODE_HOME = originalChisaCodeHome;
    }
    for (const home of tempHomes.splice(0)) {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("writes a Kimi OAuth sentinel for ACP when using managed API-key config", () => {
    const chisacodeHome = mkdtempSync(join(tmpdir(), "chisacode-kimi-home-"));
    tempHomes.push(chisacodeHome);
    process.env.CHISACODE_HOME = chisacodeHome;

    const client = new KimiCodeAgentClient({
      logger: createTestLogger(),
      providerId: "zai-kimi",
      runtimeSettings: {
        env: {
          OPENAI_API_KEY: "secret-key",
          OPENAI_BASE_URL: "http://127.0.0.1:6767/api/model-gateways/zai/v1",
        },
      },
      models: [{ id: "glm-5", label: "GLM 5", isDefault: true }],
    });
    expect(client.provider).toBe("acp");

    const managedRoot = join(chisacodeHome, "provider-runtime", "kimi-code");
    const managedHome = join(managedRoot, readdirOnlyEntry(managedRoot));
    expect(readFileSync(join(managedHome, "config.toml"), "utf8")).toContain(
      '[providers."chisacode"]',
    );

    const tokenPath = join(managedHome, "credentials", "kimi-code.json");
    expect(existsSync(tokenPath)).toBe(true);
    const token = JSON.parse(readFileSync(tokenPath, "utf8")) as Record<string, unknown>;
    expect(token["access_token"]).toBe("chisacode-managed-api-key-provider");
    expect(token["refresh_token"]).toBe("chisacode-managed-api-key-provider");
    expect(token["token_type"]).toBe("Bearer");
    expect(typeof token["expires_at"]).toBe("number");
    expect(Number(token["expires_at"])).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });
});

function readdirOnlyEntry(path: string): string {
  const entries = readdirSync(path);
  expect(entries).toHaveLength(1);
  return entries[0] ?? "";
}
