import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: {
    getPath: vi.fn(() => "/tmp/chisacode-user-data"),
    isPackaged: false,
  },
}));

import {
  cleanupRetiredSkills,
  getSkillsStatus,
  installSkills,
  installUserSkillsFromLocalDirectory,
  normalizeGitHubSkillSource,
  CHISACODE_SKILL_NAMES,
  RETIRED_SKILL_NAMES,
  type SkillTargets,
  uninstallSkills,
  uninstallUserInstalledSkills,
  updateSkills,
} from "./operations";

interface Sandbox {
  root: string;
  targets: SkillTargets;
}

async function makeSandbox(): Promise<Sandbox> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "chisacode-skills-"));
  const targets: SkillTargets = {
    sourceDir: path.join(root, "bundle"),
    agentsDir: path.join(root, "home", ".agents", "skills"),
    claudeDir: path.join(root, "home", ".claude", "skills"),
    codexDir: path.join(root, "home", ".codex", "skills"),
  };
  await fs.mkdir(targets.sourceDir, { recursive: true });
  return { root, targets };
}

async function writeFiles(rootDir: string, files: Record<string, string>): Promise<void> {
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(rootDir, rel);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, content);
  }
}

async function writeBundleSkill(
  sourceDir: string,
  name: string,
  files: Record<string, string>,
): Promise<void> {
  await writeFiles(path.join(sourceDir, name), files);
}

async function writeOnDiskSkill(
  agentsDir: string,
  name: string,
  files: Record<string, string>,
): Promise<void> {
  await writeFiles(path.join(agentsDir, name), files);
}

async function writeCurrentBundle(sourceDir: string): Promise<void> {
  await writeBundleSkill(sourceDir, "chisacode", { "SKILL.md": "chisacode-v1" });
  await writeBundleSkill(sourceDir, "chisacode-loop", { "SKILL.md": "loop-v1" });
}

async function pathExists(p: string): Promise<boolean> {
  return fs
    .access(p)
    .then(() => true)
    .catch(() => false);
}

