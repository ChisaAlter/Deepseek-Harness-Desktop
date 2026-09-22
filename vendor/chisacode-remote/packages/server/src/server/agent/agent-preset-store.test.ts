import { promises as fs } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, test } from "vitest";
import { createTestLogger } from "../../test-utils/test-logger.js";
import { AgentPresetStore } from "./agent-preset-store.js";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("AgentPresetStore", () => {
  test("loads built-ins plus valid user presets and skips invalid files", async () => {
    const home = mkdtempSync(join(tmpdir(), "agent-presets-"));
    dirs.push(home);
    await fs.mkdir(join(home, "presets"), { recursive: true });
    await fs.writeFile(
      join(home, "presets", "custom.json"),
      JSON.stringify({
        id: "custom",
        label: "Custom",
        description: "Custom preset",
        provider: "codex",
      }),
    );
    await fs.writeFile(join(home, "presets", "invalid.json"), JSON.stringify({ id: "" }));

    const presets = await new AgentPresetStore({
      chisacodeHome: home,
      logger: createTestLogger(),
    }).list();

    expect(presets.some((preset) => preset.id === "code-reviewer")).toBe(true);
    expect(presets.some((preset) => preset.id === "custom")).toBe(true);
  });
});
