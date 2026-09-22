#!/usr/bin/env npx zx

/**
 * Phase 1: Foundation Tests
 *
 * Tests basic CLI functionality that doesn't require a daemon:
 * - chisacode --version outputs version
 * - chisacode --help shows commands
 */

import { $ } from "zx";
import { installZxWindowsPathCompat } from "./helpers/zx-path-compat.ts";
installZxWindowsPathCompat();

$.verbose = false;

console.log("📋 Phase 1: Foundation Tests\n");

// Test 1.1: --version outputs version
console.log("  Testing chisacode --version...");
const versionResult = await $`chisacode --version`.nothrow();
if (versionResult.exitCode !== 0) {
  console.error("  ❌ chisacode --version failed with exit code", versionResult.exitCode);
  console.error("     stderr:", versionResult.stderr);
  process.exit(1);
}
const versionOutput = versionResult.stdout.trim();
if (!versionOutput.match(/\d+\.\d+\.\d+/)) {
  console.error("  ❌ chisacode --version output does not contain version number");
  console.error("     output:", versionOutput);
  process.exit(1);
}
console.log("  ✅ chisacode --version outputs:", versionOutput);

// Test 1.2: --help shows commands
console.log("  Testing chisacode --help...");
const helpResult = await $`chisacode --help`.nothrow();
if (helpResult.exitCode !== 0) {
  console.error("  ❌ chisacode --help failed with exit code", helpResult.exitCode);
  console.error("     stderr:", helpResult.stderr);
  process.exit(1);
}
const helpOutput = helpResult.stdout;

// Check for expected sections in help output
const expectedTerms = ["agent", "daemon", "Usage", "Options", "Commands"];
const missingTerms = expectedTerms.filter((term) => !helpOutput.includes(term));
if (missingTerms.length > 0) {
  console.error("  ❌ chisacode --help missing expected terms:", missingTerms.join(", "));
  console.error("     output:", helpOutput);
  process.exit(1);
}
console.log("  ✅ chisacode --help shows commands");

console.log("\n✅ Phase 1: Foundation Tests PASSED");
