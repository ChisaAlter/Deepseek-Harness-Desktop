import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { TITLEBAR_NO_DRAG_VIEW_STYLE } from "@/components/desktop/titlebar-drag-region";
import { getIsElectronRuntime, getIsElectronRuntimeMac } from "@/constants/layout";
import { isNative } from "@/constants/platform";
import {
  closeDesktopWindow,
  getDesktopWindow,
  isDesktopMaximized,
  minimizeDesktopWindow,
  toggleDesktopMaximize,
} from "@/desktop/electron/window";

/**
 * Soft Workbench custom caption buttons for Windows / Linux Electron.
 * Replaces native titleBarOverlay so − □ × live in the same Web layer as dimmers.
 */
export function DesktopWindowControls() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (isNative || !getIsElectronRuntime() || getIsElectronRuntimeMac()) {
      return;
    }

    let cancelled = false;
    const refresh = () => {
      void isDesktopMaximized()
        .then((value) => {
          if (!cancelled) setMaximized(value);
          return undefined;
        })
        .catch(() => undefined);
    };

    refresh();

    const win = getDesktopWindow();
    if (!win || typeof win.onResized !== "function") {
      return () => {
        cancelled = true;
      };
    }

    const maybeUnsub = win.onResized(() => {
      refresh();
    });

    let unsub: (() => void) | undefined;
    if (typeof maybeUnsub === "function") {
      unsub = maybeUnsub;
    } else if (maybeUnsub && typeof (maybeUnsub as Promise<() => void>).then === "function") {
      void (maybeUnsub as Promise<() => void>).then((fn) => {
        if (!cancelled) unsub = fn;
        return undefined;
      });
    }

    return () => {
      cancelled = true;
      unsub?.();
    };
  }, []);

  const handleMinimize = useCallback(() => {
    void minimizeDesktopWindow();
  }, []);
  const handleMaximize = useCallback(() => {
    void toggleDesktopMaximize().then(() =>
      isDesktopMaximized()
        .then((value) => {
          setMaximized(value);
          return undefined;
        })
        .catch(() => undefined),
    );
  }, []);
  const handleClose = useCallback(() => {
    void closeDesktopWindow();
  }, []);

  const minimizeGlyph = useMemo(() => <View style={styles.minimizeBar} />, []);
  const maximizeGlyph = useMemo(
    () =>
      maximized ? (
        <View style={styles.restoreRoot}>
          <View style={styles.restoreBack} />
          <View style={styles.restoreFront} />
        </View>
      ) : (
        <View style={styles.maximizeBox} />
      ),
    [maximized],
  );
  const closeIdleGlyph = useMemo(
    () => (
      <View style={styles.closeRoot}>
        <View style={CLOSE_ARM_A_STYLE} />
        <View style={CLOSE_ARM_B_STYLE} />
      </View>
    ),
    [],
  );
  const closeActiveGlyph = useMemo(
    () => (
      <View style={styles.closeRoot}>
        <View style={CLOSE_ARM_A_HOVER_STYLE} />
        <View style={CLOSE_ARM_B_HOVER_STYLE} />
      </View>
    ),
    [],
  );

  if (isNative || !getIsElectronRuntime() || getIsElectronRuntimeMac()) {
    return null;
  }

  return (
    <View style={CLUSTER_STYLE} testID="desktop-window-controls" pointerEvents="box-none">
      <CaptionButton
        testID="desktop-window-minimize"
        accessibilityLabel="Minimize"
        onPress={handleMinimize}
        glyph={minimizeGlyph}
      />
      <CaptionButton
        testID="desktop-window-maximize"
        accessibilityLabel={maximized ? "Restore" : "Maximize"}
        onPress={handleMaximize}
        glyph={maximizeGlyph}
      />
      <CaptionButton
        testID="desktop-window-close"
        accessibilityLabel="Close"
        onPress={handleClose}
        destructive
        glyph={closeIdleGlyph}
        activeGlyph={closeActiveGlyph}
      />
    </View>
  );
}

function CaptionButton({
  onPress,
  accessibilityLabel,
  testID,
  destructive = false,
  glyph,
  activeGlyph,
}: {
  onPress: () => void;
  accessibilityLabel: string;
  testID: string;
  destructive?: boolean;
  glyph: React.ReactNode;
  activeGlyph?: React.ReactNode;
}) {
  const buttonStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.button,
      (Boolean(hovered) || pressed) &&
        (destructive ? styles.buttonCloseHovered : styles.buttonHovered),
    ],
    [destructive],
  );

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={buttonStyle}
      testID={testID}
    >
      {({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => {
        const active = Boolean(hovered) || pressed;
        return active && activeGlyph !== undefined ? activeGlyph : glyph;
      }}
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  cluster: {
    position: "absolute",
    top: 0,
    right: 0,
    height: 48,
    flexDirection: "row",
    alignItems: "stretch",
    zIndex: 1000,
  },
  button: {
    width: 46,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
  },
  buttonHovered: {
    backgroundColor: theme.colors.surface1,
  },
  buttonCloseHovered: {
    backgroundColor: theme.colors.destructive,
  },
  minimizeBar: {
    width: 10,
    height: 1.5,
    borderRadius: 1,
    backgroundColor: theme.colors.foregroundMuted,
  },
  maximizeBox: {
    width: 10,
    height: 10,
    borderWidth: 1.5,
    borderRadius: 1,
    borderColor: theme.colors.foregroundMuted,
    backgroundColor: "transparent",
  },
  restoreRoot: {
    width: 12,
    height: 12,
    position: "relative",
  },
  restoreBack: {
    position: "absolute",
    top: 0,
    right: 0,
    width: 8,
    height: 8,
    borderWidth: 1.5,
    borderRadius: 1,
    borderColor: theme.colors.foregroundMuted,
  },
  restoreFront: {
    position: "absolute",
    left: 0,
    bottom: 0,
    width: 8,
    height: 8,
    borderWidth: 1.5,
    borderRadius: 1,
    borderColor: theme.colors.foregroundMuted,
    backgroundColor: theme.colors.surfaceWorkspace,
  },
  closeRoot: {
    width: 12,
    height: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  closeArm: {
    position: "absolute",
    width: 12,
    height: 1.5,
    borderRadius: 1,
    backgroundColor: theme.colors.foregroundMuted,
  },
  closeArmHover: {
    position: "absolute",
    width: 12,
    height: 1.5,
    borderRadius: 1,
    backgroundColor: theme.colors.destructiveForeground ?? "#ffffff",
  },
  closeArmA: {
    transform: [{ rotate: "45deg" }],
  },
  closeArmB: {
    transform: [{ rotate: "-45deg" }],
  },
}));

const CLUSTER_STYLE = [styles.cluster, TITLEBAR_NO_DRAG_VIEW_STYLE];
const CLOSE_ARM_A_STYLE = [styles.closeArm, styles.closeArmA];
const CLOSE_ARM_B_STYLE = [styles.closeArm, styles.closeArmB];
const CLOSE_ARM_A_HOVER_STYLE = [styles.closeArmHover, styles.closeArmA];
const CLOSE_ARM_B_HOVER_STYLE = [styles.closeArmHover, styles.closeArmB];