describe("getSkillsStatus", () => {
  let sandbox: Sandbox;

  beforeEach(async () => {
    sandbox = await makeSandbox();
  });

  afterEach(async () => {
    await fs.rm(sandbox.root, { recursive: true, force: true });
  });

  it("returns not-installed with add ops for every bundled skill when nothing is on disk", async () => {
    await writeCurrentBundle(sandbox.targets.sourceDir);

    const status = await getSkillsStatus(sandbox.targets);

    expect(status.state).toBe("not-installed");
    expect(status.ops).toEqual([
      { kind: "add", name: "chisacode" },
      { kind: "add", name: "chisacode-loop" },
    ]);
  });

  it("returns not-installed when only user-personal skill dirs exist (the live bug)", async () => {
    await writeCurrentBundle(sandbox.targets.sourceDir);
    for (const name of ["unslop", "tdd", "devbox"]) {
      await writeOnDiskSkill(sandbox.targets.agentsDir, name, { "SKILL.md": `user-${name}` });
    }

    const status = await getSkillsStatus(sandbox.targets);

    expect(status.state).toBe("not-installed");
    expect(status.ops).toEqual([
      { kind: "add", name: "chisacode" },
      { kind: "add", name: "chisacode-loop" },
    ]);
  });

  it("returns up-to-date when every bundled skill matches on disk", async () => {
    await writeCurrentBundle(sandbox.targets.sourceDir);
    await writeOnDiskSkill(sandbox.targets.agentsDir, "chisacode", { "SKILL.md": "chisacode-v1" });
    await writeOnDiskSkill(sandbox.targets.agentsDir, "chisacode-loop", { "SKILL.md": "loop-v1" });

    const status = await getSkillsStatus(sandbox.targets);

    expect(status).toEqual({ state: "up-to-date", ops: [] });
  });

  it("returns drift with a single update op when one bundled file diverges", async () => {
    await writeCurrentBundle(sandbox.targets.sourceDir);
    await writeOnDiskSkill(sandbox.targets.agentsDir, "chisacode", { "SKILL.md": "stale" });
    await writeOnDiskSkill(sandbox.targets.agentsDir, "chisacode-loop", { "SKILL.md": "loop-v1" });

    const status = await getSkillsStatus(sandbox.targets);

    expect(status.state).toBe("drift");
    expect(status.ops).toEqual([{ kind: "update", name: "chisacode" }]);
  });

  it("returns drift with add ops for the bundled skills missing from disk", async () => {
    await writeCurrentBundle(sandbox.targets.sourceDir);
    await writeOnDiskSkill(sandbox.targets.agentsDir, "chisacode", { "SKILL.md": "chisacode-v1" });

    const status = await getSkillsStatus(sandbox.targets);

    expect(status.state).toBe("drift");
    expect(status.ops).toEqual([{ kind: "add", name: "chisacode-loop" }]);
  });

  it("ignores retired skill names left on disk — diff does not touch them", async () => {
    await writeCurrentBundle(sandbox.targets.sourceDir);
    await writeOnDiskSkill(sandbox.targets.agentsDir, "chisacode", { "SKILL.md": "chisacode-v1" });
    await writeOnDiskSkill(sandbox.targets.agentsDir, "chisacode-loop", { "SKILL.md": "loop-v1" });
    await writeOnDiskSkill(sandbox.targets.agentsDir, "chisacode-chat", { "SKILL.md": "chat-old" });

    const status = await getSkillsStatus(sandbox.targets);

    expect(status.state).toBe("up-to-date");
    expect(status.ops).toEqual([]);
    expect(await pathExists(path.join(sandbox.targets.agentsDir, "chisacode-chat"))).toBe(true);
  });

  it("emits add + update ops sorted by name when state is mixed (retired names excluded)", async () => {
    await writeCurrentBundle(sandbox.targets.sourceDir);
    await writeOnDiskSkill(sandbox.targets.agentsDir, "chisacode", { "SKILL.md": "stale" });
    await writeOnDiskSkill(sandbox.targets.agentsDir, "chisacode-chat", { "SKILL.md": "chat-old" });

    const status = await getSkillsStatus(sandbox.targets);

    expect(status.state).toBe("drift");
    expect(status.ops).toEqual([
      { kind: "update", name: "chisacode" },
      { kind: "add", name: "chisacode-loop" },
    ]);
    expect(await pathExists(path.join(sandbox.targets.agentsDir, "chisacode-chat"))).toBe(true);
  });
});

