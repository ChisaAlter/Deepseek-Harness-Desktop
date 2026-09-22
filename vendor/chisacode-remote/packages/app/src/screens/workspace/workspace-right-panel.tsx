import { useCallback, useMemo } from "react";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { FileCode2, FolderTree, Globe2, SquareTerminal } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";

import { BrowserPane } from "@/components/browser-pane";
import { FileExplorerPane } from "@/components/file-explorer-pane";
import { TerminalPane } from "@/components/terminal-pane";
import { GitDiffPane } from "@/git/diff-pane";
import { DEFAULT_EXPLORER_SIDEBAR_WIDTH, type RightPanelSurface } from "@/stores/panel-store";
import type { Theme } from "@/styles/theme";
import { isWeb } from "@/constants/platform";
import {
  WORKBENCH_BODY_FONT_SIZE,
  WORKBENCH_BODY_LINE_HEIGHT,
  WORKBENCH_META_FONT_SIZE,
  WORKBENCH_META_LINE_HEIGHT,
} from "@/constants/layout";

const ThemedFileCode2 = withUnistyles(FileCode2);
const ThemedFolderTree = withUnistyles(FolderTree);
const ThemedGlobe2 = withUnistyles(Globe2);
const ThemedSquareTerminal = withUnistyles(SquareTerminal);

const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const foregroundColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });

export interface WorkspaceRightPanelProps {
  visible: boolean;
  activeSurface: RightPanelSurface | null;
  serverId: string;
  workspaceId: string;
  workspaceRoot: string | null;
  isGitCheckout: boolean;
  showBrowserSurface: boolean;
  terminalId: string | null;
  browserId: string | null;
  isWorkspaceFocused: boolean;
  onOpenSurface: (surface: RightPanelSurface) => void;
  onOpenFile?: (filePath: string) => void;
  onOpenFileExplorer: () => void;
  onOpenWorkspaceFile: (request: {
    location: { path: string; line?: number | null; column?: number | null };
  }) => void;
}

interface SurfaceCardSpec {
  surface: RightPanelSurface;
  titleKey: "browser" | "terminal" | "files" | "diff";
  descriptionKey: "browserDesc" | "terminalDesc" | "filesDesc" | "diffDesc";
  disabled: boolean;
  Icon: typeof ThemedFolderTree;
}

/**
 * Production desktop right rail: T3-style "Open a surface" host.
 * Surfaces: Browser / Terminal / Files / Diff. No Git write CTAs.
 */
export function WorkspaceRightPanel({
  visible,
  activeSurface,
  serverId,
  workspaceId,
  workspaceRoot,
  isGitCheckout,
  showBrowserSurface,
  terminalId,
  browserId,
  isWorkspaceFocused,
  onOpenSurface,
  onOpenFile,
  onOpenFileExplorer,
  onOpenWorkspaceFile,
}: WorkspaceRightPanelProps) {
  const hasWorkspaceRoot = Boolean(workspaceRoot && workspaceRoot.trim().length > 0);

  const cards = useMemo<SurfaceCardSpec[]>(
    () => [
      {
        surface: "browser",
        titleKey: "browser",
        descriptionKey: "browserDesc",
        disabled: !showBrowserSurface || !hasWorkspaceRoot,
        Icon: ThemedGlobe2,
      },
      {
        surface: "terminal",
        titleKey: "terminal",
        descriptionKey: "terminalDesc",
        disabled: !hasWorkspaceRoot,
        Icon: ThemedSquareTerminal,
      },
      {
        surface: "files",
        titleKey: "files",
        descriptionKey: "filesDesc",
        disabled: !hasWorkspaceRoot,
        Icon: ThemedFolderTree,
      },
      {
        surface: "diff",
        titleKey: "diff",
        descriptionKey: "diffDesc",
        disabled: !hasWorkspaceRoot || !isGitCheckout,
        Icon: ThemedFileCode2,
      },
    ],
    [hasWorkspaceRoot, isGitCheckout, showBrowserSurface],
  );

  if (!visible) {
    return null;
  }

  return (
    <View style={styles.rail} testID="workspace-right-panel">
      {activeSurface == null ? (
        <RightPanelEmptyState cards={cards} onOpenSurface={onOpenSurface} />
      ) : (
        <RightPanelSurfaceBody
          activeSurface={activeSurface}
          serverId={serverId}
          workspaceId={workspaceId}
          workspaceRoot={workspaceRoot}
          showBrowserSurface={showBrowserSurface}
          terminalId={terminalId}
          browserId={browserId}
          isWorkspaceFocused={isWorkspaceFocused}
          visible={visible}
          onOpenFile={onOpenFile}
          onOpenFileExplorer={onOpenFileExplorer}
          onOpenWorkspaceFile={onOpenWorkspaceFile}
        />
      )}
    </View>
  );
}

