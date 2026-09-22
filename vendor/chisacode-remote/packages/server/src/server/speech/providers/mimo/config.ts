import { z } from "zod/v3";

import type { PersistedConfig } from "../../../persisted-config.js";
import type { RequestedSpeechProviders } from "../../speech-types.js";

export const DEFAULT_MIMO_BASE_URL = "https://api.xiaomimimo.com/v1";
export const DEFAULT_MIMO_TTS_MODEL = "mimo-v2.5-tts";
export const DEFAULT_MIMO_TTS_VOICE = "mimo_default";

export interface MimoSpeechProviderConfig {
  apiKey: string;
  baseUrl: string;
  tts: {
    model: string;
    voice: string;
    responseFormat: "pcm";
  };
}

const OptionalTrimmedStringSchema = z
  .string()
  .trim()
  .optional()
  .transform((value) => (value && value.length > 0 ? value : undefined));

const MimoSpeechResolutionSchema = z.object({
  apiKey: OptionalTrimmedStringSchema,
  baseUrl: OptionalTrimmedStringSchema.default(DEFAULT_MIMO_BASE_URL),
  ttsModel: OptionalTrimmedStringSchema.default(DEFAULT_MIMO_TTS_MODEL),
  ttsVoice: OptionalTrimmedStringSchema.default(DEFAULT_MIMO_TTS_VOICE),
});

function isMimoProviderActive(provider: { enabled?: boolean; provider: string }): boolean {
  return provider.enabled !== false && provider.provider === "mimo";
}

function pickIfMimo<T>(
  provider: { enabled?: boolean; provider: string },
  value: T | undefined,
): T | undefined {
  return isMimoProviderActive(provider) ? value : undefined;
}

function firstDefined<T>(values: Array<T | null | undefined>): T | undefined {
  for (const value of values) {
    if (value !== undefined && value !== null) {
      return value;
    }
  }
  return undefined;
}

export function resolveMimoSpeechConfig(params: {
  env: NodeJS.ProcessEnv;
  persisted: PersistedConfig;
  providers: RequestedSpeechProviders;
}): MimoSpeechProviderConfig | undefined {
  const parsed = MimoSpeechResolutionSchema.parse({
    apiKey: firstDefined<string>([
      params.env.MIMO_API_KEY,
      params.persisted.providers?.mimo?.apiKey,
    ]),
    baseUrl: firstDefined<string>([
      params.env.MIMO_BASE_URL,
      params.persisted.providers?.mimo?.baseUrl,
      DEFAULT_MIMO_BASE_URL,
    ]),
    ttsModel: firstDefined<string>([
      params.env.MIMO_TTS_MODEL,
      pickIfMimo(params.providers.voiceTts, params.persisted.features?.voiceMode?.tts?.model),
      DEFAULT_MIMO_TTS_MODEL,
    ]),
    ttsVoice: firstDefined<string>([
      params.env.MIMO_TTS_VOICE,
      pickIfMimo(params.providers.voiceTts, params.persisted.features?.voiceMode?.tts?.voice),
      DEFAULT_MIMO_TTS_VOICE,
    ]),
  });

  if (!parsed.apiKey) {
    return undefined;
  }

  return {
    apiKey: parsed.apiKey,
    baseUrl: parsed.baseUrl.replace(/\/+$/, ""),
    tts: {
      model: parsed.ttsModel,
      voice: parsed.ttsVoice,
      responseFormat: "pcm",
    },
  };
}
