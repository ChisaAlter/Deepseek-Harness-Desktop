import type { Logger } from "pino";

import type { TextToSpeechProvider } from "../../speech-provider.js";
import type { RequestedSpeechProviders } from "../../speech-types.js";
import type { MimoSpeechProviderConfig } from "./config.js";
import { MimoTTS } from "./tts.js";

export interface MimoSpeechAvailability {
  tts: boolean;
}

export function getMimoSpeechAvailability(
  mimoConfig: MimoSpeechProviderConfig | undefined,
): MimoSpeechAvailability {
  return {
    tts: Boolean(mimoConfig?.apiKey),
  };
}

export function validateMimoCredentialRequirements(params: {
  providers: RequestedSpeechProviders;
  mimoConfig: MimoSpeechProviderConfig | undefined;
  logger: Logger;
}): void {
  const { providers, logger, mimoConfig } = params;
  if (
    providers.voiceTts.enabled !== false &&
    providers.voiceTts.provider === "mimo" &&
    !mimoConfig?.apiKey
  ) {
    logger.error(
      {
        requestedProviders: {
          voiceTts: providers.voiceTts.provider,
        },
      },
      "Invalid speech configuration: MiMo provider selected but credentials are missing",
    );
    throw new Error("Missing MiMo credentials for configured speech features: voice.tts");
  }
}

export function initializeMimoSpeechServices(params: {
  providers: RequestedSpeechProviders;
  mimoConfig: MimoSpeechProviderConfig | undefined;
  existingTtsService: TextToSpeechProvider | null;
  logger: Logger;
}): TextToSpeechProvider | null {
  const { providers, mimoConfig, logger } = params;
  if (params.existingTtsService) {
    return params.existingTtsService;
  }
  if (providers.voiceTts.enabled === false || providers.voiceTts.provider !== "mimo") {
    return null;
  }
  if (!mimoConfig?.apiKey) {
    logger.warn("MiMo speech provider is configured but credentials are missing");
    return null;
  }

  logger.info("MiMo speech provider initialized");
  return new MimoTTS(
    {
      apiKey: mimoConfig.apiKey,
      baseUrl: mimoConfig.baseUrl,
      model: mimoConfig.tts.model,
      voice: mimoConfig.tts.voice,
      responseFormat: mimoConfig.tts.responseFormat,
    },
    logger,
  );
}
