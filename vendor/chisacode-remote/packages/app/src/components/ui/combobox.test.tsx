import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Combobox, type ComboboxOption } from "./combobox";

const EMPTY_OPTIONS: ComboboxOption[] = [];

const { theme, floatingSurfaceProps } = vi.hoisted(() => ({
  theme: {
    spacing: { 1: 4, 2: 8, 3: 12, 6: 24, 8: 32 },
    borderWidth: { 1: 1 },
    borderRadius: { lg: 8, "2xl": 16 },
    fontSize: { xs: 12, sm: 14, lg: 18 },
    fontWeight: { medium: "500" },
    iconSize: { sm: 14, md: 16 },
    shadow: { md: {} },
    colors: {
      border: "#333",
      foreground: "#fff",
      foregroundMuted: "#aaa",
      palette: { zinc: { 600: "#52525b" } },
      surface0: "#000",
      surface1: "#111",
    },
  },
  floatingSurfaceProps: [] as Array<{ fillFrame?: boolean; fillContent?: boolean }>,
}));

vi.mock("react-native", () => ({
  Modal: ({ children, visible }: { children: React.ReactNode; visible?: boolean }) =>
    visible === false ? null : <div>{children}</div>,
  Platform: { OS: "web" },
  Pressable: ({
    children,
    onPress,
    testID,
  }: {
    children:
      | React.ReactNode
      | ((state: { pressed: boolean; hovered: boolean }) => React.ReactNode);
    onPress?: () => void;
    testID?: string;
  }) => (
    <button data-testid={testID} onClick={onPress} type="button">
      {typeof children === "function" ? children({ pressed: false, hovered: false }) : children}
    </button>
  ),
  ScrollView: ({ children, testID }: { children: React.ReactNode; testID?: string }) => (
    <div data-testid={testID}>{children}</div>
  ),
  StatusBar: { currentHeight: 0 },
  Text: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  TextInput: () => <input />,
  useWindowDimensions: () => ({ width: 1024, height: 768 }),
  View: React.forwardRef<HTMLDivElement, { children?: React.ReactNode; style?: unknown }>(
    function View({ children }, ref) {
      return <div ref={ref}>{children}</div>;
    },
  ),
}));

vi.mock("react-native-reanimated", () => ({
  default: {
    View: React.forwardRef<HTMLDivElement, { children?: React.ReactNode }>(function AnimatedView(
      { children },
      ref,
    ) {
      return <div ref={ref}>{children}</div>;
    }),
  },
  FadeIn: { duration: () => undefined },
  FadeOut: { duration: () => undefined },
}));

vi.mock("react-native-unistyles", () => ({
  StyleSheet: {
    absoluteFillObject: {},
    create: (factory: unknown) => (typeof factory === "function" ? factory(theme) : factory),
  },
  useUnistyles: () => ({ theme }),
  withUnistyles: (Component: unknown) => Component,
}));

vi.mock("@/constants/layout", () => ({
  WORKBENCH_ENVIRONMENT_PANEL_SHADOW: "none",
  useIsCompactFormFactor: () => false,
}));

vi.mock("@/constants/platform", () => ({
  isWeb: true,
}));

vi.mock("@floating-ui/react-native", () => ({
  flip: () => ({}),
  offset: () => ({}),
  shift: () => ({}),
  size: () => ({}),
  useFloating: () => ({
    refs: {
      setFloating: vi.fn(),
      setOffsetParent: vi.fn(),
    },
    floatingStyles: { left: 20, top: 20 },
    update: vi.fn(),
  }),
}));

vi.mock("@/components/ui/floating", () => ({
  FloatingSurface: ({
    children,
    fillContent,
    fillFrame,
  }: {
    children: React.ReactNode;
    fillContent?: boolean;
    fillFrame?: boolean;
  }) => {
    floatingSurfaceProps.push({ fillContent, fillFrame });
    return <div>{children}</div>;
  },
}));

vi.mock("@/components/adaptive-modal-sheet", () => ({
  AdaptiveTextInput: () => <input />,
  InlineHeaderView: () => null,
  SheetHeaderView: () => null,
}));

vi.mock("@/components/ui/isolated-bottom-sheet-modal", () => ({
  IsolatedBottomSheetModal: () => null,
  useIsolatedBottomSheetVisibility: () => ({
    sheetRef: { current: null },
    handleSheetChange: vi.fn(),
    handleSheetDismiss: vi.fn(),
  }),
}));

vi.mock("@gorhom/bottom-sheet", () => ({
  BottomSheetBackdrop: () => null,
  BottomSheetScrollView: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("lucide-react-native", () => ({
  Check: () => <span />,
  File: () => <span />,
  Folder: () => <span />,
  Search: () => <span />,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

function createMeasuredAnchorRef() {
  const anchor = document.createElement("div") as HTMLDivElement & {
    measureInWindow: (callback: (x: number, y: number, width: number) => void) => void;
  };
  anchor.measureInWindow = (callback) => callback(20, 500, 180);
  return { current: anchor as never };
}

describe("Combobox", () => {
  let root: Root | null = null;
  let container: HTMLElement | null = null;

  beforeEach(() => {
    const dom = new JSDOM("<!doctype html><html><body></body></html>");
    vi.stubGlobal("React", React);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("window", dom.window);
    vi.stubGlobal("document", dom.window.document);
    vi.stubGlobal("HTMLElement", dom.window.HTMLElement);
    vi.stubGlobal("Node", dom.window.Node);
    vi.stubGlobal("navigator", dom.window.navigator);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    floatingSurfaceProps.length = 0;

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    if (root) {
      act(() => {
        root?.unmount();
      });
    }
    root = null;
    container?.remove();
    container = null;
    vi.unstubAllGlobals();
  });

  it("fills fixed-height desktop child popovers so inner lists can scroll", () => {
    const anchorRef = createMeasuredAnchorRef();

    act(() => {
      root?.render(
        <Combobox
          anchorRef={anchorRef}
          desktopFixedHeight={320}
          onSelect={vi.fn()}
          open
          options={EMPTY_OPTIONS}
          value=""
        >
          <div>Scrollable models</div>
        </Combobox>,
      );
    });

    expect(floatingSurfaceProps).toContainEqual({ fillContent: true, fillFrame: true });
  });
});
