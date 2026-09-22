import type { SessionInboundMessage, SessionOutboundMessage } from "@chisacode/protocol/messages";

import type {
  DaemonCommandResponsePayload,
  DaemonCommandTransport,
} from "./daemon-client-command-transport.js";

const DEFAULT_DICTATION_FINISH_ACCEPT_TIMEOUT_MS = 15_000;
const DEFAULT_DICTATION_FINISH_FALLBACK_TIMEOUT_MS = 5 * 60 * 1_000;
const DEFAULT_DICTATION_FINISH_TIMEOUT_GRACE_MS = 5_000;

export type SetVoiceModePayload = DaemonCommandResponsePayload<"set_voice_mode_response">;
export interface DictationFinalResult {
  dictationId: string;
  text: string;
}

export interface VoiceWaitHandle<T> {
  promise: Promise<T>;
  cancel(error: Error): void;
}

interface VoiceClientTransport extends DaemonCommandTransport {
  sendMessage(message: SessionInboundMessage): void;
  sendStrictMessage(message: SessionInboundMessage): void;
  waitFor<T>(
    predicate: (message: SessionOutboundMessage) => T | null,
    timeout?: number,
  ): VoiceWaitHandle<T>;
}

function isWaiterTimeoutError(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith("Timeout waiting for message");
}

/** Owns voice commands and dictation stream operation lifecycles. */
export class VoiceClient {
  constructor(private readonly transport: VoiceClientTransport) {}

  async setVoiceMode(enabled: boolean, agentId?: string): Promise<SetVoiceModePayload> {
    const response = await this.transport.request({
      message: {
        type: "set_voice_mode",
        enabled,
        ...(agentId ? { agentId } : {}),
      },
      responseType: "set_voice_mode_response",
      timeout: 10_000,
    });
    if (!response.accepted) {
      const codeSuffix =
        typeof response.reasonCode === "string" && response.reasonCode.trim().length > 0
          ? ` (${response.reasonCode})`
          : "";
      throw new Error((response.error ?? "Failed to set voice mode") + codeSuffix);
    }
    return response;
  }

  async sendVoiceAudioChunk(audio: string, format: string, isLast = false): Promise<void> {
    this.transport.sendMessage({ type: "voice_audio_chunk", audio, format, isLast });
  }

  async startDictationStream(dictationId: string, format: string): Promise<void> {
    const ack = this.transport.waitFor((message) => {
      if (message.type !== "dictation_stream_ack") {
        return null;
      }
      if (message.payload.dictationId !== dictationId || message.payload.ackSeq !== -1) {
        return null;
      }
      return message.payload;
    }, 30_000);
    const ackPromise = ack.promise.then(() => undefined);

    const streamError = this.transport.waitFor((message) => {
      if (message.type !== "dictation_stream_error") {
        return null;
      }
      if (message.payload.dictationId !== dictationId) {
        return null;
      }
      return message.payload;
    }, 30_000);
    const errorPromise = streamError.promise.then((payload) => {
      throw new Error(payload.error);
    });

    const cleanupError = new Error("Cancelled dictation start waiter");
    try {
      this.transport.sendStrictMessage({ type: "dictation_stream_start", dictationId, format });
      await Promise.race([ackPromise, errorPromise]);
    } finally {
      ack.cancel(cleanupError);
      streamError.cancel(cleanupError);
      void ackPromise.catch(() => undefined);
      void errorPromise.catch(() => undefined);
    }
  }

  sendDictationStreamChunk(dictationId: string, seq: number, audio: string, format: string): void {
    this.transport.sendStrictMessage({
      type: "dictation_stream_chunk",
      dictationId,
      seq,
      audio,
      format,
    });
  }

