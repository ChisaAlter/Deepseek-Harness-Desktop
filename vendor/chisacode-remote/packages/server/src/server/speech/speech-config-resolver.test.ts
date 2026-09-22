import path from "node:path";

import { describe, expect, test } from "vitest";

import { PersistedConfigSchema } from "../persisted-config.js";
import { resolveSpeechConfig } from "./speech-config-resolver.js";

describe("resolveSpeechConfig", () => {
  test("does not resolve MiMo config from a removed environment alias", () => {
    const removedApiKeyName = ["MIMO", "CODE_API_KEY"].join("");
    const env = { [removedApiKeyName]: "removed-key" } as NodeJS.ProcessEnv;
    const result = resolveSpeechConfig({
      chisacodeHome: "/tmp/chisacode-home",
      env,
      persisted: PersistedConfigSchema.parse({}),
    });

    expect(result.mimo).toBeUndefined();
  });

  test("resolves local-first defaults without env overrides", () => {
    const chisacodeHome = "/tmp/chisacode-home";
    const persisted = PersistedConfigSchema.parse({});
    const env = {} as NodeJS.ProcessEnv;

    const result = resolveSpeechConfig({
      chisacodeHome,
      env,
      persisted,
    });

    expect(result.openai).toBeUndefined();
    expect(result.mimo).toBeUndefined();
    expect(result.speech.providers.dictationStt).toEqual({
      provider: "local",
      explicit: false,
      enabled: true,
    });
    expect(result.speech.providers.voiceTurnDetection).toEqual({
      provider: "local",
      explicit: false,
      enabled: true,
    });
    expect(result.speech.providers.voiceStt).toEqual({
      provider: "local",
      explicit: false,
      enabled: true,
    });
    expect(result.speech.providers.voiceTts).toEqual({
      provider: "local",
      explicit: false,
      enabled: true,
    });
    expect(result.speech.local).toEqual({
      modelsDir: path.join(chisacodeHome, "models", "local-speech"),
      models: {
        dictationStt: "parakeet-tdt-0.6b-v2-int8",
        voiceStt: "parakeet-tdt-0.6b-v2-int8",
        voiceTts: "kokoro-en-v0_19",
        voiceTtsSpeakerId: 0,
      },
    });
    expect(result.speech.local?.models.dictationStt).toBe("parakeet-tdt-0.6b-v2-int8");
    expect(result.speech.local?.models.voiceStt).toBe("parakeet-tdt-0.6b-v2-int8");
    expect(result.speech.local?.models.voiceTts).toBe("kokoro-en-v0_19");
    expect(result.speech.local?.models.voiceTtsSpeakerId).toBe(0);
    expect(result.speech.sttLanguages).toEqual({
      dictation: "en",
      voice: "en",
    });
  });

  test("resolves feature-scoped local speech settings", () => {
    const persisted = PersistedConfigSchema.parse({
      features: {
        voiceMode: {
          turnDetection: { provider: "local" },
          stt: { provider: "openai", model: "gpt-4o-transcribe" },
        },
      },
      providers: {
        openai: { apiKey: "persisted-key" },
      },
    });
    const env = {
      CHISACODE_DICTATION_LOCAL_STT_MODEL: "parakeet-tdt-0.6b-v2-int8",
      CHISACODE_VOICE_LOCAL_STT_MODEL: "parakeet-tdt-0.6b-v2-int8",
      CHISACODE_VOICE_LOCAL_TTS_MODEL: "kokoro-en-v0_19",
      CHISACODE_VOICE_LOCAL_TTS_SPEAKER_ID: "5",
      CHISACODE_VOICE_LOCAL_TTS_SPEED: "1.35",
      CHISACODE_DICTATION_LANGUAGE: "es",
      CHISACODE_VOICE_LANGUAGE: "pt",
      CHISACODE_LOCAL_MODELS_DIR: "/tmp/models",
      OPENAI_API_KEY: "env-key",
      CHISACODE_VOICE_STT_PROVIDER: "openai",
      CHISACODE_DICTATION_STT_PROVIDER: "local",
      CHISACODE_VOICE_TTS_PROVIDER: "local",
    } as NodeJS.ProcessEnv;

    const result = resolveSpeechConfig({
      chisacodeHome: "/tmp/chisacode-home",
      env,
      persisted,
    });

    expect(result.speech.local).toEqual({
      modelsDir: "/tmp/models",
      models: {
        dictationStt: "parakeet-tdt-0.6b-v2-int8",
        voiceStt: "parakeet-tdt-0.6b-v2-int8",
        voiceTts: "kokoro-en-v0_19",
        voiceTtsSpeakerId: 5,
        voiceTtsSpeed: 1.35,
      },
    });
    expect(result.speech.providers.dictationStt).toEqual({
      provider: "local",
      explicit: true,
      enabled: true,
    });
    expect(result.speech.providers.voiceStt).toEqual({
      provider: "openai",
      explicit: true,
      enabled: true,
    });
    expect(result.speech.providers.voiceTurnDetection).toEqual({
      provider: "local",
      explicit: true,
      enabled: true,
    });
    expect(result.speech.providers.voiceTts).toEqual({
      provider: "local",
      explicit: true,
      enabled: true,
    });
    expect(result.speech.local?.models.dictationStt).toBe("parakeet-tdt-0.6b-v2-int8");
    expect(result.speech.local?.models.voiceStt).toBe("parakeet-tdt-0.6b-v2-int8");
    expect(result.speech.local?.models.voiceTts).toBe("kokoro-en-v0_19");
    expect(result.speech.local?.models.voiceTtsSpeakerId).toBe(5);
    expect(result.speech.local?.models.voiceTtsSpeed).toBe(1.35);
    expect(result.speech.sttLanguages).toEqual({
      dictation: "es",
      voice: "pt",
    });
    expect(result.openai?.apiKey).toBe("env-key");
    expect(result.openai?.stt?.model).toBe("gpt-4o-transcribe");
  });

  test("resolves MiMo TTS settings for voice mode", () => {
    const persisted = PersistedConfigSchema.parse({
      providers: {
        mimo: {
          apiKey: "persisted-mimo-key",
          baseUrl: "https://persisted.example/v1/",
        },
      },
      features: {
        voiceMode: {
          tts: {
            provider: "mimo",
            model: "persisted-tts-model",
            voice: "mimo_default",
          },
        },
      },
    });

    const result = resolveSpeechConfig({
      chisacodeHome: "/tmp/chisacode-home",
      env: {
        CHISACODE_VOICE_TTS_PROVIDER: "mimo",
        MIMO_API_KEY: "env-mimo-key",
        MIMO_BASE_URL: "https://env.example/v1/",
        MIMO_TTS_MODEL: "env-tts-model",
        MIMO_TTS_VOICE: "env-voice",
      } as NodeJS.ProcessEnv,
      persisted,
    });

    expect(result.speech.providers.voiceTts).toEqual({
      provider: "mimo",
      explicit: true,
      enabled: true,
    });
    expect(result.mimo).toEqual({
      apiKey: "env-mimo-key",
      baseUrl: "https://env.example/v1",
      tts: {
        model: "env-tts-model",
        voice: "env-voice",
        responseFormat: "pcm",
      },
    });
  });

  test("resolves STT language from env, settings, and voice-to-dictation fallback", () => {
    const persisted = PersistedConfigSchema.parse({
      features: {
        dictation: {
          stt: {
            language: "fr",
          },
        },
        voiceMode: {
          stt: {
            language: "de",
          },
        },
      },
    });

    const result = resolveSpeechConfig({
      chisacodeHome: "/tmp/chisacode-home",
      env: {
        CHISACODE_DICTATION_LANGUAGE: "es",
        CHISACODE_VOICE_LANGUAGE: "  ",
      } as NodeJS.ProcessEnv,
      persisted,
    });

    expect(result.speech.sttLanguages).toEqual({
      dictation: "es",
      voice: "es",
    });
  });

  test("respects disabled dictation and voice mode feature flags", () => {
    const persisted = PersistedConfigSchema.parse({
      features: {
        dictation: { enabled: false },
        voiceMode: { enabled: false },
      },
    });

    const result = resolveSpeechConfig({
      chisacodeHome: "/tmp/chisacode-home",
      env: {} as NodeJS.ProcessEnv,
      persisted,
    });

    expect(result.speech.providers.dictationStt).toEqual({
      provider: "local",
      explicit: false,
      enabled: false,
    });
    expect(result.speech.providers.voiceTurnDetection).toEqual({
      provider: "local",
      explicit: false,
      enabled: false,
    });
    expect(result.speech.providers.voiceStt).toEqual({
      provider: "local",
      explicit: false,
      enabled: false,
    });
    expect(result.speech.providers.voiceTts).toEqual({
      provider: "local",
      explicit: false,
      enabled: false,
    });
  });
});
