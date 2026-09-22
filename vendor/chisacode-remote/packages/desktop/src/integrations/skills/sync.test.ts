import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { removeSkill, syncSkills } from "./sync";

interface Sandbox {
  root: string;
  sourceDir: string;
  agentsDir: string;
  claudeDir: string;
  codexDir: string;
}

async function makeSandbox(): Promise<Sandbox> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "chisacode-skill-sync-"));
  const sourceDir = path.join(root, "bundle");
  const agentsDir = path.join(root, "home", ".agents", "skills");
  const claudeDir = path.join(root, "home", ".claude", "skills");
  const codexDir = path.join(root, "home", ".codex", "skills");
  await fs.mkdir(sourceDir, { recursive: true });
  return { root, sourceDir, agentsDir, claudeDir, codexDir };
}

async function writeBundleSkill(
  sourceDir: string,
  name: string,
  files: Record<string, string>,
): Promise<void> {
  const skillDir = path.join(sourceDir, name);
  await fs.mkdir(skillDir, { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(skillDir, rel);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, content);
  }
}

describe("syncSkills", () => {
  let sandbox: Sandbox;

  beforeEach(async () => {
    sandbox = await makeSandbox();
  });

  afterEach(async () => {
    await fs.rm(sandbox.root, { recursive: true, force: true });
  });

  it("overwrites on-disk skill content when the bundle differs", async () => {
    await writeBundleSkill(sandbox.sourceDir, "chisacode", {
      "SKILL.md": "new chisacode content",
    });
    const onDiskSkill = path.join(sandbox.agentsDir, "chisacode");
    await fs.mkdir(onDiskSkill, { recursive: true });
    await fs.writeFile(path.join(onDiskSkill, "SKILL.md"), "old chisacode content");

    const result = await syncSkills({
      sourceDir: sandbox.sourceDir,
      agentsDir: sandbox.agentsDir,
      claudeDir: sandbox.claudeDir,
      codexDir: sandbox.codexDir,
      skillNames: ["chisacode"],
    });

    expect(result.processedSkills).toBe(1);
    expect(result.changedFiles).toBeGreaterThan(0);
    const agentsContent = await fs.readFile(
      path.join(sandbox.agentsDir, "chisacode", "SKILL.md"),
      "utf-8",
    );
    expect(agentsContent).toBe("new chisacode content");
    const claudeContent = await fs.readFile(
      path.join(sandbox.claudeDir, "chisacode", "SKILL.md"),
      "utf-8",
    );
    expect(claudeContent).toBe("new chisacode content");
    const codexContent = await fs.readFile(
      path.join(sandbox.codexDir, "chisacode", "SKILL.md"),
      "utf-8",
    );
    expect(codexContent).toBe("new chisacode content");
  });

  it("installs new bundled skills, including references/, when not present on disk", async () => {
    await writeBundleSkill(sandbox.sourceDir, "chisacode-epic", {
      "SKILL.md": "epic content",
      "references/roles.md": "roles content",
    });

    await syncSkills({
      sourceDir: sandbox.sourceDir,
      agentsDir: sandbox.agentsDir,
      claudeDir: sandbox.claudeDir,
      codexDir: sandbox.codexDir,
      skillNames: ["chisacode-epic"],
    });

    expect(
      await fs.readFile(path.join(sandbox.agentsDir, "chisacode-epic", "SKILL.md"), "utf-8"),
    ).toBe("epic content");
    expect(
      await fs.readFile(
        path.join(sandbox.agentsDir, "chisacode-epic", "references", "roles.md"),
        "utf-8",
      ),
    ).toBe("roles content");
    expect(
      await fs.readFile(
        path.join(sandbox.codexDir, "chisacode-epic", "references", "roles.md"),
        "utf-8",
      ),
    ).toBe("roles content");

    const claudeSkillDir = path.join(sandbox.claudeDir, "chisacode-epic");
    expect((await fs.lstat(claudeSkillDir)).isDirectory()).toBe(true);
    expect(await fs.readFile(path.join(claudeSkillDir, "SKILL.md"), "utf-8")).toBe("epic content");
    expect(await fs.readFile(path.join(claudeSkillDir, "references", "roles.md"), "utf-8")).toBe(
      "roles content",
    );
  });

  it("leaves on-disk skills not in the bundle untouched", async () => {
    await writeBundleSkill(sandbox.sourceDir, "chisacode", { "SKILL.md": "new" });
    const customSkill = path.join(sandbox.agentsDir, "user-custom-skill");
    await fs.mkdir(customSkill, { recursive: true });
    await fs.writeFile(path.join(customSkill, "SKILL.md"), "user content");

    await syncSkills({
      sourceDir: sandbox.sourceDir,
      agentsDir: sandbox.agentsDir,
      claudeDir: sandbox.claudeDir,
      codexDir: sandbox.codexDir,
      skillNames: ["chisacode"],
    });

    expect(await fs.readFile(path.join(customSkill, "SKILL.md"), "utf-8")).toBe("user content");
  });

  it("does not delete files on disk that are no longer in the bundle", async () => {
    await writeBundleSkill(sandbox.sourceDir, "chisacode", { "SKILL.md": "new" });
    const onDiskSkill = path.join(sandbox.agentsDir, "chisacode");
    await fs.mkdir(path.join(onDiskSkill, "references"), { recursive: true });
    await fs.writeFile(path.join(onDiskSkill, "SKILL.md"), "old");
    await fs.writeFile(path.join(onDiskSkill, "references", "stale.md"), "stale");

    await syncSkills({
      sourceDir: sandbox.sourceDir,
      agentsDir: sandbox.agentsDir,
      claudeDir: sandbox.claudeDir,
      codexDir: sandbox.codexDir,
      skillNames: ["chisacode"],
    });

    expect(await fs.readFile(path.join(onDiskSkill, "SKILL.md"), "utf-8")).toBe("new");
    expect(await fs.readFile(path.join(onDiskSkill, "references", "stale.md"), "utf-8")).toBe(
      "stale",
    );
  });

  it("reports zero changed files on a no-op resync", async () => {
    await writeBundleSkill(sandbox.sourceDir, "chisacode", {
      "SKILL.md": "content",
      "references/extra.md": "ref",
    });

    const first = await syncSkills({
      sourceDir: sandbox.sourceDir,
      agentsDir: sandbox.agentsDir,
      claudeDir: sandbox.claudeDir,
      codexDir: sandbox.codexDir,
      skillNames: ["chisacode"],
    });
    expect(first.changedFiles).toBeGreaterThan(0);

    const second = await syncSkills({
      sourceDir: sandbox.sourceDir,
      agentsDir: sandbox.agentsDir,
      claudeDir: sandbox.claudeDir,
      codexDir: sandbox.codexDir,
      skillNames: ["chisacode"],
    });
    expect(second.changedFiles).toBe(0);
  });

  it("skips skills listed in skillNames that are missing from the bundle without raising", async () => {
    await writeBundleSkill(sandbox.sourceDir, "chisacode", { "SKILL.md": "content" });
    // "chisacode-removed" is in skillNames but not in the bundle on disk.

    const errors: Array<{ name: string; error: unknown }> = [];
    const result = await syncSkills({
      sourceDir: sandbox.sourceDir,
      agentsDir: sandbox.agentsDir,
      claudeDir: sandbox.claudeDir,
      codexDir: sandbox.codexDir,
      skillNames: ["chisacode", "chisacode-removed"],
      onSkillError: (name, error) => errors.push({ name, error }),
    });

    expect(errors).toEqual([]);
    expect(result.processedSkills).toBe(1);
    expect(await fs.readFile(path.join(sandbox.agentsDir, "chisacode", "SKILL.md"), "utf-8")).toBe(
      "content",
    );
    await expect(fs.access(path.join(sandbox.agentsDir, "chisacode-removed"))).rejects.toThrow();
  });

  it("leaves on-disk skill content alone when the skill has been removed from the bundle", async () => {
    await writeBundleSkill(sandbox.sourceDir, "chisacode", { "SKILL.md": "current" });
    const deprecatedDir = path.join(sandbox.agentsDir, "chisacode-deprecated");
    await fs.mkdir(deprecatedDir, { recursive: true });
    await fs.writeFile(path.join(deprecatedDir, "SKILL.md"), "old content");

    await syncSkills({
      sourceDir: sandbox.sourceDir,
      agentsDir: sandbox.agentsDir,
      claudeDir: sandbox.claudeDir,
      codexDir: sandbox.codexDir,
      skillNames: ["chisacode", "chisacode-deprecated"],
    });

    expect(await fs.readFile(path.join(deprecatedDir, "SKILL.md"), "utf-8")).toBe("old content");
  });

  it("does not crash when the source bundle directory is missing", async () => {
    const missingSourceDir = path.join(sandbox.root, "no-bundle-here");

    const errors: string[] = [];
    const result = await syncSkills({
      sourceDir: missingSourceDir,
      agentsDir: sandbox.agentsDir,
      claudeDir: sandbox.claudeDir,
      codexDir: sandbox.codexDir,
      skillNames: ["chisacode"],
      onSkillError: (skillName) => errors.push(skillName),
    });

    expect(errors).toEqual([]);
    expect(result).toEqual({ changedFiles: 0, processedSkills: 0 });
  });

  it("reports per-skill errors via onSkillError without throwing", async () => {
    await writeBundleSkill(sandbox.sourceDir, "chisacode", { "SKILL.md": "content" });
    // Make agents skill path a file (not a directory) to force a write error
    await fs.mkdir(sandbox.agentsDir, { recursive: true });
    await fs.writeFile(path.join(sandbox.agentsDir, "chisacode"), "blocking file");

    const errors: string[] = [];
    const result = await syncSkills({
      sourceDir: sandbox.sourceDir,
      agentsDir: sandbox.agentsDir,
      claudeDir: sandbox.claudeDir,
      codexDir: sandbox.codexDir,
      skillNames: ["chisacode"],
      onSkillError: (skillName) => errors.push(skillName),
    });

    expect(errors).toContain("chisacode");
    expect(result.processedSkills).toBe(0);
  });
});

