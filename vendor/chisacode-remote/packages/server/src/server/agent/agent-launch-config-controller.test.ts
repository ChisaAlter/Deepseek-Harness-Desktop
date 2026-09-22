import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test, vi } from "vitest";

import { AgentLaunchConfigController } from "./agent-launch-config-controller.js";
import type { AgentClient, AgentModelDefinition } from "./agent-sdk-types.js";
import { createTestLogger } from "../../test-utils/test-logger.js";

const logger = createTestLogger();

function createModels(): AgentModelDefinition[] {
  return [
    {
      provider: "codex",
      id: "gpt-5.4",
      label: "GPT-5.4",
      isDefault: true,
    },
    {
      provider: "codex",
      id: "gpt-5.4-mini",
      label: "GPT-5.4 Mini",
    },
  ];
}

function createController(options: {
  listModels: ReturnType<typeof vi.fn>;
  resolveCachedModels?: (
    cwd: string | undefined,
    provider: string,
  ) => readonly AgentModelDefinition[] | undefined;
}) {
  const client = {
    provider: "codex",
    listModels: options.listModels,
  } as unknown as AgentClient;

  return new AgentLaunchConfigController({
    appendSystemPrompt: "",
    logger,
    mcpBaseUrl: null,
    providers: {
      getClient: (provider) => (provider === "codex" ? client : undefined),
    },
    resolveCachedModels: options.resolveCachedModels,
  });
}

describe("AgentLaunchConfigController.normalizeConfig model cache", () => {
  test("uses resolveCachedModels and does not call listModels when cache is warm", async () => {
    const workdir = mkdtempSync(join(tmpdir(), "launch-config-cache-"));
    const listModels = vi.fn(async () => createModels());
    const resolveCachedModels = vi.fn(() => createModels());
    const controller = createController({ listModels, resolveCachedModels });

    const normalized = await controller.normalizeConfig({
      provider: "codex",
      cwd: workdir,
    });

    expect(normalized.model).toBe("gpt-5.4");
    expect(resolveCachedModels).toHaveBeenCalledWith(workdir, "codex");
    expect(listModels).not.toHaveBeenCalled();
  });

  test("falls back to listModels when cache is empty", async () => {
    const workdir = mkdtempSync(join(tmpdir(), "launch-config-cache-empty-"));
    const listModels = vi.fn(async () => createModels());
    const resolveCachedModels = vi.fn(() => undefined);
    const controller = createController({ listModels, resolveCachedModels });

    const normalized = await controller.normalizeConfig({
      provider: "codex",
      cwd: workdir,
    });

    expect(normalized.model).toBe("gpt-5.4");
    expect(listModels).toHaveBeenCalledTimes(1);
  });

  test("does not query cache or listModels when model is already set", async () => {
    const workdir = mkdtempSync(join(tmpdir(), "launch-config-model-set-"));
    const listModels = vi.fn(async () => createModels());
    const resolveCachedModels = vi.fn(() => createModels());
    const controller = createController({ listModels, resolveCachedModels });

    const normalized = await controller.normalizeConfig({
      provider: "codex",
      cwd: workdir,
      model: "gpt-5.4-mini",
    });

    expect(normalized.model).toBe("gpt-5.4-mini");
    expect(resolveCachedModels).not.toHaveBeenCalled();
    expect(listModels).not.toHaveBeenCalled();
  });

  test("falls back to listModels when resolveCachedModels is not injected", async () => {
    const workdir = mkdtempSync(join(tmpdir(), "launch-config-no-cache-hook-"));
    const listModels = vi.fn(async () => createModels());
    const controller = createController({ listModels });

    const normalized = await controller.normalizeConfig({
      provider: "codex",
      cwd: workdir,
    });

    expect(normalized.model).toBe("gpt-5.4");
    expect(listModels).toHaveBeenCalledTimes(1);
  });
});
