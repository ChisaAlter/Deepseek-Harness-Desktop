import { randomUUID } from "node:crypto";
import type pino from "pino";

import type { SessionInboundMessage, SessionOutboundMessage } from "../messages.js";
import { STTManager } from "../agent/stt-manager.js";
import {
  DictationStreamManager,
  type DictationStreamOutboundMessage,
} from "../dictation/dictation-stream-manager.js";
import type { SpeechToTextProvider } from "../speech/speech-provider.js";
import type { Resolvable } from "../speech/provider-resolver.js";
import type { DisposableHandler } from "./session-context.js";

const DEFAULT_MAX_BUFFERED_AUDIO_BYTES = 16 * 1024 * 1024;
const HANDLED_SYNC_MESSAGE = Promise.resolve();

type VoiceProcessingPhase = "idle" | "transcribing";

interface BufferedVoiceAudio {
  chunks: Buffer[];
  format: string;
  totalBytes: number;
}

interface VoiceDictationHandlerOptions {
  sessionId: string;
  sessionLogger: pino.Logger;
  stt: Resolvable<SpeechToTextProvider | null>;
  sttLanguage: string;
  emit(message: SessionOutboundMessage): void;
  maxBufferedAudioBytes?: number;
}

/** Owns voice-mode buffering, transcription, and resumable dictation for one client session. */
export class VoiceDictationHandler implements DisposableHandler {
  private readonly sessionLogger: pino.Logger;
  private readonly emit: (message: SessionOutboundMessage) => void;
  private readonly sttManager: STTManager;
  private readonly dictationStreamManager: DictationStreamManager;
  private readonly maxBufferedAudioBytes: number;
  private isVoiceMode = false;
  private voiceModeAgentId: string | null = null;
  private audioBuffer: BufferedVoiceAudio | null = null;

  constructor(options: VoiceDictationHandlerOptions) {
    this.sessionLogger = options.sessionLogger;
    this.emit = options.emit;
    this.maxBufferedAudioBytes = options.maxBufferedAudioBytes ?? DEFAULT_MAX_BUFFERED_AUDIO_BYTES;
    if (!Number.isSafeInteger(this.maxBufferedAudioBytes) || this.maxBufferedAudioBytes <= 0) {
      throw new Error("maxBufferedAudioBytes must be a positive safe integer");
    }
    this.sttManager = new STTManager(options.sessionId, options.sessionLogger, options.stt, {
      language: options.sttLanguage,
    });
    this.dictationStreamManager = new DictationStreamManager({
      logger: options.sessionLogger,
      emit: (message) => this.emitDictationMessage(message),
      sessionId: options.sessionId,
      stt: options.stt,
      language: options.sttLanguage,
    });
  }

  dispatch(msg: SessionInboundMessage): Promise<void> | undefined {
    switch (msg.type) {
      case "set_voice_mode":
        return this.handleSetVoiceMode(msg.enabled, msg.agentId, msg.requestId);
      case "voice_audio_chunk":
        return this.handleVoiceAudioChunk(msg);
      case "dictation_stream_start":
        return this.dictationStreamManager.handleStart(msg.dictationId, msg.format);
      case "dictation_stream_chunk":
        return this.dictationStreamManager.handleChunk({
          dictationId: msg.dictationId,
          seq: msg.seq,
          audioBase64: msg.audio,
          format: msg.format,
        });
      case "dictation_stream_finish":
        return this.dictationStreamManager.handleFinish(msg.dictationId, msg.finalSeq);
      case "dictation_stream_cancel":
        this.dictationStreamManager.handleCancel(msg.dictationId);
        return HANDLED_SYNC_MESSAGE;
      case "audio_played":
        return HANDLED_SYNC_MESSAGE;
      default:
        return undefined;
    }
  }

  dispose(): void {
    this.audioBuffer = null;
    this.sttManager.cleanup();
    this.dictationStreamManager.cleanupAll();
  }

  private async handleSetVoiceMode(
    enabled: boolean,
    agentId?: string,
    requestId?: string,
  ): Promise<void> {
    if (enabled && !agentId) {
      this.emit({
        type: "set_voice_mode_response",
        payload: {
          requestId: requestId ?? randomUUID(),
          enabled: false,
          agentId: null,
          accepted: false,
          error: "Voice mode requires an agent id",
          reasonCode: "missing_agent",
          retryable: false,
        },
      });
      return;
    }

    this.isVoiceMode = enabled;
    this.voiceModeAgentId = enabled ? (agentId ?? null) : null;
    if (!enabled) {
      this.audioBuffer = null;
    }

    this.emit({
      type: "set_voice_mode_response",
      payload: {
        requestId: requestId ?? randomUUID(),
        enabled,
        agentId: this.voiceModeAgentId,
        accepted: true,
        error: null,
      },
    });
  }

