#!/usr/bin/env npx tsx

import assert from "node:assert";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  resolveChisaCodeHomePath,
  resolveChisaCodeWorktreesDir,
} from "../src/commands/worktree/ls.js";

console.log("=== Worktree LS Path Helper Tests ===\n");

const originalChisaCodeHome = process.env.CHISACODE_HOME;

try {
  {
    console.log("Test 1: resolves explicit CHISACODE_HOME when set");
    process.env.CHISACODE_HOME = "/tmp/chisacode-explicit-home";

    assert.strictEqual(resolveChisaCodeHomePath(), "/tmp/chisacode-explicit-home");
    assert.strictEqual(
      resolveChisaCodeWorktreesDir(),
      join("/tmp/chisacode-explicit-home", "worktrees"),
    );
    console.log("\u2713 explicit CHISACODE_HOME is respected\n");
  }

  {
    console.log("Test 2: falls back to homedir/.chisacode when CHISACODE_HOME is unset");
    delete process.env.CHISACODE_HOME;

    assert.strictEqual(resolveChisaCodeHomePath(), join(homedir(), ".chisacode"));
    assert.strictEqual(resolveChisaCodeWorktreesDir(), join(homedir(), ".chisacode", "worktrees"));
    console.log("\u2713 fallback home path is derived from os.homedir()\n");
  }
} finally {
  if (originalChisaCodeHome === undefined) {
    delete process.env.CHISACODE_HOME;
  } else {
    process.env.CHISACODE_HOME = originalChisaCodeHome;
  }
}

console.log("=== All worktree ls path helper tests passed ===");
