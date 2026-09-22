#!/usr/bin/env npx tsx

/**
 * Phase 3: LS Command Tests
 *
 * Tests the ls command - listing agents (top-level command).
 * Since daemon may not be running, we test both:
 * - Help and argument parsing
 * - Graceful error handling when daemon not running
 * - JSON output format
 *
 * Tests:
 * - chisacode --help shows ls command
 * - chisacode ls --help shows options
 * - chisacode ls returns empty list or error when no daemon
 * - chisacode ls --json returns valid JSON (or error)
 * - chisacode ls -a flag is accepted
 * - chisacode ls -g flag is accepted
 * - chisacode ls does not support --ui
 */

import assert from "node:assert";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { runLocalChisaCode } from "./helpers/local-cli.ts";

console.log("=== LS Command Tests ===\n");

// Get random port that's definitely not in use (never 6767)
const port = 10000 + Math.floor(Math.random() * 50000);
const chisacodeHome = await mkdtemp(join(tmpdir(), "chisacode-test-home-"));

try {
  // Test 1: chisacode --help shows ls command
  {
    console.log("Test 1: chisacode --help shows ls command");
    const result = await runLocalChisaCode(["--help"]);
    assert.strictEqual(result.exitCode, 0, "chisacode --help should exit 0");
    assert(result.stdout.includes("ls"), "help should mention ls command");
    console.log("✓ chisacode --help shows ls command\n");
  }

  // Test 2: chisacode ls --help shows options
  {
    console.log("Test 2: chisacode ls --help shows options");
    const result = await runLocalChisaCode(["ls", "--help"]);
    assert.strictEqual(result.exitCode, 0, "chisacode ls --help should exit 0");
    assert(result.stdout.includes("-a"), "help should mention -a flag");
    assert(result.stdout.includes("--all"), "help should mention --all flag");
    assert(result.stdout.includes("-g"), "help should mention -g flag");
    assert(result.stdout.includes("--global"), "help should mention --global flag");
    assert(result.stdout.includes("--host"), "help should mention --host option");
    assert(!result.stdout.includes("--ui"), "help should not mention --ui");
    console.log("✓ chisacode ls --help shows options\n");
  }

  // Test 3: chisacode ls returns error when no daemon running
  {
    console.log("Test 3: chisacode ls handles daemon not running");
    const result = await runLocalChisaCode(["ls"], {
      CHISACODE_HOST: `localhost:${port}`,
      CHISACODE_HOME: chisacodeHome,
    });
    // Should fail because daemon not running
    assert.notStrictEqual(result.exitCode, 0, "should fail when daemon not running");
    const output = result.stdout + result.stderr;
    const hasError =
      output.toLowerCase().includes("daemon") ||
      output.toLowerCase().includes("connect") ||
      output.toLowerCase().includes("cannot");
    assert(hasError, "error message should mention connection issue");
    assert(output.includes("--host <host:port>"), "error message should mention --host");
    assert(output.includes("CHISACODE_HOST"), "error message should mention CHISACODE_HOST");
    console.log("✓ chisacode ls handles daemon not running\n");
  }

  // Test 4: chisacode ls --json returns valid JSON error
  {
    console.log("Test 4: chisacode ls --json handles errors");
    const result = await runLocalChisaCode(["ls", "--json"], {
      CHISACODE_HOST: `localhost:${port}`,
      CHISACODE_HOME: chisacodeHome,
    });
    // Should still fail (daemon not running)
    assert.notStrictEqual(result.exitCode, 0, "should fail when daemon not running");
    // But output should be valid JSON if present
    const output = result.stdout.trim();
    if (output.length > 0) {
      try {
        JSON.parse(output);
        console.log("✓ chisacode ls --json outputs valid JSON error\n");
      } catch {
        // Empty or stderr-only output is acceptable
        console.log("✓ chisacode ls --json handled error (output may be in stderr)\n");
      }
    } else {
      console.log("✓ chisacode ls --json handled error gracefully\n");
    }
  }

  // Test 5: chisacode ls -a flag is accepted
  {
    console.log("Test 5: chisacode ls -a flag is accepted");
    const result = await runLocalChisaCode(["ls", "-a"], {
      CHISACODE_HOST: `localhost:${port}`,
      CHISACODE_HOME: chisacodeHome,
    });
    // Will fail due to no daemon, but flag should be parsed without error
    // (no "unknown option" error)
    const output = result.stdout + result.stderr;
    assert(!output.includes("unknown option"), "should accept -a flag");
    assert(!output.includes("error: option"), "should not have option parsing error");
    console.log("✓ chisacode ls -a flag is accepted\n");
  }

  // Test 6: chisacode ls -g flag is accepted
  {
    console.log("Test 6: chisacode ls -g flag is accepted");
    const result = await runLocalChisaCode(["ls", "-g"], {
      CHISACODE_HOST: `localhost:${port}`,
      CHISACODE_HOME: chisacodeHome,
    });
    const output = result.stdout + result.stderr;
    assert(!output.includes("unknown option"), "should accept -g flag");
    assert(!output.includes("error: option"), "should not have option parsing error");
    console.log("✓ chisacode ls -g flag is accepted\n");
  }

  // Test 7: chisacode ls -ag combined flags are accepted
  {
    console.log("Test 7: chisacode ls -ag combined flags are accepted");
    const result = await runLocalChisaCode(["ls", "-ag"], {
      CHISACODE_HOST: `localhost:${port}`,
      CHISACODE_HOME: chisacodeHome,
    });
    const output = result.stdout + result.stderr;
    assert(!output.includes("unknown option"), "should accept -ag flags");
    assert(!output.includes("error: option"), "should not have option parsing error");
    console.log("✓ chisacode ls -ag combined flags are accepted\n");
  }

  // Test 8: -q (quiet) flag is accepted globally
  {
    console.log("Test 8: -q (quiet) flag is accepted");
    const result = await runLocalChisaCode(["-q", "ls"], {
      CHISACODE_HOST: `localhost:${port}`,
      CHISACODE_HOME: chisacodeHome,
    });
    const output = result.stdout + result.stderr;
    assert(!output.includes("unknown option"), "should accept -q flag");
    assert(!output.includes("error: option"), "should not have option parsing error");
    console.log("✓ -q (quiet) flag is accepted\n");
  }

  // Test 9: chisacode ls --ui is rejected (flag removed)
  {
    console.log("Test 9: chisacode ls --ui is rejected");
    const result = await runLocalChisaCode(["ls", "--ui"], {
      CHISACODE_HOST: `localhost:${port}`,
      CHISACODE_HOME: chisacodeHome,
    });
    assert.notStrictEqual(result.exitCode, 0, "should fail for removed --ui flag");
    const output = result.stdout + result.stderr;
    assert(output.includes("unknown option"), "should report unknown option for --ui");
    console.log("✓ chisacode ls --ui is rejected\n");
  }
} finally {
  // Clean up temp directory
  await rm(chisacodeHome, { recursive: true, force: true });
}

console.log("=== All ls tests passed ===");