  private ensureAudioBufferForFormat(format: string): BufferedVoiceAudio {
    if (!this.audioBuffer || this.audioBuffer.format !== format) {
      this.audioBuffer = {
        chunks: [],
        format,
        totalBytes: 0,
      };
    }
    return this.audioBuffer;
  }

  private finalizeBufferedAudio(): { audio: Buffer; format: string } | null {
    const buffer = this.audioBuffer;
    this.audioBuffer = null;
    if (!buffer || buffer.chunks.length === 0) {
      return null;
    }
    return {
      audio: Buffer.concat(buffer.chunks, buffer.totalBytes),
      format: buffer.format,
    };
  }

  private async handleVoiceAudioChunk(
    msg: Extract<SessionInboundMessage, { type: "voice_audio_chunk" }>,
  ): Promise<void> {
    const chunkFormat = msg.format || "audio/wav";
    const buffer = this.ensureAudioBufferForFormat(chunkFormat);
    const estimatedChunkBytes = Buffer.byteLength(msg.audio, "base64");
    if (buffer.totalBytes + estimatedChunkBytes > this.maxBufferedAudioBytes) {
      this.rejectOversizedAudio(buffer.totalBytes, estimatedChunkBytes);
      return;
    }

    const chunkBuffer = Buffer.from(msg.audio, "base64");
    const nextTotalBytes = buffer.totalBytes + chunkBuffer.length;
    if (nextTotalBytes > this.maxBufferedAudioBytes) {
      this.rejectOversizedAudio(buffer.totalBytes, chunkBuffer.length);
      return;
    }

    buffer.chunks.push(chunkBuffer);
    buffer.totalBytes = nextTotalBytes;
    if (!msg.isLast) {
      return;
    }

    const finalized = this.finalizeBufferedAudio();
    if (!finalized) {
      return;
    }
    await this.processAudio(finalized.audio, finalized.format);
  }

  private rejectOversizedAudio(bufferedBytes: number, chunkBytes: number): void {
    this.audioBuffer = null;
    const message = `Voice audio exceeded the ${this.maxBufferedAudioBytes} byte session buffer limit`;
    this.sessionLogger.warn(
      {
        bufferedBytes,
        chunkBytes,
        maxBufferedAudioBytes: this.maxBufferedAudioBytes,
      },
      message,
    );
    this.emit({
      type: "activity_log",
      payload: {
        id: randomUUID(),
        timestamp: new Date(),
        type: "error",
        content: `Error: ${message}`,
      },
    });
  }

  private async processAudio(audio: Buffer, format: string): Promise<void> {
    this.setPhase("transcribing");
    const requestId = randomUUID();
    try {
      const result = await this.sttManager.transcribe(audio, format, {
        requestId,
        label: this.isVoiceMode ? "voice" : "buffered",
      });

      this.emit({
        type: "transcription_result",
        payload: {
          text: result.text,
          requestId,
          ...(result.language ? { language: result.language } : {}),
          ...(result.duration !== undefined ? { duration: result.duration } : {}),
          ...(result.avgLogprob !== undefined ? { avgLogprob: result.avgLogprob } : {}),
          ...(result.isLowConfidence !== undefined
            ? { isLowConfidence: result.isLowConfidence }
            : {}),
          byteLength: result.byteLength,
          format: result.format,
          ...(result.debugRecordingPath ? { debugRecordingPath: result.debugRecordingPath } : {}),
        },
      });
      this.emit({
        type: "activity_log",
        payload: {
          id: randomUUID(),
          timestamp: new Date(),
          type: "transcript",
          content: result.text,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.sessionLogger.error({ err: error }, "Failed to process voice audio chunk");
      this.emit({
        type: "activity_log",
        payload: {
          id: randomUUID(),
          timestamp: new Date(),
          type: "error",
          content: `Error: ${message}`,
        },
      });
    } finally {
      this.setPhase("idle");
    }
  }

  private emitDictationMessage(message: DictationStreamOutboundMessage): void {
    this.emit(message as SessionOutboundMessage);
  }

  private setPhase(phase: VoiceProcessingPhase): void {
    this.sessionLogger.debug({ phase }, `Phase: ${phase}`);
  }
}
