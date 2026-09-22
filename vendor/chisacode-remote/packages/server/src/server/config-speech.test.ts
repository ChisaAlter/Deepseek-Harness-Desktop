import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import { loadConfig } from "./config.js";

const roots: string[] = [];

async function createChisaCodeHome(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "chisacode-config-speech-"));
  roots.push(root);
  const chisacodeHome = path.join(root, ".chisacode");
  await mkdir(chisacodeHome, { recursive: true });
  return chisacodeHome;
}

describe("daemon speech config", () => {
  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  test("passes MiMo TTS config through daemon config", async () => {
    const chisacodeHome = await createChisaCodeHome();

    const config = loadConfig(chisacodeHome, {
      env: {
        CHISACODE_VOICE_TTS_PROVIDER: "mimo",
        MIMO_API_KEY: "test-mimo-key",
        MIMO_BASE_URL: "https://mimo.example/v1/",
        MIMO_TTS_MODEL: "mimo-v2.5-tts",
        MIMO_TTS_VOICE: "mimo_default",
      },
    });

    expect(config.speech?.providers.voiceTts).toEqual({
      provider: "mimo",
      explicit: true,
      enabled: true,
    });
    expect(config.mimo).toEqual({
      apiKey: "test-mimo-key",
      baseUrl: "https://mimo.example/v1",
      tts: {
        model: "mimo-v2.5-tts",
        voice: "mimo_default",
        responseFormat: "pcm",
      },
    });
  });
});
