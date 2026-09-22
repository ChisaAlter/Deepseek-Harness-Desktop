import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Pressable,
  Text,
  View,
  type PressableStateCallbackType,
} from "react-native";
import Animated, { runOnJS, useAnimatedReaction } from "react-native-reanimated";
import {
  StyleSheet,
  UnistyleDependency,
  UnistylesRuntime,
  withUnistyles,
} from "react-native-unistyles";
import { encodeTerminalKeyInput } from "@chisacode/protocol/terminal-key-input";
import type { TerminalInputModeState } from "@chisacode/protocol/terminal-input-mode";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { useKeyboardShiftStyle } from "@/hooks/use-keyboard-shift-style";
import { useAppVisible } from "@/hooks/use-app-visible";
import { useStableEvent } from "@/hooks/use-stable-event";
import {
  hasPendingTerminalModifiers,
  normalizeTerminalTransportKey,
  resolvePendingModifierDataInput,
} from "@/utils/terminal-keys";
import { getWorkspaceTerminalSession } from "@/terminal/runtime/workspace-terminal-session";
import {
  TerminalStreamController,
  type TerminalStreamControllerStatus,
} from "@/terminal/runtime/terminal-stream-controller";
import { resolveTerminalRestoreOptions } from "@/terminal/runtime/terminal-restore-options";
import { usePanelStore } from "@/stores/panel-store";
import { useSessionStore } from "@/stores/session-store";
import { toXtermTheme } from "@/utils/to-xterm-theme";
import TerminalEmulator, { type TerminalEmulatorHandle } from "./terminal-emulator";
import { useIsCompactFormFactor } from "@/constants/layout";
import {
  applyTerminalRendererReadyChange,
  shouldReplayTerminalSnapshotForRenderer,
  shouldShowTerminalLoadingOverlay,
  type TerminalRendererReadyChange,
} from "@/utils/terminal-renderer-readiness";
import { useAppSettings } from "@/hooks/use-settings";
import { classifyForResolution, fetchDaemonResolution } from "@/assistant-file-links/resolver";
import type {
  TerminalLocalFileLinkSource,
  TerminalLocalFileLinkTarget,
} from "@/terminal/local-links/terminal-local-link-provider";
import {
  normalizeWorkspaceFileLocation,
  type OpenFileDisposition,
  type WorkspaceFileOpenRequest,
} from "@/workspace/file-open";
import { ErrorBoundary, SectionErrorFallback } from "@/components/error-boundary";
import { type Theme } from "@/styles/theme";

const ThemedActivityIndicator = withUnistyles(ActivityIndicator);
const foregroundMutedColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});

function readTerminalXtermTheme() {
  const theme = UnistylesRuntime.getTheme() as Theme;
  return toXtermTheme(theme.colors.terminal);
}

interface TerminalPaneProps {
  serverId: string;
  cwd: string;
  terminalId: string;
  isWorkspaceFocused: boolean;
  isPaneFocused: boolean;
  onOpenFileExplorer: () => void;
  onOpenWorkspaceFile: (request: WorkspaceFileOpenRequest) => void;
}

const TERMINAL_REFIT_DELAYS_MS = [0, 48, 144, 320];

const MODIFIER_LABELS = {
  ctrl: "Ctrl",
  shift: "Shift",
  alt: "Alt",
} as const;

const KEY_BUTTONS = {
  esc: { id: "esc", label: "Esc", key: "Escape" },
  tab: { id: "tab", label: "Tab", key: "Tab" },
  up: { id: "up", label: "↑", key: "ArrowUp" },
  down: { id: "down", label: "↓", key: "ArrowDown" },
  left: { id: "left", label: "←", key: "ArrowLeft" },
  right: { id: "right", label: "→", key: "ArrowRight" },
  enter: { id: "enter", label: "Enter", key: "Enter" },
  backspace: { id: "backspace", label: "⌫", key: "Backspace" },
  space: { id: "space", label: "Space", key: " " },
} as const;

interface ModifierState {
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
}

