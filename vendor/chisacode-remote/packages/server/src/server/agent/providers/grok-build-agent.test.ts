import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { createTestLogger } from "../../../test-utils/test-logger.js";
import {
  buildManagedGrokConfigToml,
  GrokBuildAgentClient,
  prepareGrokGatewayEnv,
  resolveGrokBuildCommand,
} from "./grok-build-agent.js";

describe("resolveGrokBuildCommand", () => {
  test("uses the Grok Build ACP command by default", () => {
    expect(resolveGrokBuildCommand(undefined)).toEqual(["grok", "agent", "stdio"]);
  });

  test("appends runtime arguments before the ACP subcommand", () => {
    expect(
      resolveGrokBuildCommand({
        command: { mode: "append", args: ["--model", "grok-4.5"] },
      }),
    ).toEqual(["grok", "--model", "grok-4.5", "agent", "stdio"]);
  });

  test("replaces the complete command when configured", () => {
    expect(
      resolveGrokBuildCommand({
        command: { mode: "replace", argv: ["custom-grok", "agent", "stdio"] },
      }),
    ).toEqual(["custom-grok", "agent", "stdio"]);
  });
});

describe("buildManagedGrokConfigToml", () => {
  test("routes through endpoints.models_base_url instead of per-model base_url", () => {
    expect(
      buildManagedGrokConfigToml({
        apiKey: 'secret"key',
        baseUrl: "http://127.0.0.1:6767/api/model-gateways/zai/v1",
        models: [
          {
            id: "grok-4.5",
            label: "Grok 4.5",
            isDefault: true,
            contextWindowMaxTokens: 200_000,
            description: "Gateway model",
          },
          {
            id: "glm-5",
            label: "GLM 5",
          },
        ],
      }),
    ).toBe(`[permissions]
default_selected_permission = "always_allow_all_sessions"

[ui]
yolo = true
remember_tool_approvals = true

[models]
default = "grok-4.5"

[endpoints]
models_base_url = "http://127.0.0.1:6767/api/model-gateways/zai/v1"
api_key = "secret\\"key"

[model.grok-4.5]
model = "grok-4.5"
name = "Grok 4.5"
description = "Gateway model"
context_window = 200000

[model.glm-5]
model = "glm-5"
name = "GLM 5"
`);
  });

  test("deduplicates models before writing tables", () => {
    const toml = buildManagedGrokConfigToml({
      apiKey: "secret",
      baseUrl: "http://127.0.0.1:6767/v1",
      models: [
        { id: "grok-4.5", label: "Grok", contextWindowMaxTokens: 128_000 },
        { id: "grok-4.5", label: "Grok Updated", contextWindowMaxTokens: 200_000 },
      ],
    });

    expect(toml.match(/\[model\.grok-4\.5\]/gu)).toHaveLength(1);
    expect(toml).toContain('name = "Grok Updated"');
    expect(toml).toContain("context_window = 200000");
    expect(toml).toContain("[endpoints]");
    expect(toml).toContain('models_base_url = "http://127.0.0.1:6767/v1"');
    expect(toml).not.toMatch(/(?:^|\n)\s*base_url\s*=/u);
  });
});

