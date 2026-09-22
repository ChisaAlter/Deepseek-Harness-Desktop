import { describe, expect, test } from "vitest";

import { SessionInboundMessageSchema, SessionOutboundMessageSchema } from "../messages.js";
import {
  ServerVoiceCapabilitiesSchema,
  VoiceInboundMessageSchemas,
  VoiceOutboundMessageSchemas,
} from "./messages.js";

describe("voice message domain", () => {
  test("owns seven inbound and nine outbound schemas without claiming generic abort", () => {
    expect(VoiceInboundMessageSchemas).toHaveLength(7);
    expect(VoiceOutboundMessageSchemas).toHaveLength(9);
    expect(
      VoiceInboundMessageSchemas.some(
        (schema) => schema.safeParse({ type: "abort_request" }).success,
      ),
    ).toBe(false);
    expect(SessionInboundMessageSchema.parse({ type: "abort_request" }).type).toBe("abort_request");
  });

  test("keeps every voice and dictation message in the aggregate session unions", () => {
    const inboundMessages = [
      {
        type: "voice_audio_chunk",
        audio: "base64-audio",
        format: "audio/wav",
        isLast: true,
      },
      { type: "audio_played", id: "audio-1" },
      {
        type: "set_voice_mode",
        enabled: true,
        agentId: "agent-1",
        requestId: "voice-mode-1",
      },
      {
        type: "dictation_stream_start",
        dictationId: "dictation-1",
        format: "audio/pcm;rate=16000;bits=16",
      },
      {
        type: "dictation_stream_chunk",
        dictationId: "dictation-1",
        seq: 0,
        audio: "base64-chunk",
        format: "audio/pcm;rate=16000;bits=16",
      },
      {
        type: "dictation_stream_finish",
        dictationId: "dictation-1",
        finalSeq: 0,
      },
      { type: "dictation_stream_cancel", dictationId: "dictation-1" },
    ];

    for (const message of inboundMessages) {
      expect(SessionInboundMessageSchema.parse(message).type).toBe(message.type);
    }

    const outboundMessages = [
      {
        type: "audio_output",
        payload: {
          audio: "base64-audio",
          format: "audio/wav",
          id: "audio-1",
          isVoiceMode: true,
        },
      },
      {
        type: "transcription_result",
        payload: {
          text: "hello",
          requestId: "transcription-1",
        },
      },
      {
        type: "voice_input_state",
        payload: { isSpeaking: true },
      },
      {
        type: "dictation_stream_ack",
        payload: { dictationId: "dictation-1", ackSeq: -1 },
      },
      {
        type: "dictation_stream_finish_accepted",
        payload: { dictationId: "dictation-1", timeoutMs: 30_000 },
      },
      {
        type: "dictation_stream_partial",
        payload: { dictationId: "dictation-1", text: "hel" },
      },
      {
        type: "dictation_stream_final",
        payload: { dictationId: "dictation-1", text: "hello" },
      },
      {
        type: "dictation_stream_error",
        payload: {
          dictationId: "dictation-1",
          error: "decoder failed",
          retryable: false,
        },
      },
      {
        type: "set_voice_mode_response",
        payload: {
          requestId: "voice-mode-1",
          enabled: true,
          agentId: "agent-1",
          accepted: true,
          error: null,
        },
      },
    ];

    for (const message of outboundMessages) {
      expect(SessionOutboundMessageSchema.parse(message).type).toBe(message.type);
    }
  });

  test("parses server voice capability state", () => {
    expect(
      ServerVoiceCapabilitiesSchema.parse({
        dictation: { enabled: true, reason: "ready" },
        voice: { enabled: false, reason: "missing_model" },
      }),
    ).toEqual({
      dictation: { enabled: true, reason: "ready" },
      voice: { enabled: false, reason: "missing_model" },
    });
  });
});
