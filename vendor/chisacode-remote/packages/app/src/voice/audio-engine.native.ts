import type {
  AudioEngine,
  AudioEngineCallbacks,
  AudioPlaybackSource,
} from "@/voice/audio-engine-types";

interface QueuedAudio {
  audio: AudioPlaybackSource;
  resolve: (duration: number) => void;
  reject: (error: Error) => void;
}

interface AudioEngineTraceOptions {
  traceLabel?: string;
}

interface Subscriber {
  callbacks: AudioEngineCallbacks;
  captureActive: boolean;
  muted: boolean;
  destroyed: boolean;
}

function parsePcmSampleRate(mimeType: string): number | null {
  const match = /rate=(\d+)/i.exec(mimeType);
  if (!match) {
    return null;
  }
  const rate = Number(match[1]);
  return Number.isFinite(rate) && rate > 0 ? rate : null;
}

function resamplePcm16(pcm: Uint8Array, fromRate: number, toRate: number): Uint8Array {
  if (fromRate === toRate) {
    return pcm;
  }

  const inputSamples = Math.floor(pcm.length / 2);
  const outputSamples = Math.floor((inputSamples * toRate) / fromRate);
  const out = new Uint8Array(outputSamples * 2);
  const ratio = fromRate / toRate;

  const readInt16 = (sampleIndex: number): number => {
    const i = sampleIndex * 2;
    if (i + 1 >= pcm.length) {
      return 0;
    }
    const lo = pcm[i];
    const hi = pcm[i + 1];
    let value = (hi << 8) | lo;
    if (value & 0x8000) {
      value = value - 0x10000;
    }
    return value;
  };

  const writeInt16 = (sampleIndex: number, value: number): void => {
    const clamped = Math.max(-32768, Math.min(32767, Math.round(value)));
    const i = sampleIndex * 2;
    out[i] = clamped & 0xff;
    out[i + 1] = (clamped >> 8) & 0xff;
  };

  for (let i = 0; i < outputSamples; i++) {
    const srcPos = i * ratio;
    const i0 = Math.floor(srcPos);
    const frac = srcPos - i0;
    const s0 = readInt16(i0);
    const s1 = readInt16(Math.min(inputSamples - 1, i0 + 1));
    writeInt16(i, s0 + (s1 - s0) * frac);
  }

  return out;
}

// ---------------------------------------------------------------------------
// Shared native engine core (singleton with reference counting)
// ---------------------------------------------------------------------------
//
// The native `ExpoTwoWayAudioModule` is a singleton: a single native audio
// engine instance serves all JS consumers. If two JS `createAudioEngine`
// instances each call `addExpoTwoWayAudioEventListener`, the same PCM frame
// is delivered to both listeners, causing duplicate processing when (for
// example) VoiceProvider and a dictation hook are both active.
//
// `SharedEngineCore` registers native listeners exactly once and fans events
// out to every active subscriber. Native recording is reference-counted: any
// active subscriber keeps recording on; only when all subscribers stop
// capture does native recording turn off.

interface SharedEngineCore {
  native: typeof import("@chisacode/expo-two-way-audio");
  subscribers: Set<Subscriber>;
  initialized: boolean;
  nativeRecording: boolean;
  micSubscription: { remove(): void };
  volumeSubscription: { remove(): void };
  initPromise: Promise<void> | null;
  teardownPromise: Promise<void> | null;
}

let sharedCore: SharedEngineCore | null = null;

function getNativeModule(): typeof import("@chisacode/expo-two-way-audio") {
  return require("@chisacode/expo-two-way-audio");
}

