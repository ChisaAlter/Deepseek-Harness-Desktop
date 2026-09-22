import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isPlatform } from "../test-utils/platform.js";
import { getWorktreeSetupCommands, getWorktreeTeardownCommands } from "./worktree.js";
import {
  readChisaCodeConfigForEdit,
  statChisaCodeConfigPath,
  writeChisaCodeConfigForEdit,
} from "./chisacode-config-file.js";

describe("chisacode config file substrate", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = realpathSync(mkdtempSync(join(tmpdir(), "chisacode-config-file-test-")));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("returns null config and revision when project config is missing", () => {
    const result = readChisaCodeConfigForEdit(tempDir);

    expect(result).toEqual({ ok: true, config: null, revision: null });
  });

  it("returns invalid_project_config for invalid chisacode.json", () => {
    writeFileSync(join(tempDir, "chisacode.json"), "{ invalid json\n");

    const result = readChisaCodeConfigForEdit(tempDir);

    expect(result).toEqual({
      ok: false,
      error: { code: "invalid_project_config" },
    });
  });

  it("falls back to legacy chisacode.json when chisacode.json is missing", () => {
    writeFileSync(
      join(tempDir, "chisacode.json"),
      JSON.stringify({ worktree: { setup: "npm ci" } }),
    );

    const result = readChisaCodeConfigForEdit(tempDir);

    expect(result).toEqual({
      ok: true,
      config: { worktree: { setup: "npm ci" } },
      revision: statChisaCodeConfigPath(tempDir),
    });
  });

  it("prefers chisacode.json when both config files exist", () => {
    writeFileSync(join(tempDir, "chisacode.json"), JSON.stringify({ worktree: { setup: "old" } }));
    writeFileSync(join(tempDir, "chisacode.json"), JSON.stringify({ worktree: { setup: "new" } }));

    const result = readChisaCodeConfigForEdit(tempDir);

    expect(result).toEqual({
      ok: true,
      config: { worktree: { setup: "new" } },
      revision: statChisaCodeConfigPath(tempDir),
    });
  });

  it("preserves raw lifecycle string and array forms with a revision token", () => {
    writeFileSync(
      join(tempDir, "chisacode.json"),
      JSON.stringify({
        worktree: {
          setup: "npm install",
          teardown: ["npm run clean", "npm run reset"],
        },
      }),
    );

    const result = readChisaCodeConfigForEdit(tempDir);

    expect(result).toEqual({
      ok: true,
      config: {
        worktree: {
          setup: "npm install",
          teardown: ["npm run clean", "npm run reset"],
        },
      },
      revision: statChisaCodeConfigPath(tempDir),
    });
  });

  it("keeps runtime lifecycle commands normalized for execution", () => {
    writeFileSync(
      join(tempDir, "chisacode.json"),
      JSON.stringify({
        worktree: {
          setup: "npm install",
          teardown: ["npm run clean", "", 42, "npm run reset"],
        },
      }),
    );

    expect(getWorktreeSetupCommands(tempDir)).toEqual(["npm install"]);
    expect(getWorktreeTeardownCommands(tempDir)).toEqual(["npm run clean", "npm run reset"]);
  });

  it("writes pretty JSON with a trailing newline when revision matches", () => {
    writeFileSync(join(tempDir, "chisacode.json"), JSON.stringify({ worktree: { setup: "old" } }));
    const expectedRevision = statChisaCodeConfigPath(tempDir);

    const result = writeChisaCodeConfigForEdit({
      repoRoot: tempDir,
      config: { worktree: { setup: "npm install" } },
      expectedRevision,
    });

    expect(result).toEqual({
      ok: true,
      config: { worktree: { setup: "npm install" } },
      revision: statChisaCodeConfigPath(tempDir),
    });
    expect(readFileSync(join(tempDir, "chisacode.json"), "utf8")).toBe(
      '{\n  "worktree": {\n    "setup": "npm install"\n  }\n}\n',
    );
  });

  it("writes legacy chisacode.json when it is the only existing config file", () => {
    writeFileSync(join(tempDir, "chisacode.json"), JSON.stringify({ worktree: { setup: "old" } }));
    const expectedRevision = statChisaCodeConfigPath(tempDir);

    const result = writeChisaCodeConfigForEdit({
      repoRoot: tempDir,
      config: { worktree: { setup: "npm install" } },
      expectedRevision,
    });

    expect(result).toEqual({
      ok: true,
      config: { worktree: { setup: "npm install" } },
      revision: statChisaCodeConfigPath(tempDir),
    });
    expect(readFileSync(join(tempDir, "chisacode.json"), "utf8")).toBe(
      '{\n  "worktree": {\n    "setup": "npm install"\n  }\n}\n',
    );
  });

  // POSIX-only: Windows mtime granularity can collapse the two revisions in this fixture.
  it.skipIf(isPlatform("win32"))(
    "rejects stale writes when the current revision changed before rename",
    () => {
      writeFileSync(
        join(tempDir, "chisacode.json"),
        JSON.stringify({ worktree: { setup: "old" } }),
      );
      const expectedRevision = statChisaCodeConfigPath(tempDir);
      writeFileSync(
        join(tempDir, "chisacode.json"),
        JSON.stringify({ worktree: { setup: "new" } }),
      );
      const currentRevision = statChisaCodeConfigPath(tempDir);

      const result = writeChisaCodeConfigForEdit({
        repoRoot: tempDir,
        config: { worktree: { setup: "from editor" } },
        expectedRevision,
      });

      expect(result).toEqual({
        ok: false,
        error: { code: "stale_project_config", currentRevision },
      });
      expect(readFileSync(join(tempDir, "chisacode.json"), "utf8")).toBe(
        JSON.stringify({ worktree: { setup: "new" } }),
      );
    },
  );

  it("round-trips unknown top-level, worktree, and script-entry fields", () => {
    const config = {
      extraTop: { keep: true },
      worktree: {
        setup: ["npm install"],
        customWorktreeField: "preserve me",
      },
      scripts: {
        dev: {
          command: "npm run dev",
          type: "service",
          customScriptField: 123,
        },
      },
    };

    const result = writeChisaCodeConfigForEdit({
      repoRoot: tempDir,
      config,
      expectedRevision: null,
    });

    expect(result).toEqual({
      ok: true,
      config,
      revision: statChisaCodeConfigPath(tempDir),
    });
    expect(readChisaCodeConfigForEdit(tempDir)).toEqual({
      ok: true,
      config,
      revision: statChisaCodeConfigPath(tempDir),
    });
  });

  it("returns write_failed for filesystem write exceptions", () => {
    const fileRoot = join(tempDir, "not-a-directory");
    writeFileSync(fileRoot, "file");

    const result = writeChisaCodeConfigForEdit({
      repoRoot: fileRoot,
      config: { worktree: { setup: "npm install" } },
      expectedRevision: null,
    });

    expect(result).toEqual({
      ok: false,
      error: { code: "write_failed" },
    });
  });

  it("creates chisacode.json when the file is still missing and expected revision is null", () => {
    mkdirSync(join(tempDir, "nested"));

    const result = writeChisaCodeConfigForEdit({
      repoRoot: join(tempDir, "nested"),
      config: { scripts: { dev: { command: "npm run dev" } } },
      expectedRevision: null,
    });

    expect(result).toEqual({
      ok: true,
      config: { scripts: { dev: { command: "npm run dev" } } },
      revision: statChisaCodeConfigPath(join(tempDir, "nested")),
    });
    expect(readFileSync(join(tempDir, "nested", "chisacode.json"), "utf8")).toBe(
      '{\n  "scripts": {\n    "dev": {\n      "command": "npm run dev"\n    }\n  }\n}\n',
    );
  });
});
