import { EventEmitter } from "node:events";
import pino from "pino";
import { describe, expect, it } from "vitest";

import type {
  SpeechToTextProvider,
  StreamingTranscriptionSession,
} from "../speech/speech-provider.js";
import { VoiceDictationHandler } from "./voice-dictation-handler.js";

class RecordingSttSession extends EventEmitter implements StreamingTranscriptionSession {
  readonly requiredSampleRate = 16000;
  readonly appended: Buffer[] = [];

  async connect(): Promise<void> {}

  appendPcm16(pcm16le: Buffer): void {
    this.appended.push(Buffer.from(pcm16le));
  }

  commit(): void {
    this.emit("committed", { segmentId: "segment-1", previousSegmentId: null });
    this.emit("transcript", {
      segmentId: "segment-1",
      transcript: "ready",
      isFinal: true,
      language: "en",
    });
  }

  clear(): void {}

  close(): void {}
}

class RecordingSttProvider implements SpeechToTextProvider {
  readonly id = "recording";
  readonly sessions: RecordingSttSession[] = [];

  createSession(): StreamingTranscriptionSession {
    const session = new RecordingSttSession();
    this.sessions.push(session);
    return session;
  }
}

function createHandler(options?: {
  maxBufferedAudioBytes?: number;
  stt?: SpeechToTextProvider | null;
}) {
  const emitted: Array<{ type: string; payload?: unknown }> = [];
  const handler = new VoiceDictationHandler({
    sessionId: "session-1",
    sessionLogger: pino({ level: "silent" }),
    stt: options?.stt ?? null,
    sttLanguage: "en",
    maxBufferedAudioBytes: options?.maxBufferedAudioBytes,
    emit: (message) => emitted.push(message),
  });
  return { emitted, handler };
}

describe("VoiceDictationHandler", () => {
  it("claims handled synchronous messages without falling through", async () => {
    const { handler } = createHandler();

    const handled = handler.dispatch({ type: "audio_played", id: "audio-1" });
    const unrelated = handler.dispatch({ type: "ping", payload: { requestId: "ping-1" } });

    expect(handled).toBeInstanceOf(Promise);
    await expect(handled).resolves.toBeUndefined();
    expect(unrelated).toBeUndefined();
  });

  it("preserves the missing-agent voice mode response contract", async () => {
    const { emitted, handler } = createHandler();

    await handler.dispatch({
      type: "set_voice_mode",
      enabled: true,
      requestId: "voice-1",
    });

    expect(emitted).toContainEqual({
      type: "set_voice_mode_response",
      payload: {
        requestId: "voice-1",
        enabled: false,
        agentId: null,
        accepted: false,
        error: "Voice mode requires an agent id",
        reasonCode: "missing_agent",
        retryable: false,
      },
    });
  });

  it("drops an oversized buffered utterance and accepts the next one", async () => {
    const stt = new RecordingSttProvider();
    const { emitted, handler } = createHandler({
      maxBufferedAudioBytes: 4,
      stt,
    });
    const format = "audio/pcm;rate=16000;bits=16";

    await handler.dispatch({
      type: "voice_audio_chunk",
      audio: Buffer.alloc(3, 1).toString("base64"),
      format,
      isLast: false,
    });
    await handler.dispatch({
      type: "voice_audio_chunk",
      audio: Buffer.alloc(2, 2).toString("base64"),
      format,
      isLast: true,
    });

    expect(stt.sessions).toHaveLength(0);
    expect(emitted).toContainEqual(
      expect.objectContaining({
        type: "activity_log",
        payload: expect.objectContaining({
          type: "error",
          content: "Error: Voice audio exceeded the 4 byte session buffer limit",
        }),
      }),
    );

    await handler.dispatch({
      type: "voice_audio_chunk",
      audio: Buffer.alloc(2, 3).toString("base64"),
      format,
      isLast: true,
    });

    expect(stt.sessions).toHaveLength(1);
    expect(Buffer.concat(stt.sessions[0]!.appended)).toEqual(Buffer.alloc(2, 3));
    expect(emitted).toContainEqual(
      expect.objectContaining({
        type: "transcription_result",
        payload: expect.objectContaining({ text: "ready", byteLength: 2, format }),
      }),
    );
  });
});