describe("installSkills / updateSkills", () => {
  let sandbox: Sandbox;

  beforeEach(async () => {
    sandbox = await makeSandbox();
  });

  afterEach(async () => {
    await fs.rm(sandbox.root, { recursive: true, force: true });
  });

  it("installs from a clean machine, populates all three targets, and leaves user dirs alone", async () => {
    await writeCurrentBundle(sandbox.targets.sourceDir);
    await writeOnDiskSkill(sandbox.targets.agentsDir, "unslop", { "SKILL.md": "user-unslop" });

    const status = await installSkills(sandbox.targets);

    expect(status).toEqual({ state: "up-to-date", ops: [] });
    for (const name of ["chisacode", "chisacode-loop"]) {
      expect(
        await fs.readFile(path.join(sandbox.targets.agentsDir, name, "SKILL.md"), "utf-8"),
      ).toBe(name === "chisacode" ? "chisacode-v1" : "loop-v1");
      expect(
        await fs.readFile(path.join(sandbox.targets.codexDir, name, "SKILL.md"), "utf-8"),
      ).toBe(name === "chisacode" ? "chisacode-v1" : "loop-v1");
      expect(await pathExists(path.join(sandbox.targets.claudeDir, name))).toBe(true);
    }
    expect(
      await fs.readFile(path.join(sandbox.targets.agentsDir, "unslop", "SKILL.md"), "utf-8"),
    ).toBe("user-unslop");
  });

  it("converges to up-to-date when state has missing + edited + legacy skills", async () => {
    await writeCurrentBundle(sandbox.targets.sourceDir);
    await writeOnDiskSkill(sandbox.targets.agentsDir, "chisacode", { "SKILL.md": "stale" });
    await writeOnDiskSkill(sandbox.targets.agentsDir, "chisacode-chat", { "SKILL.md": "chat-old" });
    await writeOnDiskSkill(sandbox.targets.claudeDir, "chisacode-chat", { "SKILL.md": "chat-old" });
    await writeOnDiskSkill(sandbox.targets.codexDir, "chisacode-chat", { "SKILL.md": "chat-old" });

    const status = await updateSkills(sandbox.targets);

    expect(status).toEqual({ state: "up-to-date", ops: [] });
    expect(
      await fs.readFile(path.join(sandbox.targets.agentsDir, "chisacode", "SKILL.md"), "utf-8"),
    ).toBe("chisacode-v1");
    expect(
      await fs.readFile(
        path.join(sandbox.targets.agentsDir, "chisacode-loop", "SKILL.md"),
        "utf-8",
      ),
    ).toBe("loop-v1");
    for (const dir of [
      sandbox.targets.agentsDir,
      sandbox.targets.claudeDir,
      sandbox.targets.codexDir,
    ]) {
      expect(await pathExists(path.join(dir, "chisacode-chat"))).toBe(false);
    }
  });

  it("is idempotent — running install twice keeps state at up-to-date", async () => {
    await writeCurrentBundle(sandbox.targets.sourceDir);

    const first = await installSkills(sandbox.targets);
    const second = await installSkills(sandbox.targets);

    expect(first).toEqual({ state: "up-to-date", ops: [] });
    expect(second).toEqual({ state: "up-to-date", ops: [] });
  });
});

describe("uninstallSkills", () => {
  let sandbox: Sandbox;

  beforeEach(async () => {
    sandbox = await makeSandbox();
  });

  afterEach(async () => {
    await fs.rm(sandbox.root, { recursive: true, force: true });
  });

  it("removes every ChisaCode skill from all three targets and preserves user dirs", async () => {
    await writeCurrentBundle(sandbox.targets.sourceDir);
    await installSkills(sandbox.targets);
    for (const name of ["unslop", "tdd", "devbox"]) {
      await writeOnDiskSkill(sandbox.targets.agentsDir, name, { "SKILL.md": `user-${name}` });
    }

    const status = await uninstallSkills(sandbox.targets);

    expect(status.state).toBe("not-installed");
    for (const name of CHISACODE_SKILL_NAMES) {
      expect(await pathExists(path.join(sandbox.targets.agentsDir, name))).toBe(false);
      expect(await pathExists(path.join(sandbox.targets.claudeDir, name))).toBe(false);
      expect(await pathExists(path.join(sandbox.targets.codexDir, name))).toBe(false);
    }
    for (const name of ["unslop", "tdd", "devbox"]) {
      expect(
        await fs.readFile(path.join(sandbox.targets.agentsDir, name, "SKILL.md"), "utf-8"),
      ).toBe(`user-${name}`);
    }
  });

  it("is a no-op when nothing is installed", async () => {
    await writeCurrentBundle(sandbox.targets.sourceDir);

    const status = await uninstallSkills(sandbox.targets);

    expect(status.state).toBe("not-installed");
  });

  it("cleans up legacy skill names that linger in agents, claude, and codex", async () => {
    await writeCurrentBundle(sandbox.targets.sourceDir);
    for (const dir of [
      sandbox.targets.agentsDir,
      sandbox.targets.claudeDir,
      sandbox.targets.codexDir,
    ]) {
      await writeOnDiskSkill(dir, "chisacode-chat", { "SKILL.md": "chat-old" });
    }

    const status = await uninstallSkills(sandbox.targets);

    expect(status.state).toBe("not-installed");
    for (const dir of [
      sandbox.targets.agentsDir,
      sandbox.targets.claudeDir,
      sandbox.targets.codexDir,
    ]) {
      expect(await pathExists(path.join(dir, "chisacode-chat"))).toBe(false);
    }
  });
});

