import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  createWorktree as createWorktreePrimitive,
  deriveWorktreeProjectHash,
  deleteChisaCodeWorktree,
  isChisaCodeOwnedWorktreeCwd,
  runWorktreeSetupCommands,
  slugify,
  type CreateWorktreeOptions,
  type WorktreeConfig,
} from "./worktree";
import { execFileSync } from "child_process";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  existsSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "fs";
import { join } from "path";
import { tmpdir } from "os";

interface LegacyCreateWorktreeTestOptions {
  branchName: string;
  cwd: string;
  baseBranch: string;
  worktreeSlug: string;
  runSetup?: boolean;
  chisacodeHome?: string;
}

function createLegacyWorktreeForTest(
  options: CreateWorktreeOptions | LegacyCreateWorktreeTestOptions,
): Promise<WorktreeConfig> {
  if ("source" in options) {
    return createWorktreePrimitive(options);
  }

  return createWorktreePrimitive({
    cwd: options.cwd,
    worktreeSlug: options.worktreeSlug,
    source: {
      kind: "branch-off",
      baseBranch: options.baseBranch,
      branchName: options.branchName,
    },
    runSetup: options.runSetup ?? true,
    chisacodeHome: options.chisacodeHome,
  });
}

describe("chisacode worktree manager", () => {
  let tempDir: string;
  let repoDir: string;
  let chisacodeHome: string;

  beforeEach(() => {
    tempDir = realpathSync(mkdtempSync(join(tmpdir(), "worktree-manager-test-")));
    repoDir = join(tempDir, "test-repo");
    chisacodeHome = join(tempDir, "chisacode-home");

    mkdirSync(repoDir, { recursive: true });
    execFileSync("git", ["init", "-b", "main"], { cwd: repoDir });
    execFileSync("git", ["config", "user.email", "test@test.com"], { cwd: repoDir });
    execFileSync("git", ["config", "user.name", "Test"], { cwd: repoDir });
    writeFileSync(join(repoDir, "file.txt"), "hello\n");
    execFileSync("git", ["add", "."], { cwd: repoDir });
    execFileSync("git", ["-c", "commit.gpgsign=false", "commit", "-m", "initial"], {
      cwd: repoDir,
    });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("treats a worktree as chisacode-owned even when its .git admin is missing", async () => {
    const created = await createLegacyWorktreeForTest({
      branchName: "orphan-admin-branch",
      cwd: repoDir,
      baseBranch: "main",
      worktreeSlug: "orphan-admin",
      chisacodeHome,
    });

    // Simulate a previous archive attempt that removed git's admin dir but left
    // the working tree on disk (e.g. because file churn prevented full cleanup).
    rmSync(join(repoDir, ".git", "worktrees", "orphan-admin"), {
      recursive: true,
      force: true,
    });
    expect(existsSync(created.worktreePath)).toBe(true);

    const ownership = await isChisaCodeOwnedWorktreeCwd(created.worktreePath, { chisacodeHome });
    expect(ownership.allowed).toBe(true);
  });

  it("rejects paths that are not under the chisacode worktrees root", async () => {
    const outsidePath = join(tempDir, "outside-chisacode-home");
    mkdirSync(outsidePath, { recursive: true });

    const ownership = await isChisaCodeOwnedWorktreeCwd(outsidePath, { chisacodeHome });

    expect(ownership.allowed).toBe(false);
  });

  it("rejects the worktrees root itself and the per-repo hash dir", async () => {
    const projectHash = await deriveWorktreeProjectHash(repoDir);
    const worktreesRoot = join(chisacodeHome, "worktrees");
    const projectHashDir = join(worktreesRoot, projectHash);
    mkdirSync(projectHashDir, { recursive: true });

    await expect(
      isChisaCodeOwnedWorktreeCwd(worktreesRoot, { chisacodeHome }),
    ).resolves.toMatchObject({
      allowed: false,
    });
    await expect(
      isChisaCodeOwnedWorktreeCwd(projectHashDir, { chisacodeHome }),
    ).resolves.toMatchObject({
      allowed: false,
    });
  });

  it("preserves a worktree whose .git admin dir has already been removed", async () => {
    const created = await createLegacyWorktreeForTest({
      branchName: "orphan-delete-branch",
      cwd: repoDir,
      baseBranch: "main",
      worktreeSlug: "orphan-delete",
      chisacodeHome,
    });

    rmSync(join(repoDir, ".git", "worktrees", "orphan-delete"), {
      recursive: true,
      force: true,
    });
    expect(existsSync(created.worktreePath)).toBe(true);

    writeFileSync(join(created.worktreePath, "recovery.txt"), "preserve me\n");

    await expect(
      deleteChisaCodeWorktree({
        cwd: repoDir,
        worktreePath: created.worktreePath,
        chisacodeHome,
      }),
    ).rejects.toThrow();

    expect(readFileSync(join(created.worktreePath, "recovery.txt"), "utf8")).toBe("preserve me\n");
  });

  it("is idempotent: deleting an already-absent worktree succeeds", async () => {
    const created = await createLegacyWorktreeForTest({
      branchName: "idempotent-delete-branch",
      cwd: repoDir,
      baseBranch: "main",
      worktreeSlug: "idempotent-delete",
      chisacodeHome,
    });

    await deleteChisaCodeWorktree({
      cwd: repoDir,
      worktreePath: created.worktreePath,
      chisacodeHome,
    });
    expect(existsSync(created.worktreePath)).toBe(false);

    // Second call — nothing left on disk and no admin entry — must not throw.
    await expect(
      deleteChisaCodeWorktree({ cwd: repoDir, worktreePath: created.worktreePath, chisacodeHome }),
    ).resolves.toBeUndefined();
  });

  it("preserves a worktree when the parent repo root is not available", async () => {
    const created = await createLegacyWorktreeForTest({
      branchName: "no-cwd-branch",
      cwd: repoDir,
      baseBranch: "main",
      worktreeSlug: "no-cwd",
      chisacodeHome,
    });

    const ownership = await isChisaCodeOwnedWorktreeCwd(created.worktreePath, { chisacodeHome });
    expect(ownership.allowed).toBe(true);
    expect(ownership.worktreeRoot).toBeTruthy();

    // Simulate the handler path when git has forgotten about the worktree:
    // caller forwards the path-derived worktreesRoot from the ownership check.
    writeFileSync(join(created.worktreePath, "recovery.txt"), "preserve me\n");
    await expect(
      deleteChisaCodeWorktree({
        cwd: null,
        worktreePath: created.worktreePath,
        worktreesRoot: ownership.worktreeRoot,
        chisacodeHome,
      }),
    ).rejects.toThrow("preserved for recovery");

    expect(readFileSync(join(created.worktreePath, "recovery.txt"), "utf8")).toBe("preserve me\n");
  });

  it("preserves untracked content instead of escalating to force", async () => {
    const created = await createLegacyWorktreeForTest({
      branchName: "dirty-delete-branch",
      cwd: repoDir,
      baseBranch: "main",
      worktreeSlug: "dirty-delete",
      chisacodeHome,
    });
    writeFileSync(join(created.worktreePath, "untracked.txt"), "user data\n");

    await expect(
      deleteChisaCodeWorktree({
        cwd: repoDir,
        worktreePath: created.worktreePath,
        chisacodeHome,
      }),
    ).rejects.toThrow();

    expect(readFileSync(join(created.worktreePath, "untracked.txt"), "utf8")).toBe("user data\n");
  });

  it("preserves setup output for recovery on every platform", async () => {
    const created = await createLegacyWorktreeForTest({
      branchName: "setup-recovery-branch",
      cwd: repoDir,
      baseBranch: "main",
      worktreeSlug: "setup-recovery",
      runSetup: false,
      chisacodeHome,
    });
    const setupCommand =
      "node -e \"require('node:fs').writeFileSync('recovery.txt','user output');process.exit(1)\"";
    writeFileSync(
      join(created.worktreePath, "chisacode.json"),
      JSON.stringify({ worktree: { setup: [setupCommand] } }),
    );

    await expect(
      runWorktreeSetupCommands({
        worktreePath: created.worktreePath,
        branchName: created.branchName,
        cleanupOnFailure: true,
        repoRootPath: repoDir,
      }),
    ).rejects.toThrow("Worktree preserved for recovery");

    expect(readFileSync(join(created.worktreePath, "recovery.txt"), "utf8")).toBe("user output");
  });
});

describe("slugify", () => {
  function expectValidHostnameLabel(label: string): void {
    expect(label.length).toBeGreaterThan(0);
    expect(label.length).toBeLessThanOrEqual(63);
    expect(label).toMatch(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/);
  }

  it("converts to lowercase kebab-case", () => {
    expect(slugify("Hello World")).toBe("hello-world");
    expect(slugify("FOO_BAR")).toBe("foo-bar");
    expect(slugify("My GREAT App")).toBe("my-great-app");
  });

  it("replaces dots with hyphens", () => {
    expect(slugify("my.app")).toBe("my-app");
    expect(slugify("v1.2.3")).toBe("v1-2-3");
  });

  it("collapses multiple consecutive spaces to one hyphen", () => {
    expect(slugify("feature   cool    stuff")).toBe("feature-cool-stuff");
  });

  it("replaces slashes with hyphens", () => {
    expect(slugify("feature/cool stuff")).toBe("feature-cool-stuff");
    expect(slugify("owner/repo")).toBe("owner-repo");
  });

  it("strips unsupported unicode characters", () => {
    expect(slugify("café")).toBe("caf");
    expect(slugify("日本語")).toBe("");
  });

  it("removes leading and trailing punctuation", () => {
    expect(slugify("-foo-")).toBe("foo");
    expect(slugify("__bar__")).toBe("bar");
    expect(slugify(".baz.")).toBe("baz");
  });

  it("truncates long strings at word boundary", () => {
    const longInput =
      "https-stackoverflow-com-questions-68349031-only-run-actions-on-non-draft-pull-request";
    const result = slugify(longInput);
    expect(result.length).toBeLessThanOrEqual(50);
    expectValidHostnameLabel(result);
    expect(result).toBe("https-stackoverflow-com-questions-68349031-only");
  });

  it("truncates without trailing hyphen when no word boundary", () => {
    const longInput = "a".repeat(60);
    const result = slugify(longInput);
    expect(result.length).toBe(50);
    expect(result.endsWith("-")).toBe(false);
    expectValidHostnameLabel(result);
  });

  it("keeps very long names within the hostname label length limit", () => {
    const result = slugify("Beta Build ".repeat(12));

    expect(result.length).toBeLessThanOrEqual(63);
    expectValidHostnameLabel(result);
  });

  it("returns empty when names collapse to empty", () => {
    expect(slugify("---")).toBe("");
    expect(slugify("***")).toBe("");
    expect(slugify("日本語")).toBe("");
  });

  it("is idempotent for representative inputs", () => {
    const inputs = [
      "my.app",
      "feature/cool stuff",
      "  Café Launch  ",
      "__bar__",
      "Beta Build ".repeat(12),
      "release***candidate",
    ];

    for (const input of inputs) {
      const slug = slugify(input);
      expect(slugify(slug)).toBe(slug);
    }
  });
});
