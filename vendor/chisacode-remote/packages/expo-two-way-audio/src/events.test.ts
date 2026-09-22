import { afterEach, describe, expect, it } from "vitest";
import type { EventSubscription } from "expo-modules-core";

import ExpoTwoWayAudioModule from "./ExpoTwoWayAudioModule";
import {
  addExpoTwoWayAudioEventListener,
  type ExpoTwoWayAudioEventMap,
  type MicrophoneDataCallback,
  type MicrophoneDataEvent,
  type AudioInterruptionCallback,
  type AudioInterruptionEvent,
  type RecordingChangeCallback,
  type RecordingChangeEvent,
  type VolumeLevelCallback,
  type VolumeLevelEvent,
} from "./events";

/**
 * Unit tests for the pure-JS forwarding layer in `events.ts`.
 *
 * `ExpoTwoWayAudioModule` is loaded via `requireNativeModule("ExpoTwoWayAudio")`.
 * In a Node test environment (no native runtime), `expo-modules-core` returns
 * an empty `{}` shim (SSR fallback path of `requireNativeModule.web.ts`), so
 * the module's default export is a plain mutable object we can inject fakes
 * onto. This is "injected fakes" per the project testing rules — no `vi.mock`,
 * no JSDOM, no real native bridge.
 *
 * What needs real-device/集成测试: actual event delivery, native listener
 * registration, subscription removal against the real bridge.
 */
describe("events — addExpoTwoWayAudioEventListener", () => {
  const nativeModule = ExpoTwoWayAudioModule as Record<string, unknown>;

  afterEach(() => {
    // Restore the SSR shim: no addListener installed.
    delete nativeModule.addListener;
  });

  it("forwards eventName and handler to the native addListener", () => {
    const calls: Array<{ name: string; handler: (...args: unknown[]) => void }> = [];
    nativeModule.addListener = (name: string, handler: (...args: unknown[]) => void) => {
      calls.push({ name, handler });
      return { remove() {} } as EventSubscription;
    };

    const handler: MicrophoneDataCallback = () => {};
    const sub = addExpoTwoWayAudioEventListener("onMicrophoneData", handler);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.name).toBe("onMicrophoneData");
    expect(calls[0]?.handler).toBe(handler);
    expect(sub).toBeDefined();
    expect(typeof sub.remove).toBe("function");
  });

  it("returns the same subscription object produced by the native addListener", () => {
    let removed = false;
    nativeModule.addListener = () => {
      return {
        remove: () => {
          removed = true;
        },
      };
    };

    const sub = addExpoTwoWayAudioEventListener("onRecordingChange", () => {});
    sub.remove();
    expect(removed).toBe(true);
  });

  it("preserves per-event-name routing (each eventName reaches addListener verbatim)", () => {
    const seen: string[] = [];
    nativeModule.addListener = (name: string) => {
      seen.push(name);
      return { remove() {} } as EventSubscription;
    };

    const names = Object.keys({
      onMicrophoneData: null,
      onInputVolumeLevelData: null,
      onOutputVolumeLevelData: null,
      onRecordingChange: null,
      onAudioInterruption: null,
    } satisfies Record<keyof ExpoTwoWayAudioEventMap, null>) as Array<
      keyof ExpoTwoWayAudioEventMap
    >;

    for (const name of names) {
      addExpoTwoWayAudioEventListener(name, () => {});
    }

    expect(seen).toEqual(names);
  });
});

/**
 * Type-level smoke checks (no runtime assertions): ensures the public event
 * shapes and callback aliases are exported and assignable. Vitest runs these
 * only for the side-effect of import resolution — the real value is that the
 * imports above fail to compile if the exports drift.
 */
describe("events — type surface", () => {
  it("exports event interfaces with a `data` field", () => {
    const mic: MicrophoneDataEvent = { data: new Uint8Array([1, 2, 3]) };
    const vol: VolumeLevelEvent = { data: 0.5 };
    const rec: RecordingChangeEvent = { data: true };
    const interruption: AudioInterruptionEvent = { data: "ended" };

    expect(mic.data).toBeInstanceOf(Uint8Array);
    expect(vol.data).toBe(0.5);
    expect(rec.data).toBe(true);
    expect(interruption.data).toBe("ended");
  });

  it("callback aliases are callable", () => {
    const micCb: MicrophoneDataCallback = (e) => {
      expect(e.data).toBeInstanceOf(Uint8Array);
    };
    const volCb: VolumeLevelCallback = (e) => {
      expect(typeof e.data).toBe("number");
    };
    const recCb: RecordingChangeCallback = (e) => {
      expect(typeof e.data).toBe("boolean");
    };
    const interruptionCb: AudioInterruptionCallback = (e) => {
      expect(typeof e.data).toBe("string");
    };

    micCb({ data: new Uint8Array([1]) });
    volCb({ data: 0.1 });
    recCb({ data: true });
    interruptionCb({ data: "began" });
  });
});