function RightPanelEmptyState({
  cards,
  onOpenSurface,
}: {
  cards: SurfaceCardSpec[];
  onOpenSurface: (surface: RightPanelSurface) => void;
}) {
  const { t } = useTranslation();
  return (
    <View style={styles.emptyState} testID="workspace-right-panel-empty">
      <Text style={styles.emptyTitle}>{t("workspace.rightPanel.openASurface")}</Text>
      <Text style={styles.emptySubtitle}>{t("workspace.rightPanel.chooseSurface")}</Text>
      <View style={styles.cardGrid}>
        {cards.map((card) => (
          <SurfaceCard
            key={card.surface}
            surface={card.surface}
            title={t(`workspace.rightPanel.surface.${card.titleKey}`)}
            description={t(`workspace.rightPanel.surface.${card.descriptionKey}`)}
            disabled={card.disabled}
            Icon={card.Icon}
            onOpenSurface={onOpenSurface}
            testID={`workspace-right-panel-card-${card.surface}`}
          />
        ))}
      </View>
    </View>
  );
}

function RightPanelSurfaceBody({
  activeSurface,
  serverId,
  workspaceId,
  workspaceRoot,
  showBrowserSurface,
  terminalId,
  browserId,
  isWorkspaceFocused,
  visible,
  onOpenFile,
  onOpenFileExplorer,
  onOpenWorkspaceFile,
}: {
  activeSurface: RightPanelSurface;
  serverId: string;
  workspaceId: string;
  workspaceRoot: string | null;
  showBrowserSurface: boolean;
  terminalId: string | null;
  browserId: string | null;
  isWorkspaceFocused: boolean;
  visible: boolean;
  onOpenFile?: (filePath: string) => void;
  onOpenFileExplorer: () => void;
  onOpenWorkspaceFile: (request: {
    location: { path: string; line?: number | null; column?: number | null };
  }) => void;
}) {
  const { t } = useTranslation();
  if (!workspaceRoot) {
    return (
      <View style={styles.surfaceBody} testID={`workspace-right-panel-surface-${activeSurface}`}>
        <View style={styles.surfacePlaceholder}>
          <Text style={styles.surfacePlaceholderText}>{t("workspace.pathUnavailable")}</Text>
        </View>
      </View>
    );
  }

  if (activeSurface === "files") {
    return (
      <View style={styles.surfaceBody} testID="workspace-right-panel-surface-files">
        <FileExplorerPane
          serverId={serverId}
          workspaceId={workspaceId}
          workspaceRoot={workspaceRoot}
          onOpenFile={onOpenFile}
        />
      </View>
    );
  }

  if (activeSurface === "diff") {
    return (
      <View style={styles.surfaceBody} testID="workspace-right-panel-surface-diff">
        <GitDiffPane
          serverId={serverId}
          workspaceId={workspaceId}
          cwd={workspaceRoot}
          hideHeaderRow
          enabled={visible}
        />
      </View>
    );
  }

  if (activeSurface === "terminal") {
    if (!terminalId) {
      return (
        <View style={styles.surfaceBody} testID="workspace-right-panel-surface-terminal">
          <View style={styles.surfacePlaceholder}>
            <Text style={styles.surfacePlaceholderText}>
              {t("workspace.rightPanel.startingTerminal")}
            </Text>
          </View>
        </View>
      );
    }
    return (
      <View style={styles.surfaceBody} testID="workspace-right-panel-surface-terminal">
        <TerminalPane
          serverId={serverId}
          cwd={workspaceRoot}
          terminalId={terminalId}
          isWorkspaceFocused={isWorkspaceFocused}
          isPaneFocused={isWorkspaceFocused}
          onOpenFileExplorer={onOpenFileExplorer}
          onOpenWorkspaceFile={onOpenWorkspaceFile}
        />
      </View>
    );
  }

  // browser
  if (!browserId) {
    return (
      <View style={styles.surfaceBody} testID="workspace-right-panel-surface-browser">
        <View style={styles.surfacePlaceholder} testID="workspace-right-panel-browser-host">
          <Text style={styles.surfacePlaceholderText}>
            {showBrowserSurface
              ? t("workspace.rightPanel.startingBrowser")
              : t("browser.desktopOnlyBody")}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.surfaceBody} testID="workspace-right-panel-surface-browser">
      <View style={styles.flexFill} testID="workspace-right-panel-browser-host">
        <BrowserPane
          browserId={browserId}
          serverId={serverId}
          workspaceId={workspaceId}
          cwd={workspaceRoot}
          isInteractive={isWorkspaceFocused}
        />
      </View>
    </View>
  );
}