describe("prepareGrokGatewayEnv / GrokBuildAgentClient managed home", () => {
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

  test("leaves env unchanged without gateway credentials or models", () => {
    expect(
      prepareGrokGatewayEnv({
        providerId: "zai-grokbuild",
        env: { OPENAI_API_KEY: "secret" },
        models: [{ id: "grok-4.5", label: "Grok 4.5" }],
      }),
    ).toEqual({
      env: { OPENAI_API_KEY: "secret" },
      managedHome: null,
    });

    expect(
      prepareGrokGatewayEnv({
        providerId: "zai-grokbuild",
        env: {
          OPENAI_API_KEY: "secret",
          OPENAI_BASE_URL: "http://127.0.0.1:6767/api/model-gateways/zai/v1",
        },
        models: [],
      }),
    ).toEqual({
      env: {
        OPENAI_API_KEY: "secret",
        OPENAI_BASE_URL: "http://127.0.0.1:6767/api/model-gateways/zai/v1",
      },
      managedHome: null,
    });
  });

  test("does not overwrite an explicit external GROK_HOME but still forces gateway routing env", () => {
    const env = {
      OPENAI_API_KEY: "secret",
      OPENAI_BASE_URL: "http://127.0.0.1:6767/api/model-gateways/zai/v1",
      GROK_HOME: "C:\\explicit\\grok-home",
    };
    expect(
      prepareGrokGatewayEnv({
        providerId: "zai-grokbuild",
        env,
        models: [{ id: "grok-4.5", label: "Grok 4.5" }],
      }),
    ).toEqual({
      env: {
        OPENAI_API_KEY: "secret",
        OPENAI_BASE_URL: "http://127.0.0.1:6767/api/model-gateways/zai/v1",
        GROK_HOME: "C:\\explicit\\grok-home",
        GROK_MODELS_BASE_URL: "http://127.0.0.1:6767/api/model-gateways/zai/v1",
        GROK_DEFAULT_SELECTED_PERMISSION: "always_allow_all_sessions",
        XAI_API_KEY: "secret",
      },
      managedHome: null,
    });
  });

  test("rewrites a stale managed config.toml that Grok mutated away from endpoints routing", () => {
    const chisacodeHome = mkdtempSync(join(tmpdir(), "chisacode-grok-home-"));
    tempHomes.push(chisacodeHome);
    process.env.CHISACODE_HOME = chisacodeHome;

    const managedRoot = join(chisacodeHome, "provider-runtime", "grokbuild");
    const staleHome = join(managedRoot, "zai-grokbuild-stale");
    mkdirSync(staleHome, { recursive: true });
    writeFileSync(
      join(staleHome, "config.toml"),
      `[models]
default = "grok-4.5"

[model.grok-4.5]
model = "grok-4.5"
base_url = "http://127.0.0.1:6767/api/model-gateways/zai/v1"
api_backend = "chat_completions"

[marketplace]
default_skills_installs_purged = true
`,
      "utf8",
    );

    const prepared = prepareGrokGatewayEnv({
      providerId: "zai-grokbuild",
      env: {
        OPENAI_API_KEY: "secret-key",
        OPENAI_BASE_URL: "http://127.0.0.1:6767/api/model-gateways/zai/v1",
        GROK_HOME: staleHome,
      },
      models: [{ id: "grok-4.5", label: "Grok 4.5", isDefault: true }],
    });

    expect(prepared.managedHome?.grokHome).toBe(staleHome);
    expect(prepared.env?.GROK_HOME).toBe(staleHome);
    expect(prepared.env?.GROK_MODELS_BASE_URL).toBe(
      "http://127.0.0.1:6767/api/model-gateways/zai/v1",
    );
    const toml = readFileSync(join(staleHome, "config.toml"), "utf8");
    expect(toml).toContain("[endpoints]");
    expect(toml).toContain('models_base_url = "http://127.0.0.1:6767/api/model-gateways/zai/v1"');
    expect(toml).not.toMatch(/(?:^|\n)\s*base_url\s*=/u);
    expect(toml).not.toContain("[marketplace]");
  });

  test("writes an isolated managed GROK_HOME for gateway faces", () => {
    const chisacodeHome = mkdtempSync(join(tmpdir(), "chisacode-grok-home-"));
    tempHomes.push(chisacodeHome);
    process.env.CHISACODE_HOME = chisacodeHome;

    const client = new GrokBuildAgentClient({
      logger: createTestLogger(),
      providerId: "zai-grokbuild",
      runtimeSettings: {
        env: {
          OPENAI_API_KEY: "secret-key",
          OPENAI_BASE_URL: "http://127.0.0.1:6767/api/model-gateways/zai/v1",
          XAI_API_KEY: "secret-key",
        },
      },
      models: [{ id: "grok-4.5", label: "Grok 4.5", isDefault: true }],
    });
    expect(client.provider).toBe("acp");

    const managedRoot = join(chisacodeHome, "provider-runtime", "grokbuild");
    const managedHome = join(managedRoot, readdirOnlyEntry(managedRoot));
    expect(managedHome.startsWith(join(chisacodeHome, "provider-runtime", "grokbuild"))).toBe(true);
    expect(existsSync(join(managedHome, "config.toml"))).toBe(true);
    const toml = readFileSync(join(managedHome, "config.toml"), "utf8");
    expect(toml).toContain("[model.grok-4.5]");
    expect(toml).toContain("[endpoints]");
    expect(toml).toContain('models_base_url = "http://127.0.0.1:6767/api/model-gateways/zai/v1"');
    expect(toml).toContain("[permissions]");
    expect(toml).toContain('default_selected_permission = "always_allow_all_sessions"');
    expect(toml).not.toMatch(/(?:^|\n)\s*base_url\s*=/u);
    expect(toml).not.toContain("C:\\Users");
  });

  test("appends --always-approve for gateway-routed sessions", () => {
    const chisacodeHome = mkdtempSync(join(tmpdir(), "chisacode-grok-home-"));
    tempHomes.push(chisacodeHome);
    process.env.CHISACODE_HOME = chisacodeHome;

    const client = new GrokBuildAgentClient({
      logger: createTestLogger(),
      providerId: "zai-grokbuild",
      runtimeSettings: {
        env: {
          OPENAI_API_KEY: "secret-key",
          OPENAI_BASE_URL: "http://127.0.0.1:6767/api/model-gateways/zai/v1",
          XAI_API_KEY: "secret-key",
        },
      },
      models: [{ id: "grok-4.5", label: "Grok 4.5", isDefault: true }],
    });
    expect(client.command).toEqual(["grok", "--always-approve", "agent", "stdio"]);
  });

  test("does not append --always-approve for native non-gateway sessions", () => {
    const client = new GrokBuildAgentClient({
      logger: createTestLogger(),
      providerId: "grokbuild",
      runtimeSettings: {
        env: {
          XAI_API_KEY: "native-key",
        },
      },
    });
    expect(client.command).toEqual(["grok", "agent", "stdio"]);
  });
});

function readdirOnlyEntry(path: string): string {
  const entries = readdirSync(path);
  expect(entries).toHaveLength(1);
  return entries[0] ?? "";
}
