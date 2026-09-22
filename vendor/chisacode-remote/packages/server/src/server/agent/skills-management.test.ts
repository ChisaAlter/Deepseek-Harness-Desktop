import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, test } from "vitest";
import type { MutableDaemonConfig } from "@chisacode/protocol/messages";
import { listManagedSkills, type UserSkillRoots } from "./skills-management.js";

const tempDirs: string[] = [];

function testConfig(): MutableDaemonConfig {
  return {
    skills: {
      global: { disabledSkillNames: [] },
      providers: {},
      agents: {},
      installedSources: {},
    },
  } as unknown as MutableDaemonConfig;
}

async function emptyRoots(): Promise<UserSkillRoots> {
  const root = await mkdtemp(join(tmpdir(), "chisacode-skills-management-test-"));
  tempDirs.push(root);
  return {
    agentsDir: join(root, "agents"),
    codexDir: join(root, "codex"),
    claudeDir: join(root, "claude"),
  };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("listManagedSkills", () => {
  test("lists built-in provider scopes in stable product-label order", async () => {
    const result = await listManagedSkills([], testConfig(), await emptyRoots());

    const expectedProviders = [
      { type: "provider", provider: "claude", label: "Claude" },
      { type: "provider", provider: "codex", label: "Codex" },
      { type: "provider", provider: "opencode", label: "OpenCode" },
      { type: "provider", provider: "pi", label: "Pi" },
      { type: "provider", provider: "kimi", label: "Kimi Code" },
      { type: "provider", provider: "grokbuild", label: "Grok Build" },
      { type: "provider", provider: "dsh", label: "DeepSeek Harness" },
    ];

    expect(result.scopes).toEqual([{ type: "global", label: "Global" }, ...expectedProviders]);
  });

  test("includes dev providers only when current daemon state exposes them", async () => {
    const result = await listManagedSkills(
      [{ id: "mock-agent", provider: "mock", title: null }],
      testConfig(),
      await emptyRoots(),
    );

    expect(result.scopes).toContainEqual({
      type: "provider",
      provider: "mock",
      label: "Mock Load Test",
    });
  });

  test("applies global, provider, and agent policy precedence", async () => {
    const roots = await emptyRoots();
    const skillDir = join(roots.codexDir, "review");
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, "SKILL.md"),
      "---\nname: review\ndescription: Review code\n---\n",
      "utf8",
    );
    const config = testConfig();
    config.skills.global.disabledSkillNames = ["review"];
    config.skills.providers.codex = {
      enabledSkillNames: ["review"],
      disabledSkillNames: [],
    };
    config.skills.agents["agent-codex"] = {
      enabledSkillNames: [],
      disabledSkillNames: ["review"],
    };

    const result = await listManagedSkills(
      [{ id: "agent-codex", provider: "codex", title: null }],
      config,
      roots,
    );

    expect(result.scopes).toContainEqual({
      type: "agent",
      agentId: "agent-codex",
      label: "agent-codex",
    });
    expect(result.skills[0]?.statusByScope).toMatchObject({
      global: "global-disabled",
      providers: { codex: "agent-enabled" },
      agents: { "agent-codex": "agent-disabled" },
    });
  });
});
