import type { ServerCapabilityState } from "@chisacode/protocol/messages";
import type { DaemonServerInfo } from "@/stores/session-store";

/** Selects which voice capability to inspect: dictation-only or full voice mode */
export type VoiceReadinessMode = "dictation" | "voice";

export function getServerCapabilities(params: {
  serverInfo: DaemonServerInfo | null | undefined;
}): DaemonServerInfo["capabilities"] | null {
  const capabilities = params.serverInfo?.capabilities;
  if (!capabilities) {
    return null;
  }
  return capabilities;
}

/**
 * Reads the readiness state for a voice capability from server info
 * @param params The server info to inspect and the voice mode to check
 * @returns The capability state, or null when the server reports no voice capabilities
 */
export function getVoiceReadinessState(params: {
  serverInfo: DaemonServerInfo | null | undefined;
  mode: VoiceReadinessMode;
}): ServerCapabilityState | null {
  const capabilities = getServerCapabilities({ serverInfo: params.serverInfo });
  const voice = capabilities?.voice;
  if (!voice) {
    return null;
  }
  if (params.mode === "dictation") {
    return voice.dictation;
  }
  return voice.voice;
}

/**
 * Resolves the user-facing reason a voice capability is unavailable
 * @param params The server info to inspect and the voice mode to check
 * @returns The trimmed unavailability reason, or null when the capability is enabled or no reason is given
 */
export function resolveVoiceUnavailableMessage(params: {
  serverInfo: DaemonServerInfo | null | undefined;
  mode: VoiceReadinessMode;
}): string | null {
  const readiness = getVoiceReadinessState({
    serverInfo: params.serverInfo,
    mode: params.mode,
  });
  if (!readiness) {
    return null;
  }
  if (readiness.enabled && readiness.reason.trim().length === 0) {
    return null;
  }
  const message = readiness.reason.trim();
  if (message.length > 0) {
    return message;
  }
  return null;
}
