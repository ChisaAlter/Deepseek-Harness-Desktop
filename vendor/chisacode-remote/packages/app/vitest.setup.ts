// @ts-nocheck
import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

// Vitest runs with `globals: false`, so testing-library cannot auto-register
// its afterEach cleanup. Without explicit unmounting, components mounted in
// one test stay subscribed to stores and re-render during later tests,
// producing "not wrapped in act(...)" noise and masking real async bugs.
afterEach(() => {
  cleanup();
});

const globalWithTestShims = globalThis as typeof globalThis & Record<string, unknown>;

globalWithTestShims.__DEV__ = false;
globalWithTestShims.IS_REACT_ACT_ENVIRONMENT = true;

if (typeof globalThis.self === "undefined") {
  globalWithTestShims.self = globalThis;
}

if (typeof globalThis.expo === "undefined") {
  class ExpoEventEmitter {
    addListener() {
      return {
        remove() {},
      };
    }
    removeListener() {}
    removeAllListeners() {}
    emit() {}
    listenerCount() {
      return 0;
    }
  }

  class ExpoSharedObject extends ExpoEventEmitter {}
  class ExpoSharedRef extends ExpoSharedObject {}
  class ExpoNativeModule extends ExpoEventEmitter {}

  globalWithTestShims.expo = {
    EventEmitter: ExpoEventEmitter,
    SharedObject: ExpoSharedObject,
    SharedRef: ExpoSharedRef,
    NativeModule: ExpoNativeModule,
    modules: {},
  };
}

if (typeof globalThis.requestAnimationFrame !== "function") {
  globalThis.requestAnimationFrame = (callback: FrameRequestCallback) =>
    setTimeout(() => callback(Date.now()), 0) as unknown as number;
}

if (typeof globalThis.cancelAnimationFrame !== "function") {
  globalThis.cancelAnimationFrame = (handle: number) => {
    clearTimeout(handle);
  };
}

if (
  typeof globalThis.window !== "undefined" &&
  typeof globalThis.window.matchMedia !== "function"
) {
  globalThis.window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

vi.mock("react-native-unistyles", () => ({
  StyleSheet: {
    absoluteFillObject: {},
    create: (styles) => styles,
    compose: (first, second) => [first, second],
  },
  useUnistyles: () => ({
    theme: {
      glass: { enabled: false },
      shadow: { sm: {}, md: {}, lg: {} },
    },
    rt: {},
    breakpoint: undefined,
  }),
  withUnistyles: (Component) => Component,
  UnistylesRuntime: {
    setTheme: vi.fn(),
    themeName: "light",
  },
}));

vi.mock("@xterm/addon-ligatures", () => ({
  LigaturesAddon: class LigaturesAddon {
    dispose(): void {}
  },
}));

vi.mock("react-native-svg", () => {
  const Stub = () => null;
  return {
    __esModule: true,
    default: Stub,
    Circle: Stub,
    Defs: Stub,
    G: Stub,
    Line: Stub,
    LinearGradient: Stub,
    Path: Stub,
    Rect: Stub,
    Stop: Stub,
    SvgCss: Stub,
    SvgCssUri: Stub,
    SvgFromXml: Stub,
    SvgUri: Stub,
    SvgXml: Stub,
    Use: Stub,
  };
});

vi.mock("expo-blur", () => ({
  BlurView: () => null,
}));

vi.mock("expo-linking", () => ({
  openURL: vi.fn().mockResolvedValue(undefined),
}));