  async finishDictationStream(
    dictationId: string,
    finalSeq: number,
  ): Promise<DictationFinalResult> {
    const final = this.transport.waitFor((message) => {
      if (message.type !== "dictation_stream_final") {
        return null;
      }
      if (message.payload.dictationId !== dictationId) {
        return null;
      }
      return message.payload;
    }, 0);

    const streamError = this.transport.waitFor((message) => {
      if (message.type !== "dictation_stream_error") {
        return null;
      }
      if (message.payload.dictationId !== dictationId) {
        return null;
      }
      return message.payload;
    }, 0);

    const finishAccepted = this.transport.waitFor((message) => {
      if (message.type !== "dictation_stream_finish_accepted") {
        return null;
      }
      if (message.payload.dictationId !== dictationId) {
        return null;
      }
      return message.payload;
    }, DEFAULT_DICTATION_FINISH_ACCEPT_TIMEOUT_MS);

    const finalPromise = final.promise;
    const errorPromise = streamError.promise.then((payload) => {
      throw new Error(payload.error);
    });
    const finishAcceptedPromise = finishAccepted.promise;

    const finalOutcomePromise = finalPromise.then((payload) => ({
      kind: "final" as const,
      payload,
    }));
    const errorOutcomePromise = errorPromise.then(
      () => ({
        kind: "error" as const,
        error: new Error("Unexpected dictation stream error state"),
      }),
      (error) => ({
        kind: "error" as const,
        error: error instanceof Error ? error : new Error(String(error)),
      }),
    );
    const finishAcceptedOutcomePromise = finishAcceptedPromise.then(
      (payload) => ({ kind: "accepted" as const, payload }),
      (error) => {
        if (isWaiterTimeoutError(error)) {
          return { kind: "accepted_timeout" as const };
        }
        return {
          kind: "accepted_error" as const,
          error: error instanceof Error ? error : new Error(String(error)),
        };
      },
    );

    const waitForFinalResult = async (timeoutMs: number): Promise<DictationFinalResult> => {
      if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
        const outcome = await Promise.race([finalOutcomePromise, errorOutcomePromise]);
        if (outcome.kind === "error") {
          throw outcome.error;
        }
        return outcome.payload;
      }

      let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
      const timeoutPromise = new Promise<{ kind: "timeout" }>((resolve) => {
        timeoutHandle = setTimeout(() => resolve({ kind: "timeout" }), timeoutMs);
      });

      const outcome = await Promise.race([
        finalOutcomePromise,
        errorOutcomePromise,
        timeoutPromise,
      ]);
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
      if (outcome.kind === "timeout") {
        throw new Error(`Timeout waiting for dictation finalization (${timeoutMs}ms)`);
      }
      if (outcome.kind === "error") {
        throw outcome.error;
      }
      return outcome.payload;
    };

    const cleanupError = new Error("Cancelled dictation finish waiter");
    try {
      this.transport.sendStrictMessage({ type: "dictation_stream_finish", dictationId, finalSeq });
      const firstOutcome = await Promise.race([
        finalOutcomePromise,
        errorOutcomePromise,
        finishAcceptedOutcomePromise,
      ]);

      if (firstOutcome.kind === "final") {
        return firstOutcome.payload;
      }
      if (firstOutcome.kind === "error") {
        throw firstOutcome.error;
      }
      if (firstOutcome.kind === "accepted") {
        return await waitForFinalResult(
          firstOutcome.payload.timeoutMs + DEFAULT_DICTATION_FINISH_TIMEOUT_GRACE_MS,
        );
      }
      return await waitForFinalResult(DEFAULT_DICTATION_FINISH_FALLBACK_TIMEOUT_MS);
    } finally {
      final.cancel(cleanupError);
      streamError.cancel(cleanupError);
      finishAccepted.cancel(cleanupError);
      void finalPromise.catch(() => undefined);
      void errorPromise.catch(() => undefined);
      void finishAcceptedPromise.catch(() => undefined);
    }
  }

  cancelDictationStream(dictationId: string): void {
    this.transport.sendStrictMessage({ type: "dictation_stream_cancel", dictationId });
  }

  async abortRequest(): Promise<void> {
    this.transport.sendMessage({ type: "abort_request" });
  }

  async audioPlayed(id: string): Promise<void> {
    this.transport.sendMessage({ type: "audio_played", id });
  }
}
