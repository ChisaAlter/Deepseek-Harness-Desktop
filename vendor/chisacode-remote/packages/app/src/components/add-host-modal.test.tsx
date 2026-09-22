/**
 * @vitest-environment jsdom
 */
import React, { useImperativeHandle, useRef } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HostProfile } from "@/types/host-connection";
import { AddHostModal } from "./add-host-modal";

const { theme, probeAndUpsertDirectConnectionMock } = vi.hoisted(() => {
  const globals = globalThis as typeof globalThis & { __DEV__?: boolean };
  globals.__DEV__ = false;
  return {
    probeAndUpsertDirectConnectionMock: vi.fn(),
    theme: {
      spacing: { 1: 4, 2: 8, 3: 12, 4: 16 },
      borderRadius: { sm: 4, lg: 8 },
      fontSize: { sm: 13, base: 15 },
      fontWeight: { medium: "500" },
      colors: {
        accent: "#0a84ff",
        accentForeground: "#fff",
        border: "#d0d0d0",
        destructive: "#ef4444",
        foreground: "#111",
        foregroundMuted: "#666",
        surface2: "#f2f2f2",
        palette: { white: "#fff" },
      },
    },
  };
});

vi.mock("react-native-unistyles", () => ({
  StyleSheet: {
    create: (factory: unknown) => (typeof factory === "function" ? factory(theme) : factory),
  },
  useUnistyles: () => ({ theme }),
  withUnistyles: (Component: unknown) => Component,
}));

vi.mock("@/constants/layout", () => ({
  useIsCompactFormFactor: () => true,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, string>) => {
      if (key === "host.hostRequired") return "请输入主机地址";
      if (key === "host.invalidPort") return "端口无效";
      if (key === "host.unableToConnectTitle") return `无法连接 ${values?.endpoint ?? ""}`;
      return key;
    },
  }),
}));

vi.mock("lucide-react-native", async () => {
  const ReactModule = await import("react");
  const Icon = () => ReactModule.createElement("span");
  return {
    Check: Icon,
    ChevronDown: Icon,
    ChevronRight: Icon,
    Eye: Icon,
    EyeOff: Icon,
    Link2: Icon,
  };
});

vi.mock("@/runtime/host-runtime", () => ({
  useHosts: () => [],
  useHostMutations: () => ({
    probeAndUpsertDirectConnection: probeAndUpsertDirectConnectionMock,
  }),
}));

vi.mock("@/components/adaptive-modal-sheet", async () => {
  const ReactModule = await import("react");

  interface ClearableInput {
    clear: () => void;
  }

  const AdaptiveModalSheet = ({
    visible,
    children,
    testID,
  }: {
    visible: boolean;
    children: React.ReactNode;
    testID?: string;
  }) =>
    visible
      ? ReactModule.createElement(
          "div",
          { "data-testid": testID ?? "adaptive-modal-sheet" },
          children,
        )
      : null;

  const AdaptiveTextInput = ReactModule.forwardRef<
    ClearableInput,
    {
      initialValue?: string;
      defaultValue?: string;
      editable?: boolean;
      testID?: string;
      value?: string;
      onChangeText?: (next: string) => void;
      onSubmitEditing?: () => void;
    }
  >(function AdaptiveTextInputMock(props, ref) {
    const inputRef = useRef<HTMLInputElement>(null);
    useImperativeHandle(
      ref,
      () => ({
        clear: () => {
          if (inputRef.current) {
            inputRef.current.value = "";
          }
        },
      }),
      [],
    );
    return ReactModule.createElement("input", {
      ref: inputRef,
      defaultValue: props.initialValue ?? props.defaultValue ?? "",
      disabled: props.editable === false,
      "data-testid": props.testID,
      onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
        props.onChangeText?.(event.target.value),
      onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => {
        if (event.key === "Enter") {
          event.preventDefault();
          props.onSubmitEditing?.();
        }
      },
    });
  });

  return { AdaptiveModalSheet, AdaptiveTextInput };
});

vi.mock("@/components/ui/button", async () => {
  const ReactModule = await import("react");
  return {
    Button: ({
      children,
      disabled,
      onPress,
      testID,
    }: {
      children?: React.ReactNode;
      disabled?: boolean;
      onPress?: () => void;
      testID?: string;
    }) =>
      ReactModule.createElement(
        "button",
        {
          disabled: disabled || undefined,
          "data-testid": testID,
          onClick: () => {
            if (!disabled) onPress?.();
          },
          type: "button",
        },
        children,
      ),
  };
});

function hostProfile(): HostProfile {
  return {
    serverId: "server-1",
    label: "DESKTOP",
    lifecycle: {},
    connections: [],
    preferredConnectionId: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("AddHostModal", () => {
  beforeEach(() => {
    vi.stubGlobal("React", React);
    probeAndUpsertDirectConnectionMock.mockReset();
    probeAndUpsertDirectConnectionMock.mockResolvedValue({
      profile: hostProfile(),
      serverId: "server-1",
      hostname: "DESKTOP",
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("submits the direct host value captured from native-owned text input", async () => {
    const onClose = vi.fn();

    render(<AddHostModal visible onClose={onClose} />);

    fireEvent.change(screen.getByTestId("direct-host-input"), {
      target: { value: "127.0.0.1" },
    });
    fireEvent.click(screen.getByTestId("direct-host-submit"));

    await waitFor(() => {
      expect(probeAndUpsertDirectConnectionMock).toHaveBeenCalledWith({
        endpoint: "127.0.0.1:6767",
        useTls: false,
      });
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("uses localhost as the default direct connection host", async () => {
    render(<AddHostModal visible onClose={vi.fn()} />);

    fireEvent.click(screen.getByTestId("direct-host-submit"));

    await waitFor(() => {
      expect(probeAndUpsertDirectConnectionMock).toHaveBeenCalledWith({
        endpoint: "localhost:6767",
        useTls: false,
      });
    });
  });
});