describe("removeSkill", () => {
  let sandbox: Sandbox;

  beforeEach(async () => {
    sandbox = await makeSandbox();
  });

  afterEach(async () => {
    await fs.rm(sandbox.root, { recursive: true, force: true });
  });

  it("removes the skill from all three targets when present", async () => {
    await writeBundleSkill(sandbox.sourceDir, "chisacode", { "SKILL.md": "content" });
    await syncSkills({
      sourceDir: sandbox.sourceDir,
      agentsDir: sandbox.agentsDir,
      claudeDir: sandbox.claudeDir,
      codexDir: sandbox.codexDir,
      skillNames: ["chisacode"],
    });

    await removeSkill("chisacode", {
      agentsDir: sandbox.agentsDir,
      claudeDir: sandbox.claudeDir,
      codexDir: sandbox.codexDir,
    });

    await expect(fs.access(path.join(sandbox.agentsDir, "chisacode"))).rejects.toThrow();
    await expect(fs.access(path.join(sandbox.claudeDir, "chisacode"))).rejects.toThrow();
    await expect(fs.access(path.join(sandbox.codexDir, "chisacode"))).rejects.toThrow();
  });

  it("does not throw when targets are missing", async () => {
    await expect(
      removeSkill("does-not-exist", {
        agentsDir: sandbox.agentsDir,
        claudeDir: sandbox.claudeDir,
        codexDir: sandbox.codexDir,
      }),
    ).resolves.toBeUndefined();
  });
});