describe("cleanupRetiredSkills", () => {
  let sandbox: Sandbox;

  beforeEach(async () => {
    sandbox = await makeSandbox();
  });

  afterEach(async () => {
    await fs.rm(sandbox.root, { recursive: true, force: true });
  });

  it("removes retired skill directories from all three targets", async () => {
    for (const name of RETIRED_SKILL_NAMES) {
      await writeOnDiskSkill(sandbox.targets.agentsDir, name, { "SKILL.md": "old" });
      await writeOnDiskSkill(sandbox.targets.claudeDir, name, { "SKILL.md": "old" });
      await writeOnDiskSkill(sandbox.targets.codexDir, name, { "SKILL.md": "old" });
    }

    await cleanupRetiredSkills(sandbox.targets);

    for (const name of RETIRED_SKILL_NAMES) {
      expect(await pathExists(path.join(sandbox.targets.agentsDir, name))).toBe(false);
      expect(await pathExists(path.join(sandbox.targets.claudeDir, name))).toBe(false);
      expect(await pathExists(path.join(sandbox.targets.codexDir, name))).toBe(false);
    }
  });

  it("leaves user-installed skills and current ChisaCode skills untouched", async () => {
    await writeCurrentBundle(sandbox.targets.sourceDir);
    await installSkills(sandbox.targets);
    await writeOnDiskSkill(sandbox.targets.agentsDir, "unslop", { "SKILL.md": "user-unslop" });

    await cleanupRetiredSkills(sandbox.targets);

    // Bundle only contains chisacode and chisacode-loop in this sandbox;
    // both should still be present after retired cleanup.
    for (const name of ["chisacode", "chisacode-loop"]) {
      expect(await pathExists(path.join(sandbox.targets.agentsDir, name))).toBe(true);
    }
    expect(
      await fs.readFile(path.join(sandbox.targets.agentsDir, "unslop", "SKILL.md"), "utf-8"),
    ).toBe("user-unslop");
  });

  it("is a no-op when no retired skills are present", async () => {
    await writeCurrentBundle(sandbox.targets.sourceDir);
    await installSkills(sandbox.targets);

    await cleanupRetiredSkills(sandbox.targets);

    for (const name of ["chisacode", "chisacode-loop"]) {
      expect(await pathExists(path.join(sandbox.targets.agentsDir, name))).toBe(true);
    }
  });
});

