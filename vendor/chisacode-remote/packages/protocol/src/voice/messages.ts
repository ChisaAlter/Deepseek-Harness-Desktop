import { z } from "zod/v3";

export const VoiceAudioChunkMessageSchema = z.object({
  type: z.literal("voice_audio_chunk"),
  audio: z.string(), // base64 encoded
  format: z.string(),
  isLast: z.boolean(),
});

export const AudioPlayedMessageSchema = z.object({
  type: z.literal("audio_played"),
  id: z.string(),
});

export const SetVoiceModeMessageSchema = z.object({
  type: z.literal("set_voice_mode"),
  enabled: z.boolean(),
  agentId: z.string().optional(),
  requestId: z.string().optional(),
});

export const DictationStreamStartMessageSchema = z.object({
  type: z.literal("dictation_stream_start"),
  dictationId: z.string(),
  format: z.string(), // e.g. "audio/pcm;rate=16000;bits=16"
});

export const DictationStreamChunkMessageSchema = z.object({
  type: z.literal("dictation_stream_chunk"),
  dictationId: z.string(),
  seq: z.number().int().nonnegative(),
  audio: z.string(), // base64 encoded chunk
  format: z.string(), // e.g. "audio/pcm;rate=16000;bits=16"
});

export const DictationStreamFinishMessageSchema = z.object({
  type: z.literal("dictation_stream_finish"),
  dictationId: z.string(),
  finalSeq: z.number().int().nonnegative(),
});

export const DictationStreamCancelMessageSchema = z.object({
  type: z.literal("dictation_stream_cancel"),
  dictationId: z.string(),
});

export const SetVoiceModeResponseMessageSchema = z.object({
  type: z.literal("set_voice_mode_response"),
  payload: z.object({
    requestId: z.string(),
    enabled: z.boolean(),
    agentId: z.string().nullable(),
    accepted: z.boolean(),
    error: z.string().nullable(),
    reasonCode: z.string().optional(),
    retryable: z.boolean().optional(),
    missingModelIds: z.array(z.string()).optional(),
  }),
});

export const AudioOutputMessageSchema = z.object({
  type: z.literal("audio_output"),
  payload: z.object({
    audio: z.string(), // base64 encoded
    format: z.string(),
    id: z.string(),
    isVoiceMode: z.boolean(), // Mode when audio was generated (for drift protection)
    groupId: z.string().optional(), // Logical utterance id
    chunkIndex: z.number().int().nonnegative().optional(),
    isLastChunk: z.boolean().optional(),
  }),
});

export const TranscriptionResultMessageSchema = z.object({
  type: z.literal("transcription_result"),
  payload: z.object({
    text: z.string(),
    language: z.string().optional(),
    duration: z.number().optional(),
    requestId: z.string(), // Echoed back from request for tracking
    avgLogprob: z.number().optional(),
    isLowConfidence: z.boolean().optional(),
    byteLength: z.number().optional(),
    format: z.string().optional(),
    debugRecordingPath: z.string().optional(),
  }),
});

export const VoiceInputStateMessageSchema = z.object({
  type: z.literal("voice_input_state"),
  payload: z.object({
    isSpeaking: z.boolean(),
  }),
});

export const DictationStreamAckMessageSchema = z.object({
  type: z.literal("dictation_stream_ack"),
  payload: z.object({
    dictationId: z.string(),
    ackSeq: z.number().int(),
  }),
});

export const DictationStreamFinishAcceptedMessageSchema = z.object({
  type: z.literal("dictation_stream_finish_accepted"),
  payload: z.object({
    dictationId: z.string(),
    timeoutMs: z.number().int().positive(),
  }),
});

export const DictationStreamPartialMessageSchema = z.object({
  type: z.literal("dictation_stream_partial"),
  payload: z.object({
    dictationId: z.string(),
    text: z.string(),
  }),
});

export const DictationStreamFinalMessageSchema = z.object({
  type: z.literal("dictation_stream_final"),
  payload: z.object({
    dictationId: z.string(),
    text: z.string(),
    debugRecordingPath: z.string().optional(),
  }),
});