function SurfaceCard({
  surface,
  title,
  description,
  disabled,
  Icon,
  onOpenSurface,
  testID,
}: {
  surface: RightPanelSurface;
  title: string;
  description: string;
  disabled: boolean;
  Icon: typeof ThemedFolderTree;
  onOpenSurface: (surface: RightPanelSurface) => void;
  testID: string;
}) {
  const accessibilityState = useMemo(() => ({ disabled }), [disabled]);
  const handlePress = useCallback(() => {
    onOpenSurface(surface);
  }, [onOpenSurface, surface]);
  const cardStyle = useCallback(
    ({ hovered = false, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.card,
      (Boolean(hovered) || pressed) && !disabled && styles.cardHovered,
      disabled && styles.cardDisabled,
    ],
    [disabled],
  );

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={accessibilityState}
      disabled={disabled}
      onPress={handlePress}
      style={cardStyle}
      testID={testID}
    >
      <Icon size={18} uniProps={disabled ? mutedColorMapping : foregroundColorMapping} />
      <Text style={styles.cardTitle} numberOfLines={1}>
        {title}
      </Text>
      <Text style={styles.cardDescription} numberOfLines={2}>
        {description}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  rail: {
    width: DEFAULT_EXPLORER_SIDEBAR_WIDTH,
    maxWidth: "42%",
    minWidth: 280,
    height: "100%",
    borderLeftWidth: theme.borderWidth[1],
    borderLeftColor: theme.colors.border,
    backgroundColor: theme.colors.surfaceWorkspace,
    ...(isWeb ? ({ boxShadow: "-8px 0 24px rgba(20, 23, 31, 0.04)" } as object) : {}),
  },
  emptyState: {
    flex: 1,
    minHeight: 0,
    paddingHorizontal: 16,
    paddingTop: 28,
    paddingBottom: 20,
  },
  emptyTitle: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: "600",
    color: theme.colors.foreground,
    textAlign: "center",
  },
  emptySubtitle: {
    marginTop: 6,
    fontSize: WORKBENCH_META_FONT_SIZE,
    lineHeight: WORKBENCH_META_LINE_HEIGHT,
    color: theme.colors.foregroundMuted,
    textAlign: "center",
  },
  cardGrid: {
    marginTop: 20,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  card: {
    width: "48%",
    minWidth: 120,
    flexGrow: 1,
    borderRadius: 14,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface0,
    paddingHorizontal: 12,
    paddingVertical: 14,
    gap: 6,
  },
  cardHovered: {
    backgroundColor: theme.colors.surface1,
  },
  cardDisabled: {
    opacity: 0.5,
  },
  cardTitle: {
    fontSize: 13.5,
    lineHeight: 18,
    fontWeight: "500",
    color: theme.colors.foreground,
  },
  cardDescription: {
    fontSize: 12,
    lineHeight: 16,
    color: theme.colors.foregroundMuted,
  },
  surfaceBody: {
    flex: 1,
    minHeight: 0,
  },
  flexFill: {
    flex: 1,
    minHeight: 0,
  },
  surfacePlaceholder: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
  },
  surfacePlaceholderText: {
    fontSize: WORKBENCH_BODY_FONT_SIZE,
    lineHeight: WORKBENCH_BODY_LINE_HEIGHT,
    color: theme.colors.foregroundMuted,
    textAlign: "center",
  },
}));