describe("user skill installation", () => {
  let sandbox: Sandbox;

  beforeEach(async () => {
    sandbox = await makeSandbox();
  });

  afterEach(async () => {
    await fs.rm(sandbox.root, { recursive: true, force: true });
  });

  it("installs a local single skill directory into all supported user skill roots", async () => {
    const localSkillDir = path.join(sandbox.root, "local", "review");
    await writeFiles(localSkillDir, {
      "SKILL.md": "---\nname: review\n---\nReview code.",
      "references/checklist.md": "read this",
    });

    const result = await installUserSkillsFromLocalDirectory(localSkillDir, {
      targets: sandbox.targets,
      installedAt: "2026-06-18T00:00:00.000Z",
    });

    expect(result.skillNames).toEqual(["review"]);
    expect(result.installedSource).toMatchObject({
      type: "local",
      localPath: localSkillDir,
      skillNames: ["review"],
    });
    for (const dir of [
      sandbox.targets.agentsDir,
      sandbox.targets.codexDir,
      sandbox.targets.claudeDir,
    ]) {
      expect(await fs.readFile(path.join(dir, "review", "SKILL.md"), "utf-8")).toContain(
        "Review code.",
      );
      expect(
        await fs.readFile(path.join(dir, "review", "references", "checklist.md"), "utf-8"),
      ).toBe("read this");
    }
  });

  it("installs every skill directory found under a local parent directory", async () => {
    const parentDir = path.join(sandbox.root, "skill-pack");
    await writeFiles(path.join(parentDir, "review"), { "SKILL.md": "review" });
    await writeFiles(path.join(parentDir, "security-review"), { "SKILL.md": "security" });
    await writeFiles(path.join(parentDir, "notes"), { "README.md": "not a skill" });

    const result = await installUserSkillsFromLocalDirectory(parentDir, {
      targets: sandbox.targets,
      installedAt: "2026-06-18T00:00:00.000Z",
    });

    expect(result.skillNames).toEqual(["review", "security-review"]);
    expect(await pathExists(path.join(sandbox.targets.agentsDir, "review", "SKILL.md"))).toBe(true);
    expect(
      await pathExists(path.join(sandbox.targets.agentsDir, "security-review", "SKILL.md")),
    ).toBe(true);
    expect(await pathExists(path.join(sandbox.targets.agentsDir, "notes"))).toBe(false);
  });

  it("rejects a local directory that contains no SKILL.md files", async () => {
    const parentDir = path.join(sandbox.root, "empty-pack");
    await writeFiles(path.join(parentDir, "notes"), { "README.md": "not a skill" });

    await expect(
      installUserSkillsFromLocalDirectory(parentDir, {
        targets: sandbox.targets,
      }),
    ).rejects.toThrow(/No skills found/i);
  });

  it("rejects duplicate skill names unless replace is enabled", async () => {
    const localSkillDir = path.join(sandbox.root, "local", "review");
    await writeFiles(localSkillDir, { "SKILL.md": "new review" });
    await writeOnDiskSkill(sandbox.targets.agentsDir, "review", { "SKILL.md": "old review" });

    await expect(
      installUserSkillsFromLocalDirectory(localSkillDir, {
        targets: sandbox.targets,
      }),
    ).rejects.toThrow(/already exists/i);

    const result = await installUserSkillsFromLocalDirectory(localSkillDir, {
      targets: sandbox.targets,
      replace: true,
    });

    expect(result.skillNames).toEqual(["review"]);
    expect(
      await fs.readFile(path.join(sandbox.targets.agentsDir, "review", "SKILL.md"), "utf-8"),
    ).toBe("new review");
  });

  it("normalizes supported GitHub slugs and URLs", () => {
    expect(normalizeGitHubSkillSource("owner/repo")).toEqual({
      owner: "owner",
      repo: "repo",
      id: "github:owner/repo",
      url: "https://github.com/owner/repo",
      archiveUrl: "https://codeload.github.com/owner/repo/tar.gz/HEAD",
    });

    expect(normalizeGitHubSkillSource("https://github.com/Owner/Repo.git")).toMatchObject({
      owner: "Owner",
      repo: "Repo",
      id: "github:Owner/Repo",
    });

    expect(() => normalizeGitHubSkillSource("https://example.com/owner/repo")).toThrow(/GitHub/i);
  });

  it("uninstalls only skills recorded for a user installed source", async () => {
    await writeOnDiskSkill(sandbox.targets.agentsDir, "review", { "SKILL.md": "review" });
    await writeOnDiskSkill(sandbox.targets.codexDir, "review", { "SKILL.md": "review" });
    await writeOnDiskSkill(sandbox.targets.claudeDir, "review", { "SKILL.md": "review" });
    await writeOnDiskSkill(sandbox.targets.agentsDir, "project-skill", { "SKILL.md": "keep" });

    await uninstallUserInstalledSkills(["review"], {
      agentsDir: sandbox.targets.agentsDir,
      claudeDir: sandbox.targets.claudeDir,
      codexDir: sandbox.targets.codexDir,
    });

    expect(await pathExists(path.join(sandbox.targets.agentsDir, "review"))).toBe(false);
    expect(await pathExists(path.join(sandbox.targets.codexDir, "review"))).toBe(false);
    expect(await pathExists(path.join(sandbox.targets.claudeDir, "review"))).toBe(false);
    expect(
      await fs.readFile(path.join(sandbox.targets.agentsDir, "project-skill", "SKILL.md"), "utf-8"),
    ).toBe("keep");
  });
});