export const DictationStreamErrorMessageSchema = z.object({
  type: z.literal("dictation_stream_error"),
  payload: z.object({
    dictationId: z.string(),
    error: z.string(),
    retryable: z.boolean(),
    reasonCode: z.string().optional(),
    missingModelIds: z.array(z.string()).optional(),
    debugRecordingPath: z.string().optional(),
  }),
});

export const ServerCapabilityStateSchema = z.object({
  enabled: z.boolean(),
  reason: z.string(),
});

export const ServerVoiceCapabilitiesSchema = z.object({
  dictation: ServerCapabilityStateSchema,
  voice: ServerCapabilityStateSchema,
});

/** Voice and dictation request schemas included in the session inbound union. */
export const VoiceInboundMessageSchemas = [
  VoiceAudioChunkMessageSchema,
  AudioPlayedMessageSchema,
  SetVoiceModeMessageSchema,
  DictationStreamStartMessageSchema,
  DictationStreamChunkMessageSchema,
  DictationStreamFinishMessageSchema,
  DictationStreamCancelMessageSchema,
] as const;

/** Voice and dictation response schemas included in the session outbound union. */
export const VoiceOutboundMessageSchemas = [
  AudioOutputMessageSchema,
  TranscriptionResultMessageSchema,
  VoiceInputStateMessageSchema,
  DictationStreamAckMessageSchema,
  DictationStreamFinishAcceptedMessageSchema,
  DictationStreamPartialMessageSchema,
  DictationStreamFinalMessageSchema,
  DictationStreamErrorMessageSchema,
  SetVoiceModeResponseMessageSchema,
] as const;

/** A client audio chunk submitted to voice mode. */
export type VoiceAudioChunkMessage = z.infer<typeof VoiceAudioChunkMessageSchema>;
/** Notification that an emitted audio chunk finished playback. */
export type AudioPlayedMessage = z.infer<typeof AudioPlayedMessageSchema>;
/** Request to enable or disable voice mode. */
export type SetVoiceModeMessage = z.infer<typeof SetVoiceModeMessageSchema>;
/** Request to start a resumable dictation stream. */
export type DictationStreamStartMessage = z.infer<typeof DictationStreamStartMessageSchema>;
/** Audio chunk within a resumable dictation stream. */
export type DictationStreamChunkMessage = z.infer<typeof DictationStreamChunkMessageSchema>;
/** Request to finalize a dictation stream. */
export type DictationStreamFinishMessage = z.infer<typeof DictationStreamFinishMessageSchema>;
/** Request to cancel a dictation stream. */
export type DictationStreamCancelMessage = z.infer<typeof DictationStreamCancelMessageSchema>;
/** Response confirming a voice mode state transition. */
export type SetVoiceModeResponseMessage = z.infer<typeof SetVoiceModeResponseMessageSchema>;
/** Generated audio emitted by the daemon. */
export type AudioOutputMessage = z.infer<typeof AudioOutputMessageSchema>;
/** Transcription produced from submitted voice audio. */
export type TranscriptionResultMessage = z.infer<typeof TranscriptionResultMessageSchema>;
/** Current speaking state for voice input. */
export type VoiceInputStateMessage = z.infer<typeof VoiceInputStateMessageSchema>;
/** Acknowledgement for a dictation stream sequence. */
export type DictationStreamAckMessage = z.infer<typeof DictationStreamAckMessageSchema>;
/** Response accepting dictation finalization with a timeout budget. */
export type DictationStreamFinishAcceptedMessage = z.infer<
  typeof DictationStreamFinishAcceptedMessageSchema
>;
/** Partial text emitted while dictation is in progress. */
export type DictationStreamPartialMessage = z.infer<typeof DictationStreamPartialMessageSchema>;
/** Final text emitted when dictation completes. */
export type DictationStreamFinalMessage = z.infer<typeof DictationStreamFinalMessageSchema>;
/** Error emitted while processing a dictation stream. */
export type DictationStreamErrorMessage = z.infer<typeof DictationStreamErrorMessageSchema>;
/** Availability state for a server voice capability. */
export type ServerCapabilityState = z.infer<typeof ServerCapabilityStateSchema>;
/** Server capability states for dictation and voice mode. */
export type ServerVoiceCapabilities = z.infer<typeof ServerVoiceCapabilitiesSchema>;