type PendingTerminalInput =
  | {
      type: "data";
      data: string;
    }
  | {
      type: "key";
      input: {
        key: string;
        ctrl: boolean;
        shift: boolean;
        alt: boolean;
        meta?: boolean;
      };
    };

const EMPTY_MODIFIERS: ModifierState = {
  ctrl: false,
  shift: false,
  alt: false,
};

function terminalScopeKey(input: { serverId: string; cwd: string }): string {
  return `${input.serverId}:${input.cwd}`;
}

interface ModifierButtonProps {
  modifier: keyof ModifierState;
  active: boolean;
  onToggle: (modifier: keyof ModifierState) => void;
}

function ModifierButton({ modifier, active, onToggle }: ModifierButtonProps) {
  const handlePress = useCallback(() => onToggle(modifier), [onToggle, modifier]);
  const pressableStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.keyButton,
      active && styles.keyButtonActive,
      (Boolean(hovered) || pressed) && styles.keyButtonHovered,
    ],
    [active],
  );
  const textStyle = useMemo(
    () => [styles.keyButtonText, active && styles.keyButtonTextActive],
    [active],
  );
  const modifierAccessibilityState = useMemo(() => ({ selected: active }), [active]);
  return (
    <Pressable
      testID={`terminal-key-${modifier}`}
      onPress={handlePress}
      style={pressableStyle}
      accessibilityRole="button"
      accessibilityLabel={MODIFIER_LABELS[modifier]}
      accessibilityState={modifierAccessibilityState}
    >
      <Text style={textStyle}>{MODIFIER_LABELS[modifier]}</Text>
    </Pressable>
  );
}

interface VirtualKeyButtonProps {
  id: string;
  label: string;
  keyValue: string;
  onSend: (key: string) => void;
}

function VirtualKeyButton({ id, label, keyValue, onSend }: VirtualKeyButtonProps) {
  const handlePress = useCallback(() => onSend(keyValue), [onSend, keyValue]);
  const pressableStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.keyButton,
      (Boolean(hovered) || pressed) && styles.keyButtonHovered,
    ],
    [],
  );
  return (
    <Pressable
      testID={`terminal-key-${id}`}
      onPress={handlePress}
      style={pressableStyle}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Text style={styles.keyButtonText}>{label}</Text>
    </Pressable>
  );
}

