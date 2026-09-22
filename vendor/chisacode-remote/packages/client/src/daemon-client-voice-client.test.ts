import { describe, expect, it, vi } from "vitest";
import type { SessionInboundMessage, SessionOutboundMessage } from "@chisacode/protocol/messages";

import { VoiceClient, type VoiceWaitHandle } from "./daemon-client-voice-client.js";

interface PendingWaiter {
  predicate(message: SessionOutboundMessage): unknown | null;
  resolve(value: unknown): void;
  reject(error: Error): void;
}

class MessageWaiterHarness {
  private readonly waiters = new Set<PendingWaiter>();

  waitFor<T>(
    predicate: (message: SessionOutboundMessage) => T | null,
    _timeout = 30_000,
  ): VoiceWaitHandle<T> {
    let settled = false;
    let waiter: PendingWaiter;
    let rejectPromise: (error: Error) => void = () => {};
    const promise = new Promise<T>((resolve, reject) => {
      rejectPromise = reject;
      waiter = {
        predicate,
        resolve: (value) => {
          if (settled) {
            return;
          }
          settled = true;
          resolve(value as T);
        },
        reject: (error) => {
          if (settled) {
            return;
          }
          settled = true;
          reject(error);
        },
      };
      this.waiters.add(waiter);
    });
    return {
      promise,
      cancel: (error) => {
        if (settled) {
          return;
        }
        settled = true;
        this.waiters.delete(waiter);
        rejectPromise(error);
      },
    };
  }

  emit(message: SessionOutboundMessage): void {
    for (const waiter of Array.from(this.waiters)) {
      const value = waiter.predicate(message);
      if (value === null) {
        continue;
      }
      this.waiters.delete(waiter);
      waiter.resolve(value);
    }
  }

  get size(): number {
    return this.waiters.size;
  }
}

function createVoiceClientHarness() {
  const waiterHarness = new MessageWaiterHarness();
  const sentMessages: SessionInboundMessage[] = [];
  const strictMessages: SessionInboundMessage[] = [];
  let voiceModeResponse = {
    requestId: "voice-request",
    accepted: true,
    enabled: true,
    targetAgentId: "agent-1",
    error: null,
    reasonCode: null,
  };
  const request = vi.fn(async () => voiceModeResponse);
  const client = new VoiceClient({
    request,
    sendMessage: (message) => sentMessages.push(message),
    sendStrictMessage: (message) => strictMessages.push(message),
    waitFor: (predicate, timeout) => waiterHarness.waitFor(predicate, timeout),
  } as unknown as ConstructorParameters<typeof VoiceClient>[0]);
  return {
    client,
    request,
    sentMessages,
    strictMessages,
    waiters: waiterHarness,
    setVoiceModeResponse(response: typeof voiceModeResponse) {
      voiceModeResponse = response;
    },
  };
}

describe("VoiceClient", () => {
  it("maps voice commands and preserves rejection reason codes", async () => {
    const harness = createVoiceClientHarness();

    await expect(harness.client.setVoiceMode(true, "agent-1")).resolves.toMatchObject({
      accepted: true,
      enabled: true,
    });
    expect(harness.request).toHaveBeenCalledWith({
      message: { type: "set_voice_mode", enabled: true, agentId: "agent-1" },
      responseType: "set_voice_mode_response",
      timeout: 10_000,
    });

    harness.setVoiceModeResponse({
      requestId: "voice-request-2",
      accepted: false,
      enabled: false,
      targetAgentId: null,
      error: "Voice unavailable",
      reasonCode: "voice_disabled",
    });
    await expect(harness.client.setVoiceMode(true)).rejects.toThrow(
      "Voice unavailable (voice_disabled)",
    );

    await harness.client.sendVoiceAudioChunk("audio", "audio/wav", true);
    await harness.client.abortRequest();
    await harness.client.audioPlayed("chunk-1");
    harness.client.sendDictationStreamChunk("dict-1", 2, "audio", "audio/wav");
    harness.client.cancelDictationStream("dict-1");

    expect(harness.sentMessages).toEqual([
      { type: "voice_audio_chunk", audio: "audio", format: "audio/wav", isLast: true },
      { type: "abort_request" },
      { type: "audio_played", id: "chunk-1" },
    ]);
    expect(harness.strictMessages).toEqual([
      {
        type: "dictation_stream_chunk",
        dictationId: "dict-1",
        seq: 2,
        audio: "audio",
        format: "audio/wav",
      },
      { type: "dictation_stream_cancel", dictationId: "dict-1" },
    ]);
  });

  it("resolves start acknowledgements and rejects stream errors without leaked waiters", async () => {
    const harness = createVoiceClientHarness();

    const started = harness.client.startDictationStream("dict-1", "audio/wav");
    expect(harness.strictMessages).toEqual([
      { type: "dictation_stream_start", dictationId: "dict-1", format: "audio/wav" },
    ]);
    harness.waiters.emit({
      type: "dictation_stream_ack",
      payload: { dictationId: "dict-1", ackSeq: -1 },
    });
    await expect(started).resolves.toBeUndefined();
    expect(harness.waiters.size).toBe(0);

    const failed = harness.client.startDictationStream("dict-2", "audio/wav");
    harness.waiters.emit({
      type: "dictation_stream_error",
      payload: { dictationId: "dict-2", error: "decoder failed" },
    });
    await expect(failed).rejects.toThrow("decoder failed");
    expect(harness.waiters.size).toBe(0);
  });

  it("waits for final text after finish acceptance and cleans all waiters", async () => {
    const harness = createVoiceClientHarness();

    const finished = harness.client.finishDictationStream("dict-3", 4);
    expect(harness.strictMessages).toEqual([
      { type: "dictation_stream_finish", dictationId: "dict-3", finalSeq: 4 },
    ]);
    harness.waiters.emit({
      type: "dictation_stream_finish_accepted",
      payload: { dictationId: "dict-3", timeoutMs: 1_000 },
    });
    harness.waiters.emit({
      type: "dictation_stream_final",
      payload: { dictationId: "dict-3", text: "hello" },
    });

    await expect(finished).resolves.toEqual({ dictationId: "dict-3", text: "hello" });
    expect(harness.waiters.size).toBe(0);
  });
});