function getOrCreateSharedCore(): SharedEngineCore {
  if (sharedCore) {
    return sharedCore;
  }

  const native = getNativeModule();
  const subscribers = new Set<Subscriber>();

  const micSubscription = native.addExpoTwoWayAudioEventListener(
    "onMicrophoneData",
    (event: { data: Uint8Array }) => {
      const pcm = event.data;
      for (const sub of subscribers) {
        if (sub.destroyed || !sub.captureActive || sub.muted) {
          continue;
        }
        sub.callbacks.onCaptureData(pcm);
      }
    },
  );

  const volumeSubscription = native.addExpoTwoWayAudioEventListener(
    "onInputVolumeLevelData",
    (event: { data: number }) => {
      for (const sub of subscribers) {
        if (sub.destroyed || !sub.captureActive) {
          continue;
        }
        const level = sub.muted ? 0 : event.data;
        sub.callbacks.onVolumeLevel(level);
      }
    },
  );

  sharedCore = {
    native,
    subscribers,
    initialized: false,
    nativeRecording: false,
    micSubscription,
    volumeSubscription,
    initPromise: null,
    teardownPromise: null,
  };
  return sharedCore;
}

function anySubscriberCapturing(subscribers: Set<Subscriber>): boolean {
  for (const sub of subscribers) {
    if (!sub.destroyed && sub.captureActive) {
      return true;
    }
  }
  return false;
}

async function ensureCoreInitialized(core: SharedEngineCore): Promise<void> {
  if (core.initialized) {
    return;
  }
  if (core.initPromise) {
    await core.initPromise;
    return;
  }
  core.initPromise = (async () => {
    if (core.teardownPromise) {
      await core.teardownPromise;
      core.teardownPromise = null;
    }
    const success = await core.native.initialize();
    if (!success) {
      throw new Error("expo-two-way-audio：原生 initialize() 返回 false");
    }
    core.initialized = true;
    core.initPromise = null;
  })();
  await core.initPromise;
}

async function ensureMicrophonePermission(core: SharedEngineCore): Promise<void> {
  let permission = await core.native.getMicrophonePermissionsAsync().catch(() => null);
  if (!permission?.granted) {
    permission = await core.native.requestMicrophonePermissionsAsync().catch(() => null);
  }
  if (!permission?.granted) {
    throw new Error("采集音频需要麦克风权限。请在系统设置中启用麦克风访问。");
  }
}

function updateNativeRecording(core: SharedEngineCore): void {
  const shouldRecord = anySubscriberCapturing(core.subscribers);
  if (shouldRecord === core.nativeRecording) {
    return;
  }
  core.nativeRecording = shouldRecord;
  try {
    core.native.toggleRecording(shouldRecord);
  } catch {
    // Best-effort; native will surface errors via events.
  }
}

async function teardownCoreIfIdle(core: SharedEngineCore): Promise<void> {
  if (core.subscribers.size > 0) {
    return;
  }
  if (!core.initialized) {
    return;
  }
  if (core.teardownPromise) {
    await core.teardownPromise;
    return;
  }
  core.teardownPromise = (async () => {
    if (core.nativeRecording) {
      core.native.toggleRecording(false);
      core.nativeRecording = false;
    }
    core.native.tearDown();
    core.initialized = false;
    core.teardownPromise = null;
  })();
  await core.teardownPromise;
}

// ---------------------------------------------------------------------------
// Per-instance engine (subscribes to shared core)
// -----------------------------------------------------------------

