/**
 * Internal types extracted from Session.
 *
 * These types have minimal external dependencies and are implementation
 * details of the Session class. They are NOT part of Session's public API.
 */

import type { FSWatcher } from "node:fs";

import type { LocalSpeechModelId } from "./speech/providers/local/models.js";
import type { SpeechReadinessSnapshot } from "./speech/speech-runtime.js";

/** Describes a workspace directory being watched by the Session for git changes. */
export interface WorkspaceGitWatchTarget {
  cwd: string;
  workspaceId: string;
  watchers: FSWatcher[];
  debounceTimer: ReturnType<typeof setTimeout> | null;
  refreshPromise: Promise<void> | null;
  refreshQueued: boolean;
  latestDescriptorStateKey: string | null;
  lastBranchName: string | null;
}

/** Runtime metrics collected by the Session for monitoring. */
export interface SessionRuntimeMetrics {
  terminalDirectorySubscriptionCount: number;
  terminalSubscriptionCount: number;
  inflightRequests: number;
  peakInflightRequests: number;
}

/** Factory that creates an MCP transport. Stub for a feature under development. */
export type AgentMcpTransportFactory = () => Promise<unknown>;

/** Payload emitted when speech-to-text transcription completes. */
export interface VoiceTranscriptionResultPayload {
  text: string;
  requestId: string;
  language?: string;
  duration?: number;
  avgLogprob?: number;
  isLowConfidence?: boolean;
  byteLength?: number;
  format?: string;
  debugRecordingPath?: string;
}

/** Context describing why a voice feature (STT/TTS) is currently unavailable. */
export interface VoiceFeatureUnavailableContext {
  reasonCode: SpeechReadinessSnapshot["voiceFeature"]["reasonCode"];
  message: string;
  retryable: boolean;
  missingModelIds: LocalSpeechModelId[];
}

/** Metadata returned in RPC responses when a voice feature is unavailable. */
export interface VoiceFeatureUnavailableResponseMetadata {
  reasonCode?: SpeechReadinessSnapshot["voiceFeature"]["reasonCode"];
  retryable?: boolean;
  missingModelIds?: LocalSpeechModelId[];
}

/**
 * Error thrown when a voice feature (STT/TTS) is unavailable,
 * carrying structured metadata for client-side handling.
 */
export class VoiceFeatureUnavailableError extends Error {
  readonly reasonCode: SpeechReadinessSnapshot["voiceFeature"]["reasonCode"];
  readonly retryable: boolean;
  readonly missingModelIds: LocalSpeechModelId[];

  constructor(context: VoiceFeatureUnavailableContext) {
    super(context.message);
    this.name = "VoiceFeatureUnavailableError";
    this.reasonCode = context.reasonCode;
    this.retryable = context.retryable;
    this.missingModelIds = [...context.missingModelIds];
  }
}
