#!/usr/bin/env npx tsx

import assert from "node:assert";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "zx";
import { installZxWindowsPathCompat } from "./helpers/zx-path-compat.ts";
installZxWindowsPathCompat();
import { getAvailablePort } from "./helpers/network.ts";

$.verbose = false;

console.log("=== Onboarding Command ===\n");

const chisacodeHome = await mkdtemp(join(tmpdir(), "chisacode-onboard-home-"));
const port = await getAvailablePort();

try {
  console.log("Test 1: `chisacode` runs blocking onboarding and prints pairing info");
  const onboard =
    await $`CHISACODE_HOME=${chisacodeHome} CHISACODE_LISTEN=127.0.0.1:${port} CHISACODE_PAIRING_QR=0 npx chisacode`.nothrow();

  assert.strictEqual(
    onboard.exitCode,
    0,
    `onboard should succeed:\nstdout:\n${onboard.stdout}\nstderr:\n${onboard.stderr}`,
  );
  assert(
    onboard.stdout.includes("Scan to pair") || onboard.stdout.includes("扫码配对"),
    "onboard output should include scan header",
  );
  assert(
    onboard.stdout.includes("Pairing link") || onboard.stdout.includes("配对链接"),
    "onboard output should include pairing link header",
  );
  assert(onboard.stdout.includes("#offer="), "onboard output should include pairing offer URL");
  assert(
    onboard.stdout.includes("CLI quick reference") || onboard.stdout.includes("CLI 快速参考"),
    "onboard output should include CLI quick reference",
  );
  assert(
    onboard.stdout.includes("chisacode --help"),
    "onboard output should include --help shortcut",
  );
  assert(onboard.stdout.includes("chisacode ls"), "onboard output should include ls shortcut");
  assert(
    onboard.stdout.includes('chisacode run "your prompt"'),
    "onboard output should include run shortcut",
  );
  assert(
    onboard.stdout.includes("chisacode status"),
    "onboard output should include status shortcut",
  );
  assert(
    onboard.stdout.includes(join(chisacodeHome, "daemon.log")),
    "onboard output should include daemon log path",
  );

  const status =
    await $`CHISACODE_HOME=${chisacodeHome} npx chisacode daemon status --home ${chisacodeHome}`.nothrow();
  assert.strictEqual(status.exitCode, 0, `daemon status should succeed: ${status.stderr}`);
  assert(status.stdout.includes("running"), "daemon should be running when onboarding exits");
  console.log("✓ onboarding prints pairing info and waits for daemon readiness\n");

  console.log("Test 2: non-interactive onboarding persists voice disabled config");
  const configRaw = await readFile(join(chisacodeHome, "config.json"), "utf-8");
  const config = JSON.parse(configRaw) as {
    features?: {
      dictation?: { enabled?: boolean };
      voiceMode?: { enabled?: boolean };
    };
  };

  assert.strictEqual(
    config.features?.dictation?.enabled,
    false,
    "dictation.enabled should be false",
  );
  assert.strictEqual(
    config.features?.voiceMode?.enabled,
    false,
    "voiceMode.enabled should be false",
  );
  const daemonLog = await readFile(join(chisacodeHome, "daemon.log"), "utf-8");
  assert(
    !daemonLog.includes("Ensuring local speech models"),
    "daemon should not attempt local speech model setup when voice is disabled",
  );
  console.log("✓ non-interactive run persisted voice disabled choices\n");
} finally {
  await $`CHISACODE_HOME=${chisacodeHome} npx chisacode daemon stop --home ${chisacodeHome} --force`.nothrow();
  await rm(chisacodeHome, { recursive: true, force: true });
}

console.log("=== Onboarding tests passed ===");