export function createAudioEngine(
  callbacks: AudioEngineCallbacks,
  _options?: AudioEngineTraceOptions,
): AudioEngine {
  const core = getOrCreateSharedCore();
  const subscriber: Subscriber = {
    callbacks,
    captureActive: false,
    muted: false,
    destroyed: false,
  };
  core.subscribers.add(subscriber);

  const refs: {
    queue: QueuedAudio[];
    processingQueue: boolean;
    playbackTimeout: ReturnType<typeof setTimeout> | null;
    activePlayback: {
      resolve: (duration: number) => void;
      reject: (error: Error) => void;
      settled: boolean;
    } | null;
  } = {
    queue: [],
    processingQueue: false,
    playbackTimeout: null,
    activePlayback: null,
  };

  function clearPlaybackTimeout(): void {
    if (refs.playbackTimeout) {
      clearTimeout(refs.playbackTimeout);
      refs.playbackTimeout = null;
    }
  }

  async function playAudio(audio: AudioPlaybackSource): Promise<number> {
    await ensureCoreInitialized(core);

    return await new Promise<number>((resolve, reject) => {
      refs.activePlayback = { resolve, reject, settled: false };

      audio
        .arrayBuffer()
        .then((arrayBuffer) => {
          const pcm = new Uint8Array(arrayBuffer);
          const inputRate = parsePcmSampleRate(audio.type || "") ?? 24000;

          // Native AudioEngine expects 16kHz PCM16
          const pcm16k = resamplePcm16(pcm, inputRate, 16000);
          const durationSec = pcm16k.length / 2 / 16000;

          core.native.resumePlayback();
          core.native.playPCMData(pcm16k);

          clearPlaybackTimeout();
          refs.playbackTimeout = setTimeout(() => {
            clearPlaybackTimeout();
            const active = refs.activePlayback;
            if (!active || active.settled) {
              return;
            }
            active.settled = true;
            refs.activePlayback = null;
            resolve(durationSec);
          }, durationSec * 1000);
          return undefined;
        })
        .catch((error: unknown) => {
          clearPlaybackTimeout();
          const active = refs.activePlayback;
          if (active && !active.settled) {
            active.settled = true;
            refs.activePlayback = null;
            reject(error instanceof Error ? error : new Error(String(error)));
          }
        });
    });
  }

  async function processQueue(): Promise<void> {
    if (refs.processingQueue || refs.queue.length === 0) {
      return;
    }

    refs.processingQueue = true;
    while (refs.queue.length > 0) {
      const item = refs.queue.shift()!;
      try {
        const duration = await playAudio(item.audio);
        item.resolve(duration);
      } catch (error) {
        item.reject(error instanceof Error ? error : new Error(String(error)));
      }
    }
    refs.processingQueue = false;
  }

  return {
    async initialize() {
      await ensureCoreInitialized(core);
    },

    async destroy() {
      if (subscriber.destroyed) {
        return;
      }
      subscriber.destroyed = true;
      this.stop();
      this.clearQueue();
      if (subscriber.captureActive) {
        subscriber.captureActive = false;
        updateNativeRecording(core);
      }
      clearPlaybackTimeout();
      subscriber.muted = false;
      callbacks.onVolumeLevel(0);
      core.subscribers.delete(subscriber);
      await teardownCoreIfIdle(core).catch(() => undefined);
    },

    async startCapture() {
      if (subscriber.captureActive) {
        return;
      }

      try {
        await ensureMicrophonePermission(core);
        await ensureCoreInitialized(core);
        subscriber.captureActive = true;
        updateNativeRecording(core);
      } catch (error) {
        const wrapped = error instanceof Error ? error : new Error(String(error));
        callbacks.onError?.(wrapped);
        throw wrapped;
      }
    },

    async stopCapture() {
      if (!subscriber.captureActive) {
        return;
      }
      subscriber.captureActive = false;
      subscriber.muted = false;
      callbacks.onVolumeLevel(0);
      updateNativeRecording(core);
    },

    toggleMute() {
      subscriber.muted = !subscriber.muted;
      if (subscriber.muted) {
        callbacks.onVolumeLevel(0);
      }
      return subscriber.muted;
    },

    isMuted() {
      return subscriber.muted;
    },

    async play(audio: AudioPlaybackSource) {
      return await new Promise<number>((resolve, reject) => {
        refs.queue.push({ audio, resolve, reject });
        if (!refs.processingQueue) {
          void processQueue();
        }
      });
    },

    stop() {
      core.native.stopPlayback();
      clearPlaybackTimeout();
      const active = refs.activePlayback;
      refs.activePlayback = null;
      if (active && !active.settled) {
        active.settled = true;
        active.reject(new Error("Playback stopped"));
      }
    },

    clearQueue() {
      while (refs.queue.length > 0) {
        refs.queue.shift()!.reject(new Error("Playback stopped"));
      }
      refs.processingQueue = false;
    },

    isPlaying() {
      return refs.activePlayback !== null;
    },
  };
}
