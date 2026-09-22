import { Readable } from "node:stream";
import type pino from "pino";

import type { SpeechStreamResult, TextToSpeechProvider } from "../../speech-provider.js";

export interface MimoTtsConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  voice: string;
  responseFormat?: "pcm";
}

interface MimoAudioPayload {
  data?: string;
  format?: string;
}

interface MimoAssistantMessage {
  audio?: MimoAudioPayload;
}

interface MimoChatChoice {
  message?: MimoAssistantMessage;
}

interface MimoChatCompletionResponse {
  choices?: MimoChatChoice[];
  error?: {
    message?: string;
  };
}

function getResponseErrorText(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return "";
  }
  const message = (payload as MimoChatCompletionResponse).error?.message;
  return typeof message === "string" && message.trim().length > 0 ? message.trim() : "";
}

function getAudioPayload(payload: unknown): MimoAudioPayload | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const response = payload as MimoChatCompletionResponse;
  const audio = response.choices?.[0]?.message?.audio;
  return audio && typeof audio === "object" ? audio : null;
}

export class MimoTTS implements TextToSpeechProvider {
  public readonly id = "mimo";

  private readonly config: MimoTtsConfig;
  private readonly logger: pino.Logger;

  constructor(ttsConfig: MimoTtsConfig, parentLogger: pino.Logger) {
    this.config = {
      responseFormat: "pcm",
      ...ttsConfig,
      baseUrl: ttsConfig.baseUrl.replace(/\/+$/, ""),
    };
    this.logger = parentLogger.child({ module: "agent", provider: "mimo", component: "tts" });
    this.logger.info(
      {
        model: this.config.model,
        voice: this.config.voice,
        format: this.config.responseFormat,
        baseUrl: this.config.baseUrl,
      },
      "TTS (MiMo) initialized",
    );
  }

  public getConfig(): MimoTtsConfig {
    return this.config;
  }

  public async synthesizeSpeech(text: string): Promise<SpeechStreamResult> {
    if (!text || text.trim().length === 0) {
      throw new Error("Cannot synthesize empty text");
    }

    const startTime = Date.now();
    try {
      this.logger.debug(
        { textLength: text.length, preview: text.substring(0, 50) },
        "Synthesizing speech",
      );

      const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.config.model,
          modalities: ["text", "audio"],
          audio: {
            voice: this.config.voice,
            format: "pcm16",
          },
          messages: [
            {
              role: "assistant",
              content: text,
            },
          ],
        }),
      });

      const payload = (await response.json().catch(() => null)) as unknown;
      if (!response.ok) {
        const detail = getResponseErrorText(payload);
        throw new Error(
          `MiMo TTS request failed with ${response.status}${detail ? `: ${detail}` : ""}`,
        );
      }

      const audio = getAudioPayload(payload);
      if (!audio || typeof audio.data !== "string" || audio.data.length === 0) {
        throw new Error("MiMo TTS response did not include audio data");
      }

      const duration = Date.now() - startTime;
      this.logger.debug({ duration }, "Speech synthesis ready");

      return {
        stream: Readable.from(Buffer.from(audio.data, "base64")),
        format: "pcm",
      };
    } catch (error) {
      this.logger.error({ err: error }, "Speech synthesis error");
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`MiMo TTS synthesis failed: ${message}`, { cause: error });
    }
  }
}
