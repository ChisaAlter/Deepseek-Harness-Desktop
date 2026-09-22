export const REALTIME_VOICE_VAD_CONFIG = {
  // Headset mics often report lower input volume than built-in mics.
  // Keep threshold low enough to avoid requiring loud speech.
  volumeThreshold: 0.12,
  // Short staggered grace before we visually/VAD-deactivate speaking.
  // Prevents fade-out between normal intra-word pauses.
  confirmedDropGracePeriodMs: 1000,
  // Keep turns open longer so brief "thinking pauses" don't end speech too early.
  silenceDurationMs: 2000,
  speechConfirmationMs: 120,
  detectionGracePeriodMs: 700,
  // Delay speech-start interrupts to ignore transient noise triggers.
  interruptGracePeriodMs: 1000,
} as const;
