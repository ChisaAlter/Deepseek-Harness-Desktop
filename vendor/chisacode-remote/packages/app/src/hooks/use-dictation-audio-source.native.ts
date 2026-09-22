import { useCallback, useEffect, useRef } from "react";
import { Buffer } from "buffer";
import { useState } from "react";

import { createAudioEngine } from "@/voice/audio-engine";

import type {
  DictationAudioSource,
  DictationAudioSourceConfig,
} from "./use-dictation-audio-source.types";

export function useDictationAudioSource(config: DictationAudioSourceConfig): DictationAudioSource {
  const onPcmSegmentRef = useRef(config.onPcmSegment);
  const onErrorRef = useRef(config.onError);
  const [volume, setVolume] = useState(0);
  const engineRef = useRef<ReturnType<typeof createAudioEngine> | null>(null);

  const getOrCreateEngine = useCallback(() => {
    if (engineRef.current) {
      return engineRef.current;
    }

    engineRef.current = createAudioEngine({
      onCaptureData: (pcm) => {
        onPcmSegmentRef.current(Buffer.from(pcm).toString("base64"));
      },
      onVolumeLevel: (level) => {
        setVolume(level);
      },
      onError: (error) => {
        onErrorRef.current?.(error);
      },
    });
    return engineRef.current;
  }, []);

  useEffect(() => {
    onPcmSegmentRef.current = config.onPcmSegment;
    onErrorRef.current = config.onError;
  }, [config.onPcmSegment, config.onError]);

  const start = useCallback(async () => {
    const engine = getOrCreateEngine();
    await engine.initialize();
    await engine.startCapture();
  }, [getOrCreateEngine]);

  const stop = useCallback(async () => {
    await engineRef.current?.stopCapture();
    setVolume(0);
  }, []);

  useEffect(() => {
    return () => {
      const engine = engineRef.current;
      engineRef.current = null;
      void engine?.destroy().catch(() => undefined);
    };
  }, []);

  return {
    start,
    stop,
    volume,
  };
}
