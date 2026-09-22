import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import { loadConfig } from "./config.js";

const roots: string[] = [];

async function createChisaCodeHome(config: unknown): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "chisacode-config-relay-"));
  roots.push(root);
  const chisacodeHome = path.join(root, ".chisacode");
  await mkdir(chisacodeHome, { recursive: true });
  await writeFile(path.join(chisacodeHome, "config.json"), JSON.stringify(config, null, 2));
  return chisacodeHome;
}

describe("daemon relay config", () => {
  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  test("loads relay TLS from env, persisted config, and hosted relay fallback", async () => {
    const persistedHome = await createChisaCodeHome({
      version: 1,
      daemon: {
        relay: {
          endpoint: "relay.example.com:443",
          useTls: true,
        },
      },
    });
    expect(loadConfig(persistedHome, { env: {} }).relayUseTls).toBe(true);

    const envHome = await createChisaCodeHome({
      version: 1,
      daemon: {
        relay: {
          endpoint: "relay.example.com:443",
          useTls: false,
        },
      },
    });
    expect(loadConfig(envHome, { env: { CHISACODE_RELAY_USE_TLS: "true" } }).relayUseTls).toBe(
      true,
    );

    const hostedHome = await createChisaCodeHome({
      version: 1,
      daemon: { relay: {} },
    });
    expect(loadConfig(hostedHome, { env: {} }).relayUseTls).toBe(true);
  });

  test("relayPublicUseTls falls back to relayUseTls when unset", async () => {
    const home = await createChisaCodeHome({ version: 1, daemon: { relay: {} } });
    // Default: both true (hosted relay)
    expect(loadConfig(home, { env: {} }).relayPublicUseTls).toBe(true);
  });

  test("CHISACODE_RELAY_PUBLIC_USE_TLS overrides relayUseTls for public side", async () => {
    const home = await createChisaCodeHome({ version: 1, daemon: { relay: {} } });
    const config = loadConfig(home, {
      env: { CHISACODE_RELAY_USE_TLS: "false", CHISACODE_RELAY_PUBLIC_USE_TLS: "true" },
    });
    expect(config.relayUseTls).toBe(false);
    expect(config.relayPublicUseTls).toBe(true);
  });

  test("relayPublicUseTls falls back to relayUseTls when only CHISACODE_RELAY_USE_TLS is set", async () => {
    const home = await createChisaCodeHome({ version: 1, daemon: { relay: {} } });
    const config = loadConfig(home, { env: { CHISACODE_RELAY_USE_TLS: "false" } });
    expect(config.relayUseTls).toBe(false);
    expect(config.relayPublicUseTls).toBe(false);
  });

  test("persisted publicUseTls overrides relayUseTls fallback", async () => {
    const home = await createChisaCodeHome({
      version: 1,
      daemon: { relay: { useTls: false, publicUseTls: true } },
    });
    const config = loadConfig(home, { env: {} });
    expect(config.relayUseTls).toBe(false);
    expect(config.relayPublicUseTls).toBe(true);
  });
});