export function TerminalPane({
  serverId,
  cwd,
  terminalId,
  isWorkspaceFocused,
  isPaneFocused,
  onOpenFileExplorer,
  onOpenWorkspaceFile,
}: TerminalPaneProps) {
  const { t: terminalT } = useTranslation();
  const isAppVisible = useAppVisible();
  const { settings } = useAppSettings();
  const [xtermTheme, setXtermTheme] = useState(() => {
    try {
      return readTerminalXtermTheme();
    } catch {
      return undefined as ReturnType<typeof toXtermTheme> | undefined;
    }
  });
  useEffect(() => {
    try {
      setXtermTheme(readTerminalXtermTheme());
    } catch {
      // Theme may not be ready during bootstrap.
    }
    const dispose = StyleSheet.addChangeListener((dependencies) => {
      if (
        dependencies.includes(UnistyleDependency.Theme) ||
        dependencies.includes(UnistyleDependency.ThemeName)
      ) {
        try {
          setXtermTheme(readTerminalXtermTheme());
        } catch {
          // ignore
        }
      }
    });
    return dispose;
  }, []);
  const isMobile = useIsCompactFormFactor();
  const mobileView = usePanelStore((state) => state.mobileView);
  const showMobileAgentList = usePanelStore((state) => state.showMobileAgentList);
  const swipeGesturesEnabled = isMobile && mobileView === "agent";
  const { shift: keyboardShift, style: keyboardPaddingStyle } = useKeyboardShiftStyle({
    mode: "padding",
    enabled: isMobile,
  });

  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);
  const supportsTerminalRestoreModes = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.["terminal-restore-modes"] === true,
  );

  const scopeKey = useMemo(() => terminalScopeKey({ serverId, cwd }), [serverId, cwd]);
  const terminalStreamKey = useMemo(() => `${scopeKey}:${terminalId}`, [scopeKey, terminalId]);
  // Keep the latest measured size for whichever client currently owns the pane,
  // but only dedupe resizes that this specific client has already pushed.
  const measuredTerminalSizeRef = useRef<{ rows: number; cols: number } | null>(null);
  const lastSentTerminalSizeRef = useRef<{ rows: number; cols: number } | null>(null);
  const streamControllerRef = useRef<TerminalStreamController | null>(null);
  const workspaceTerminalSession = useMemo(
    () => getWorkspaceTerminalSession({ scopeKey }),
    [scopeKey],
  );
  const [isAttaching, setIsAttaching] = useState(false);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [rendererReadyStreamKey, setRendererReadyStreamKey] = useState<string | null>(null);
  const [modifiers, setModifiers] = useState<ModifierState>(EMPTY_MODIFIERS);
  const [focusRequestToken, setFocusRequestToken] = useState(0);
  const [resizeRequestToken, setResizeRequestToken] = useState(0);
  const emulatorRef = useRef<TerminalEmulatorHandle>(null);
  const terminalIdRef = useRef<string>(terminalId);
  const inputModeRef = useRef<TerminalInputModeState>({
    kittyKeyboardFlags: 0,
    win32InputMode: false,
  });
  const pendingTerminalInputRef = useRef<PendingTerminalInput[]>([]);
  const keyboardRefitTimeoutsRef = useRef<Array<ReturnType<typeof setTimeout>>>([]);
  const lastAutoFocusKeyRef = useRef<string | null>(null);
  const initialSnapshot = workspaceTerminalSession.snapshots.get({ terminalId });

  useEffect(() => {
    terminalIdRef.current = terminalId;
    inputModeRef.current = {
      kittyKeyboardFlags: 0,
      win32InputMode: false,
    };
  }, [terminalId]);

  const requestTerminalFocus = useCallback(() => {
    setFocusRequestToken((current) => current + 1);
  }, []);
  const requestTerminalReflow = useCallback(() => {
    setResizeRequestToken((current) => current + 1);
  }, []);
  useEffect(() => {
    if (!isMobile || !isWorkspaceFocused || mobileView === "agent") {
      return;
    }
    emulatorRef.current?.blur();
  }, [isMobile, isWorkspaceFocused, mobileView]);
  const handleRendererReadyChange = useCallback(
    (change: TerminalRendererReadyChange) => {
      setRendererReadyStreamKey((current) => applyTerminalRendererReadyChange(current, change));
      if (!shouldReplayTerminalSnapshotForRenderer({ change, terminalStreamKey })) {
        return;
      }

      const snapshot = workspaceTerminalSession.snapshots.get({ terminalId });
      if (snapshot) {
        emulatorRef.current?.renderSnapshot(snapshot);
      }
    },
    [terminalId, terminalStreamKey, workspaceTerminalSession.snapshots],
  );

  useEffect(() => {
    if (isMobile || !isWorkspaceFocused || !isPaneFocused || !terminalId) {
      lastAutoFocusKeyRef.current = null;
      return;
    }

    const nextFocusKey = `${scopeKey}:${terminalId}`;
    if (lastAutoFocusKeyRef.current === nextFocusKey) {
      return;
    }

    lastAutoFocusKeyRef.current = nextFocusKey;
    requestTerminalFocus();
  }, [isMobile, isPaneFocused, isWorkspaceFocused, requestTerminalFocus, scopeKey, terminalId]);

  useEffect(() => {
    if (isPaneFocused && isWorkspaceFocused && isAppVisible && terminalId) {
      lastSentTerminalSizeRef.current = null;
      requestTerminalReflow();
    }
  }, [isAppVisible, isPaneFocused, isWorkspaceFocused, requestTerminalReflow, terminalId]);

  const clearKeyboardRefitTimeouts = useCallback(() => {
    if (keyboardRefitTimeoutsRef.current.length === 0) {
      return;
    }
    for (const handle of keyboardRefitTimeoutsRef.current) {
      clearTimeout(handle);
    }
    keyboardRefitTimeoutsRef.current = [];
  }, []);

  const pulseKeyboardRefits = useCallback(() => {
    clearKeyboardRefitTimeouts();
    requestTerminalReflow();
    keyboardRefitTimeoutsRef.current = TERMINAL_REFIT_DELAYS_MS.map((delayMs) =>
      setTimeout(() => {
        requestTerminalReflow();
      }, delayMs),
    );
  }, [clearKeyboardRefitTimeouts, requestTerminalReflow]);

  useEffect(() => {
    return () => clearKeyboardRefitTimeouts();
  }, [clearKeyboardRefitTimeouts]);

  useAnimatedReaction(
    () => keyboardShift.value > 0,
    (next, prev) => {
      if (next === prev) {
        return;
      }
      runOnJS(pulseKeyboardRefits)();
    },
    [pulseKeyboardRefits],
  );

  useEffect(() => {
    if (!isWorkspaceFocused || !terminalId) {
      return;
    }
    // Focus transitions can temporarily report stale dimensions.
    // Pulse forced refits so xterm fills the pane when returning to a terminal.
    const timeoutHandles = TERMINAL_REFIT_DELAYS_MS.map((delayMs) =>
      setTimeout(() => {
        requestTerminalReflow();
      }, delayMs),
    );

    return () => {
      for (const handle of timeoutHandles) {
        clearTimeout(handle);
      }
    };
  }, [isWorkspaceFocused, requestTerminalReflow, terminalId]);

  useEffect(() => {
    if (!client || !isConnected || !isWorkspaceFocused) {
      return;
    }

    return client.on("terminal_stream_exit", (message) => {
      if (message.type !== "terminal_stream_exit") {
        return;
      }

      const exitedTerminalId = message.payload.terminalId;
      if (!exitedTerminalId) {
        return;
      }

      workspaceTerminalSession.snapshots.clear({ terminalId: exitedTerminalId });
      if (terminalIdRef.current === exitedTerminalId) {
        emulatorRef.current?.clear();
      }
      streamControllerRef.current?.handleTerminalExit({
        terminalId: exitedTerminalId,
      });
      setModifiers({ ...EMPTY_MODIFIERS });
    });
  }, [client, isConnected, isWorkspaceFocused, workspaceTerminalSession.snapshots]);

  useEffect(() => {
    measuredTerminalSizeRef.current = null;
    lastSentTerminalSizeRef.current = null;
  }, [scopeKey]);

  const handleStreamControllerStatus = useCallback((status: TerminalStreamControllerStatus) => {
    setIsAttaching(status.isAttaching);
    setStreamError(status.error);
  }, []);

  useEffect(() => {
    streamControllerRef.current?.dispose();
    streamControllerRef.current = null;
    setIsAttaching(false);
    setStreamError(null);

    if (!client || !isConnected) {
      return;
    }

    const controller = new TerminalStreamController({
      client,
      getPreferredSize: () => measuredTerminalSizeRef.current,
      onOutput: ({ terminalId: outputTerminalId, data }) => {
        if (!isWorkspaceFocused || terminalIdRef.current !== outputTerminalId) {
          return;
        }
        emulatorRef.current?.writeOutput(data);
      },
      onRestore: ({ terminalId: restoreTerminalId, data }) => {
        workspaceTerminalSession.snapshots.clear({ terminalId: restoreTerminalId });
        if (!isWorkspaceFocused || terminalIdRef.current !== restoreTerminalId) {
          return;
        }
        emulatorRef.current?.restoreOutput(data);
      },
      onSnapshot: ({ terminalId: snapshotTerminalId, state }) => {
        workspaceTerminalSession.snapshots.set({ terminalId: snapshotTerminalId, state });
        if (!isWorkspaceFocused || terminalIdRef.current !== snapshotTerminalId) {
          return;
        }
        emulatorRef.current?.renderSnapshot(state);
      },
      getRestoreOptions: () => {
        return resolveTerminalRestoreOptions({
          supportsTerminalRestoreModes,
          size: measuredTerminalSizeRef.current,
        });
      },
      onStatusChange: handleStreamControllerStatus,
    });

    streamControllerRef.current = controller;
    controller.setTerminal({
      terminalId: isWorkspaceFocused ? terminalIdRef.current : null,
    });

    return () => {
      controller.dispose();
      if (streamControllerRef.current === controller) {
        streamControllerRef.current = null;
      }
    };
  }, [
    client,
    handleStreamControllerStatus,
    isConnected,
    isWorkspaceFocused,
    supportsTerminalRestoreModes,
    workspaceTerminalSession.snapshots,
  ]);

  useEffect(() => {
    pendingTerminalInputRef.current = [];
    const nextTerminalId = isWorkspaceFocused ? terminalId : null;
    streamControllerRef.current?.setTerminal({
      terminalId: nextTerminalId,
    });
  }, [isWorkspaceFocused, terminalId]);

  const enqueuePendingTerminalInput = useCallback((entry: PendingTerminalInput) => {
    const queue = pendingTerminalInputRef.current;
    queue.push(entry);
    if (queue.length > 512) {
      queue.splice(0, queue.length - 512);
    }
  }, []);

  const dispatchTerminalInputEntry = useCallback(
    (entry: PendingTerminalInput): boolean => {
      if (!client) {
        return false;
      }

      const currentTerminalId = terminalIdRef.current;
      if (!currentTerminalId) {
        return false;
      }

      if (entry.type === "data") {
        client.sendTerminalInput(currentTerminalId, {
          type: "input",
          data: entry.data,
        });
        return true;
      }

      const encoded = encodeTerminalKeyInput(entry.input, {
        inputMode: inputModeRef.current,
      });
      if (encoded.length === 0) {
        return true;
      }
      client.sendTerminalInput(currentTerminalId, {
        type: "input",
        data: encoded,
      });
      return true;
    },
    [client],
  );

  const flushPendingTerminalInput = useCallback(() => {
    const queue = pendingTerminalInputRef.current;
    if (queue.length === 0) {
      return;
    }

    let sentCount = 0;
    while (sentCount < queue.length) {
      const entry = queue[sentCount];
      if (!entry) {
        break;
      }
      if (!dispatchTerminalInputEntry(entry)) {
        break;
      }
      sentCount += 1;
    }

    if (sentCount > 0) {
      queue.splice(0, sentCount);
    }
  }, [dispatchTerminalInputEntry]);

  useEffect(() => {
    if (!isAttaching && !streamError) {
      flushPendingTerminalInput();
    }
  }, [flushPendingTerminalInput, isAttaching, streamError]);

  const clearPendingModifiers = useCallback(() => {
    setModifiers({ ...EMPTY_MODIFIERS });
  }, []);

  const sendTerminalKey = useCallback(
    (input: {
      key: string;
      ctrl: boolean;
      shift: boolean;
      alt: boolean;
      meta?: boolean;
    }): boolean => {
      if (!client || !terminalIdRef.current) {
        enqueuePendingTerminalInput({
          type: "key",
          input: {
            key: normalizeTerminalTransportKey(input.key),
            ctrl: input.ctrl,
            shift: input.shift,
            alt: input.alt,
            meta: input.meta,
          },
        });
        return true;
      }

      const normalizedKey = normalizeTerminalTransportKey(input.key);
      const pendingEntry: PendingTerminalInput = {
        type: "key",
        input: {
          key: normalizedKey,
          ctrl: input.ctrl,
          shift: input.shift,
          alt: input.alt,
          meta: input.meta,
        },
      };
      if (!dispatchTerminalInputEntry(pendingEntry)) {
        enqueuePendingTerminalInput(pendingEntry);
      }
      return true;
    },
    [client, dispatchTerminalInputEntry, enqueuePendingTerminalInput],
  );

  const handleTerminalData = useCallback(
    async (data: string) => {
      if (data.length === 0) {
        return;
      }

      if (hasPendingTerminalModifiers(modifiers)) {
        const pendingResolution = resolvePendingModifierDataInput({
          data,
          pendingModifiers: modifiers,
        });
        if (pendingResolution.mode === "key") {
          if (
            sendTerminalKey({
              key: pendingResolution.key,
              ctrl: modifiers.ctrl,
              shift: modifiers.shift,
              alt: modifiers.alt,
              meta: false,
            })
          ) {
            clearPendingModifiers();
            return;
          }
        }

        if (pendingResolution.clearPendingModifiers) {
          clearPendingModifiers();
        }
      }

      if (!client || !terminalIdRef.current) {
        enqueuePendingTerminalInput({
          type: "data",
          data,
        });
        return;
      }
      const pendingEntry: PendingTerminalInput = {
        type: "data",
        data,
      };
      if (!dispatchTerminalInputEntry(pendingEntry)) {
        enqueuePendingTerminalInput(pendingEntry);
      }
    },
    [
      clearPendingModifiers,
      client,
      dispatchTerminalInputEntry,
      modifiers,
      sendTerminalKey,
      enqueuePendingTerminalInput,
    ],
  );

  const handleTerminalResize = useStableEvent((input: { rows: number; cols: number }) => {
    const { rows, cols } = input;
    if (rows <= 0 || cols <= 0) {
      return;
    }
    const normalizedRows = Math.floor(rows);
    const normalizedCols = Math.floor(cols);
    const nextSize = { rows: normalizedRows, cols: normalizedCols };
    measuredTerminalSizeRef.current = nextSize;
    if (!client || !terminalId || !isPaneFocused || !isWorkspaceFocused || !isAppVisible) {
      return;
    }
    const previousSent = lastSentTerminalSizeRef.current;
    if (
      previousSent &&
      previousSent.rows === normalizedRows &&
      previousSent.cols === normalizedCols
    ) {
      return;
    }
    lastSentTerminalSizeRef.current = nextSize;
    client.sendTerminalInput(terminalId, {
      type: "resize",
      rows: normalizedRows,
      cols: normalizedCols,
    });
  });

  const handleTerminalKey = useCallback(
    async (input: { key: string; ctrl: boolean; shift: boolean; alt: boolean; meta: boolean }) => {
      sendTerminalKey(input);
    },
    [sendTerminalKey],
  );

  const handlePendingModifiersConsumed = useCallback(() => {
    clearPendingModifiers();
  }, [clearPendingModifiers]);

  const handleInputModeChange = useCallback((state: TerminalInputModeState) => {
    inputModeRef.current = state;
  }, []);
  const handleResolveLocalFileLink = useCallback(
    async (source: TerminalLocalFileLinkSource): Promise<TerminalLocalFileLinkTarget | null> => {
      const resolution = classifyForResolution(
        { href: source.text, text: source.text, sourceType: "inline-code" },
        { workspaceRoot: cwd },
      );
      if (resolution.kind === "resolved") {
        return resolution.value.kind === "file" ? resolution.value.target : null;
      }
      if (!client) {
        return null;
      }
      try {
        return await fetchDaemonResolution({
          ambiguousQuery: resolution.ambiguousQuery,
          token: resolution.token,
          target: resolution.target,
          workspaceRoot: cwd,
          getDirectorySuggestions: (input) => client.getDirectorySuggestions(input),
        });
      } catch {
        return null;
      }
    },
    [client, cwd],
  );
  const handleOpenLocalFileLink = useCallback(
    (target: TerminalLocalFileLinkTarget, disposition: OpenFileDisposition) => {
      const location = normalizeWorkspaceFileLocation(target);
      if (!location) {
        return;
      }
      onOpenWorkspaceFile({ location, disposition });
    },
    [onOpenWorkspaceFile],
  );

  const toggleModifier = useCallback(
    (modifier: keyof ModifierState) => {
      setModifiers((current) => ({ ...current, [modifier]: !current[modifier] }));
      requestTerminalFocus();
    },
    [requestTerminalFocus],
  );

  const sendVirtualKey = useCallback(
    (key: string) => {
      sendTerminalKey({
        key,
        ctrl: modifiers.ctrl,
        shift: modifiers.shift,
        alt: modifiers.alt,
        meta: false,
      });
      clearPendingModifiers();
      requestTerminalFocus();
    },
    [
      clearPendingModifiers,
      modifiers.alt,
      modifiers.ctrl,
      modifiers.shift,
      requestTerminalFocus,
      sendTerminalKey,
    ],
  );

  const containerStyle = keyboardPaddingStyle;

  const handleSwipeRight = useCallback(() => {
    if (!swipeGesturesEnabled) return;
    emulatorRef.current?.blur();
    showMobileAgentList();
  }, [swipeGesturesEnabled, showMobileAgentList]);

  const handleSwipeLeft = useCallback(() => {
    if (!swipeGesturesEnabled) return;
    emulatorRef.current?.blur();
    onOpenFileExplorer();
  }, [swipeGesturesEnabled, onOpenFileExplorer]);
  const showLoadingOverlay = shouldShowTerminalLoadingOverlay({
    isWorkspaceFocused,
    hasStreamError: Boolean(streamError),
    isAttaching,
    rendererReadyStreamKey,
    terminalStreamKey,
  });

  const renderErrorFallback = useCallback(
    (error: unknown, resetError: () => void) => (
      <SectionErrorFallback
        error={error}
        onReset={resetError}
        sectionLabel={terminalT("errors.sectionTerminal")}
        compact
      />
    ),
    [terminalT],
  );

  if (!client || !isConnected) {
    return (
      <View style={styles.centerState}>
        <Text style={styles.stateText}>{terminalT("errors.hostDisconnected")}</Text>
      </View>
    );
  }

  return (
    <ErrorBoundary fallback={renderErrorFallback}>
      <Animated.View style={containerStyle} accessibilityLabel={terminalT("terminal.title")}>
        <View style={styles.terminalContainer}>
          <View style={styles.outputContainer} accessibilityLabel={terminalT("terminal.output")}>
            {isWorkspaceFocused ? (
              <View style={styles.terminalGestureContainer}>
                <TerminalEmulator
                  ref={emulatorRef}
                  dom={TERMINAL_EMULATOR_DOM_PROPS}
                  streamKey={terminalStreamKey}
                  testId="terminal-surface"
                  xtermTheme={xtermTheme}
                  scrollbackLines={settings.terminalScrollbackLines}
                  swipeGesturesEnabled={swipeGesturesEnabled}
                  initialSnapshot={initialSnapshot}
                  onRendererReadyChange={handleRendererReadyChange}
                  onSwipeRight={handleSwipeRight}
                  onSwipeLeft={handleSwipeLeft}
                  onInput={handleTerminalData}
                  onResize={handleTerminalResize}
                  onTerminalKey={handleTerminalKey}
                  onInputModeChange={handleInputModeChange}
                  onResolveLocalFileLink={handleResolveLocalFileLink}
                  onOpenLocalFileLink={handleOpenLocalFileLink}
                  onPendingModifiersConsumed={handlePendingModifiersConsumed}
                  pendingModifiers={modifiers}
                  focusRequestToken={focusRequestToken}
                  resizeRequestToken={resizeRequestToken}
                />
              </View>
            ) : (
              <View style={styles.terminalGestureContainer} />
            )}

            {showLoadingOverlay ? (
              <View
                style={styles.attachOverlay}
                pointerEvents="none"
                testID="terminal-attach-loading"
              >
                <ThemedActivityIndicator size="small" uniProps={foregroundMutedColorMapping} />
              </View>
            ) : null}
          </View>
        </View>

        {streamError ? (
          <View style={styles.errorRow}>
            <Text style={styles.statusError} numberOfLines={2}>
              {streamError}
            </Text>
          </View>
        ) : null}

        {isMobile ? (
          <View style={styles.keyboardContainer} testID="terminal-virtual-keyboard">
            <View style={styles.keyboardRows}>
              <View style={styles.keyboardRow}>
                {[KEY_BUTTONS.esc, KEY_BUTTONS.tab].map((button) => (
                  <VirtualKeyButton
                    key={button.id}
                    id={button.id}
                    label={button.label}
                    keyValue={button.key}
                    onSend={sendVirtualKey}
                  />
                ))}

                <ModifierButton modifier="ctrl" active={modifiers.ctrl} onToggle={toggleModifier} />

                <VirtualKeyButton
                  id={KEY_BUTTONS.up.id}
                  label={KEY_BUTTONS.up.label}
                  keyValue={KEY_BUTTONS.up.key}
                  onSend={sendVirtualKey}
                />

                <ModifierButton
                  modifier="shift"
                  active={modifiers.shift}
                  onToggle={toggleModifier}
                />

                <VirtualKeyButton
                  id={KEY_BUTTONS.backspace.id}
                  label={KEY_BUTTONS.backspace.label}
                  keyValue={KEY_BUTTONS.backspace.key}
                  onSend={sendVirtualKey}
                />
              </View>

              <View style={styles.keyboardRow}>
                <ModifierButton modifier="alt" active={modifiers.alt} onToggle={toggleModifier} />

                {[
                  KEY_BUTTONS.space,
                  KEY_BUTTONS.left,
                  KEY_BUTTONS.down,
                  KEY_BUTTONS.right,
                  KEY_BUTTONS.enter,
                ].map((button) => (
                  <VirtualKeyButton
                    key={button.id}
                    id={button.id}
                    label={button.label}
                    keyValue={button.key}
                    onSend={sendVirtualKey}
                  />
                ))}
              </View>
            </View>
          </View>
        ) : null}
      </Animated.View>
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create((theme) => ({
  terminalContainer: {
    flex: 1,
    backgroundColor: theme.colors.surface0,
  },
  outputContainer: {
    flex: 1,
    minHeight: 0,
    position: "relative",
    backgroundColor: theme.colors.background,
  },
  terminalGestureContainer: {
    flex: 1,
    minHeight: 0,
  },
  attachOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(20, 23, 31, 0.12)",
  },
  errorRow: {
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[1],
    borderTopWidth: 1,
    // Soft quiet chrome rule (--border-soft).
    borderTopColor: theme.colors.secondary,
    backgroundColor: theme.colors.surfaceWorkspace,
  },
  statusError: {
    color: theme.colors.destructive,
    fontSize: 12.5,
    lineHeight: 18,
  },
  keyboardContainer: {
    borderTopWidth: 1,
    // Soft quiet chrome rule (--border-soft).
    borderTopColor: theme.colors.secondary,
    backgroundColor: theme.colors.surface0,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[2],
  },
  keyboardRows: {
    gap: theme.spacing[1],
  },
  keyboardRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  // Soft .qb: h34 r10 shell tile.
  keyButton: {
    flex: 1,
    minWidth: 0,
    height: 34,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: theme.spacing[1],
    backgroundColor: theme.colors.surfaceWorkspace,
  },
  keyButtonHovered: {
    backgroundColor: theme.colors.surface1,
  },
  keyButtonActive: {
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface3,
  },
  keyButtonText: {
    color: theme.colors.foregroundMuted,
    fontSize: 12.5,
    lineHeight: 16,
    fontWeight: theme.fontWeight.medium,
    textAlign: "center",
  },
  keyButtonTextActive: {
    color: theme.colors.foreground,
  },
  centerState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: theme.spacing[4],
  },
  stateText: {
    color: theme.colors.foregroundMuted,
    fontSize: 14.5,
    lineHeight: 22,
    textAlign: "center",
  },
}));

const TERMINAL_EMULATOR_DOM_PROPS = {
  style: { flex: 1 },
  matchContents: false,
  scrollEnabled: true,
  nestedScrollEnabled: true,
  overScrollMode: "never" as const,
  bounces: false,
  automaticallyAdjustContentInsets: false,
  contentInsetAdjustmentBehavior: "never" as const,
};
