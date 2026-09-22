/**
 * Quoted-message reference index types and rendering helpers.
 *
 * These types describe the per-message metadata captured for QQ Bot
 * "quote / reply" features. The SDK is the single source of truth so
 * platform consumers (history replay, current-turn rendering, ref-index
 * cache) can share one vocabulary.
 *
 * Zero external dependencies — pure type + string formatting.
 */

// ============ Types ============

/** Summary stored for one quoted message. */
export interface RefIndexEntry {
  content: string;
  senderId: string;
  senderName?: string;
  timestamp: number;
  isBot?: boolean;
  attachments?: RefAttachmentSummary[];
}

/** Attachment summary persisted alongside a ref index entry. */
export interface RefAttachmentSummary {
  type: "image" | "voice" | "video" | "file" | "unknown";
  filename?: string;
  contentType?: string;
  transcript?: string;
  transcriptSource?: "stt" | "asr" | "tts" | "fallback";
  localPath?: string;
  url?: string;
}

/** Canonical attachment shape shared by history entries and ref entries. */
export type AttachmentSummary = RefAttachmentSummary;

/**
 * Rendering mode.
 *
 * - `"inline"`: current turn + history replay. No transcript-source tag.
 *   Tags are separated by newlines.
 * - `"ref"`: quoted-message block. Appends `[source: …]` to voice
 *   transcripts when `transcriptSource` is present. Tags are separated
 *   by spaces so the block fits on one line.
 */
export type RenderMode = "inline" | "ref";

/** Human-readable labels for transcript provenance (prompt contract). */
export const TRANSCRIPT_SOURCE_LABELS: Record<
  NonNullable<RefAttachmentSummary["transcriptSource"]>,
  string
> = {
  stt: "local STT",
  asr: "platform ASR",
  tts: "TTS source",
  fallback: "fallback text",
};

/** Options controlling how the tag list is rendered. */
export interface RenderOptions {
  mode: RenderMode;
  /** Separator between tags. Defaults per mode: inline=`\n`, ref=` `. */
  separator?: string;
  /** Returned when `attachments` is empty/undefined. Defaults to `""`. */
  emptyFallback?: string;
}

// ============ Public API ============

/**
 * Render a list of attachments into an LLM-facing tag string.
 *
 * Shared grammar (both modes):
 *
 * ```
 * attachment_with_source  := "MEDIA:" SOURCE [voice_suffix]
 * voice_suffix            := ' (transcript: "' TEXT '")' [source_suffix]
 * attachment_no_source    := "[" TYPE_LABEL [": " FILENAME] [voice_suffix_bare] "]" [source_suffix_bare]
 * voice_suffix_bare       := ' (transcript: "' TEXT '")'
 * source_suffix           := " [source: " LABEL "]"   ← ref mode only
 * source_suffix_bare      := " [source: " LABEL "]"   ← ref mode only
 * TYPE_LABEL              := "image" | "voice" | "video" | "file" | "attachment"
 * ```
 *
 * The **only** mode-dependent decoration is the `source_suffix` (present
 * in `ref`, absent in `inline`). Every other token is identical.
 */
export function renderAttachmentTags(
  attachments: readonly AttachmentSummary[] | undefined,
  options: RenderOptions,
): string {
  if (!attachments?.length) {
    return options.emptyFallback ?? "";
  }

  const parts: string[] = [];
  for (const att of attachments) {
    parts.push(renderOne(att, options.mode));
  }

  const separator = options.separator ?? (options.mode === "ref" ? " " : "\n");
  return parts.join(separator);
}

/**
 * Shorthand for `renderAttachmentTags(attachments, { mode: "inline" })`.
 *
 * Kept as the primary entry point for group history / current-turn
 * rendering where the terse inline form is always wanted.
 */
export function formatAttachmentTags(attachments?: readonly AttachmentSummary[]): string {
  return renderAttachmentTags(attachments, { mode: "inline" });
}

/** Format a ref-index entry into text suitable for model context. */
export function formatRefEntryForAgent(entry: RefIndexEntry): string {
  const parts: string[] = [];

  if (entry.content.trim()) {
    parts.push(entry.content);
  }

  const attachmentTags = renderAttachmentTags(entry.attachments, { mode: "ref" });
  if (attachmentTags) {
    parts.push(attachmentTags);
  }

  return parts.join(" ") || "[empty message]";
}

// ============ Internal ============

/**
 * Render a single attachment.
 *
 * The function is split into two orthogonal concerns:
 *   - `renderBody`: the shared "MEDIA:{source}…" or "[type…]" string.
 *   - `renderSourceSuffix`: ref-mode-only `" [source: …]"` tail.
 *
 * Both consumers produce the same body; only the suffix differs.
 */
function renderOne(att: AttachmentSummary, mode: RenderMode): string {
  const body = renderBody(att);
  const suffix = mode === "ref" ? renderSourceSuffix(att) : "";
  return body + suffix;
}

/** Shared, mode-agnostic body of the tag. */
function renderBody(att: AttachmentSummary): string {
  const source = att.localPath || att.url;
  const voiceSuffix =
    att.type === "voice" && att.transcript ? ` (transcript: "${att.transcript}")` : "";

  if (source) {
    return `MEDIA:${source}${voiceSuffix}`;
  }

  const label = labelForType(att.type);
  const namePart = att.filename ? `: ${att.filename}` : "";
  return `[${label}${namePart}${voiceSuffix}]`;
}

/**
 * Ref-mode-only tail that records where a voice transcript came from.
 * Empty string when the attachment isn't a transcribed voice message.
 */
function renderSourceSuffix(att: AttachmentSummary): string {
  if (att.type !== "voice" || !att.transcript || !att.transcriptSource) {
    return "";
  }
  const label = TRANSCRIPT_SOURCE_LABELS[att.transcriptSource] ?? att.transcriptSource;
  return ` [source: ${label}]`;
}

/** Canonical single-word label for each attachment type. */
function labelForType(type: AttachmentSummary["type"]): string {
  switch (type) {
    case "image":
      return "image";
    case "voice":
      return "voice";
    case "video":
      return "video";
    case "file":
      return "file";
    default:
      return "attachment";
  }
}
