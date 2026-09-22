import { afterEach, describe, expect, it } from "vitest";

import ExpoTwoWayAudioModule from "./ExpoTwoWayAudioModule";
import {
  bypassVoiceProcessing,
  getMicrophoneModeIOS,
  initialize,
  isPlaying,
  isRecording,
  pausePlayback,
  playPCMData,
  requestMicrophonePermissionsAsync,
  resumePlayback,
  restart,
  showMicrophoneModePickerIOS,
  stopPlayback,
  tearDown,
  toggleRecording,
} from "./core";

/**
 * Unit tests for the pure-JS forwarding layer in `core.ts`.
 *
 * In a Node test environment, `ExpoTwoWayAudioModule` resolves to an empty `{}`
 * shim (SSR fallback path of `requireNativeModule.web.ts`). Each function in
 * `core.ts` is a thin synchronous/async forwarder to a method on that object.
 * We inject fakes onto the shim and verify forwarding + return-value plumbing.
 *
 * What needs real-device/集成测试: actual native audio playback, recording
 * state transitions, permission requests against the OS, iOS-only microphone
 * mode picker, etc.
 */
const nativeModule = ExpoTwoWayAudioModule as Record<string, (...args: unknown[]) => unknown>;

function stub<T>(name: string, impl: (...args: unknown[]) => T): () => void {
  nativeModule[name] = impl as unknown as (...args: unknown[]) => unknown;
  return () => {
    delete nativeModule[name];
  };
}

afterEach(() => {
  // Wipe any stub we installed so each test starts from the clean SSR shim.
  for (const key of Object.keys(nativeModule)) {
    delete nativeModule[key];
  }
});

describe("core — async initializers", () => {
  it("initialize awaits and returns the native module's result", async () => {
    let called = 0;
    const cleanup = stub("initialize", async () => {
      called += 1;
      return "ok";
    });

    const result = await initialize();
    expect(called).toBe(1);
    expect(result).toBe("ok");
    cleanup();
  });

  it("initialize propagates native rejections", async () => {
    const cleanup = stub("initialize", async () => {
      throw new Error("boom");
    });

    await expect(initialize()).rejects.toThrow("boom");
    cleanup();
  });
});

describe("core — synchronous playback control", () => {
  it("playPCMData forwards the Uint8Array verbatim and returns the native value", () => {
    let received: Uint8Array | null = null;
    const cleanup = stub("playPCMData", (data: unknown) => {
      received = data as Uint8Array;
      return "played";
    });

    const payload = new Uint8Array([10, 20, 30]);
    expect(playPCMData(payload)).toBe("played");
    expect(received).toBe(payload);
    cleanup();
  });

  it("bypassVoiceProcessing forwards the boolean and returns the native value", () => {
    let received: boolean | null = null;
    const cleanup = stub("bypassVoiceProcessing", (v: unknown) => {
      received = v as boolean;
      return "bypassed";
    });

    expect(bypassVoiceProcessing(true)).toBe("bypassed");
    expect(received).toBe(true);
    cleanup();
  });

  it("toggleRecording forwards the value and returns the native boolean", () => {
    let received: boolean | null = null;
    const cleanup = stub("toggleRecording", (v: unknown) => {
      received = v as boolean;
      return true;
    });

    expect(toggleRecording(false)).toBe(true);
    expect(received).toBe(false);
    cleanup();
  });

  it("isRecording returns the native boolean state", () => {
    const cleanup = stub("isRecording", () => false);
    expect(isRecording()).toBe(false);
    cleanup();

    const cleanup2 = stub("isRecording", () => true);
    expect(isRecording()).toBe(true);
    cleanup2();
  });

  it("isPlaying returns the native boolean state", () => {
    const cleanup = stub("isPlaying", () => true);
    expect(isPlaying()).toBe(true);
    cleanup();
  });

  it("stopPlayback / pausePlayback / resumePlayback / tearDown / restart forward with no args", () => {
    const calls: string[] = [];
    for (const name of ["stopPlayback", "pausePlayback", "resumePlayback", "tearDown", "restart"]) {
      stub(name, () => name);
    }

    expect(stopPlayback()).toBe("stopPlayback");
    expect(pausePlayback()).toBe("pausePlayback");
    expect(resumePlayback()).toBe("resumePlayback");
    expect(tearDown()).toBe("tearDown");
    expect(restart()).toBe("restart");

    void calls;
  });
});

describe("core — iOS-only microphone mode pickers", () => {
  it("getMicrophoneModeIOS forwards and returns the native value", () => {
    const cleanup = stub("getMicrophoneModeIOS", () => "general");
    expect(getMicrophoneModeIOS()).toBe("general");
    cleanup();
  });

  it("showMicrophoneModePickerIOS forwards with no args", () => {
    let called = 0;
    const cleanup = stub("showMicrophoneModePickerIOS", () => {
      called += 1;
      return undefined;
    });
    expect(showMicrophoneModePickerIOS()).toBeUndefined();
    expect(called).toBe(1);
    cleanup();
  });
});

describe("core — permissions", () => {
  it("requestMicrophonePermissionsAsync awaits the native permission response", async () => {
    const cleanup = stub("requestMicrophonePermissionsAsync", async () => {
      return { status: "granted", expires: "never", granted: true, canAskAgain: true };
    });

    const result = await requestMicrophonePermissionsAsync();
    expect(result.granted).toBe(true);
    expect(result.status).toBe("granted");
    cleanup();
  });

  it("requestMicrophonePermissionsAsync propagates native errors", async () => {
    const cleanup = stub("requestMicrophonePermissionsAsync", async () => {
      throw new Error("denied");
    });

    await expect(requestMicrophonePermissionsAsync()).rejects.toThrow("denied");
    cleanup();
  });
});

/**
 * Sanity check: in a Node test environment without a native bridge,
 * `ExpoTwoWayAudioModule` is the SSR shim (an empty plain object), so calling
 * any forwarder without an injected fake surfaces as a clear TypeError rather
 * than a silent pass. This documents the runtime contract for future agents.
 */
describe("core — SSR shim behavior", () => {
  it("ExpoTwoWayAudioModule is a plain object in node env (no native bridge)", () => {
    expect(ExpoTwoWayAudioModule).toEqual({});
    expect(typeof ExpoTwoWayAudioModule).toBe("object");
  });

  it("calling a forwarder without an injected fake throws a TypeError (no silent success)", () => {
    expect(() => isRecording()).toThrow(TypeError);
    expect(() => toggleRecording(true)).toThrow(TypeError);
    expect(() => playPCMData(new Uint8Array(0))).toThrow(TypeError);
  });
});
