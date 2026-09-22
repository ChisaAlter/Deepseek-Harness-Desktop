import { useCallback, useMemo } from "react";
import { Pressable, Text, View, type LayoutChangeEvent } from "react-native";
import { ChevronDown, Plus } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";

import { TerminalPane } from "@/components/terminal-pane";
import type { Theme } from "@/styles/theme";
import { isWeb } from "@/constants/platform";

const DRAWER_DEFAULT_HEIGHT = 260;
const DRAWER_MIN_HEIGHT = 160;
const DRAWER_MAX_HEIGHT = 480;

const ThemedChevronDown = withUnistyles(ChevronDown);
const ThemedPlus = withUnistyles(Plus);
const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const foregroundColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });

export interface WorkspaceTerminalDrawerProps {
  visible: boolean;
  serverId: string;
  workspaceRoot: string | null;
  terminalId: string | null;
  isWorkspaceFocused: boolean;
  createDisabled?: boolean;
  height?: number;
  onClose: () => void;
  onCreateTerminal: () => void;
  onOpenFileExplorer: () => void;
  onOpenWorkspaceFile: (request: {
    location: { path: string; line?: number | null; column?: number | null };
  }) => void;
  onHeightChange?: (height: number) => void;
}

/**
 * Bottom terminal drawer (T3 dual entry with right-panel Terminal surface).
 * Hosts the active workspace terminal session without replacing center tabs.
 */
export function WorkspaceTerminalDrawer({
  visible,
  serverId,
  workspaceRoot,
  terminalId,
  isWorkspaceFocused,
  createDisabled = false,
  height = DRAWER_DEFAULT_HEIGHT,
  onClose,
  onCreateTerminal,
  onOpenFileExplorer,
  onOpenWorkspaceFile,
  onHeightChange,
}: WorkspaceTerminalDrawerProps) {
  const { t } = useTranslation();
  const clampedHeight = Math.max(DRAWER_MIN_HEIGHT, Math.min(DRAWER_MAX_HEIGHT, height));
  const drawerStyle = useMemo(() => [styles.drawer, { height: clampedHeight }], [clampedHeight]);

  const handleLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const next = Math.round(event.nativeEvent.layout.height);
      if (Math.abs(next - clampedHeight) > 2) {
        onHeightChange?.(next);
      }
    },
    [clampedHeight, onHeightChange],
  );

  if (!visible) {
    return null;
  }

  return (
    <View style={drawerStyle} testID="workspace-terminal-drawer" onLayout={handleLayout}>
      <View style={styles.header}>
        <Text style={styles.title} numberOfLines={1}>
          {t("terminal.title")}
        </Text>
        <View style={styles.headerActions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("workspace.newTerminal")}
            disabled={createDisabled || !workspaceRoot}
            onPress={onCreateTerminal}
            style={styles.iconButton}
            testID="workspace-terminal-drawer-new"
          >
            <ThemedPlus size={16} uniProps={mutedColorMapping} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("workspace.terminalDrawer.hide")}
            onPress={onClose}
            style={styles.iconButton}
            testID="workspace-terminal-drawer-close"
          >
            <ThemedChevronDown size={16} uniProps={foregroundColorMapping} />
          </Pressable>
        </View>
      </View>

      <View style={styles.body}>
        {workspaceRoot && terminalId ? (
          <TerminalPane
            serverId={serverId}
            cwd={workspaceRoot}
            terminalId={terminalId}
            isWorkspaceFocused={isWorkspaceFocused}
            isPaneFocused={isWorkspaceFocused}
            onOpenFileExplorer={onOpenFileExplorer}
            onOpenWorkspaceFile={onOpenWorkspaceFile}
          />
        ) : (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>
              {workspaceRoot ? t("workspace.terminalDrawer.empty") : t("workspace.pathUnavailable")}
            </Text>
            {workspaceRoot ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("workspace.newTerminal")}
                disabled={createDisabled}
                onPress={onCreateTerminal}
                style={styles.emptyAction}
                testID="workspace-terminal-drawer-start"
              >
                <Text style={styles.emptyActionText}>{t("workspace.newTerminal")}</Text>
              </Pressable>
            ) : null}
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  drawer: {
    width: "100%",
    borderTopWidth: theme.borderWidth[1],
    borderTopColor: theme.colors.border,
    backgroundColor: theme.colors.surfaceWorkspace,
    ...(isWeb ? ({ boxShadow: "0 -6px 18px rgba(20, 23, 31, 0.05)" } as object) : {}),
  },
  header: {
    height: 36,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    borderBottomWidth: theme.borderWidth[1],
    borderBottomColor: theme.colors.surface2,
  },
  title: {
    fontSize: 12.5,
    lineHeight: 16,
    fontWeight: "500",
    color: theme.colors.foreground,
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
  iconButton: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  body: {
    flex: 1,
    minHeight: 0,
  },
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingHorizontal: 16,
  },
  emptyText: {
    fontSize: 13,
    lineHeight: 18,
    color: theme.colors.foregroundMuted,
    textAlign: "center",
  },
  emptyAction: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface0,
  },
  emptyActionText: {
    fontSize: 12.5,
    lineHeight: 16,
    color: theme.colors.foreground,
    fontWeight: "500",
  },
}));
