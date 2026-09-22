import { useMemo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Text, useWindowDimensions, View } from "react-native";
import ReanimatedAnimated from "react-native-reanimated";
import { StyleSheet } from "react-native-unistyles";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Folder } from "lucide-react-native";
import { BranchSwitcher } from "@/components/branch-switcher";
import { ComposerImportPill } from "@/composer/draft/import-pill";
import {
  resolveSoftComposerCardElevation,
  resolveSoftHomeTopInset,
} from "@/composer/draft/soft-home-layout";
import { WORKBENCH_ASSISTANT_MESSAGE_MAX_WIDTH } from "@/constants/layout";
import { shortenPath } from "@/utils/shorten-path";

export {
  resolveSoftComposerCardElevation,
  resolveSoftHomeTopInset,
} from "@/composer/draft/soft-home-layout";

export interface SoftHomeHeroProps {
  formErrorMessage?: string | null;
  /** Compact Soft Home: shorter title stack for phone height. */
  compact?: boolean;
}

/**
 * Soft Home hero: kicker + title + subtitle only (no segment / prompt chips).
 */
export function SoftHomeHero({ formErrorMessage = null, compact = false }: SoftHomeHeroProps) {
  const { t } = useTranslation();

  return (
    <View
      style={compact ? styles.softHomeHeroCompact : styles.softHomeHero}
      testID="soft-home-hero"
    >
      <Text style={compact ? styles.softHomeEyebrowCompact : styles.softHomeEyebrow}>
        {t("workspace.softHomeEyebrow")}
      </Text>
      <Text style={compact ? styles.softHomeTitleCompact : styles.softHomeTitle}>
        {t("workspace.softHomeTitle")}
      </Text>
      {compact ? null : (
        <Text style={styles.softHomeSubtitle}>{t("workspace.softHomeSubtitle")}</Text>
      )}
      {formErrorMessage ? (
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>{formErrorMessage}</Text>
        </View>
      ) : null}
    </View>
  );
}

function SoftHomePathPill({ path }: { path: string }) {
  const label = shortenPath(path) || path;
  return (
    <View testID="soft-home-path-pill" accessibilityLabel={path} style={styles.softHomePathPill}>
      <Folder size={14} color="#6f7686" />
      <Text style={styles.softHomePathPillText} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

export interface SoftHomeBranchContext {
  currentBranchName: string | null;
  serverId: string;
  workspaceId: string;
  isGitCheckout: boolean;
}

export interface SoftHomeContextRowProps {
  workspacePath?: string | null;
  branchContext?: SoftHomeBranchContext | null;
  onImportPress?: (() => void) | null;
  /** Interactive path / branch / import row from /new Soft Home. */
  children?: ReactNode;
}

/**
 * Path / branch / import row above the Soft Home pen-bar.
 * Pass `children` for interactive directory/branch pickers; otherwise display pills.
 */
export function SoftHomeContextRow({
  workspacePath = null,
  branchContext = null,
  onImportPress = null,
  children = null,
}: SoftHomeContextRowProps) {
  if (children) {
    return (
      <View style={styles.softHomeContextRow} testID="soft-home-context-row">
        {children}
      </View>
    );
  }

  const showContextRow = Boolean(workspacePath || branchContext || onImportPress);
  if (!showContextRow) {
    return null;
  }

  // Prefer a real branch name; fall back so git Soft Home still exposes the switcher
  // (matches /new Soft Home, which shows a branch pill even before checkout resolves).
  let branchTitle: string | null = null;
  let branchNameForSwitcher: string | null = null;
  if (branchContext?.isGitCheckout) {
    const resolved =
      branchContext.currentBranchName && branchContext.currentBranchName !== "HEAD"
        ? branchContext.currentBranchName
        : null;
    branchNameForSwitcher = resolved;
    branchTitle = resolved ?? "main";
  }

  return (
    <View style={styles.softHomeContextRow} testID="soft-home-context-row">
      <View style={styles.softHomeContextPills}>
        {workspacePath ? <SoftHomePathPill path={workspacePath} /> : null}
        {branchContext && branchTitle ? (
          <BranchSwitcher
            currentBranchName={branchNameForSwitcher}
            title={branchTitle}
            serverId={branchContext.serverId}
            // BranchSwitcher / useBranchSwitcher treat this as git cwd (path), not opaque id.
            workspaceId={branchContext.workspaceId}
            isGitCheckout={branchContext.isGitCheckout}
            presentation="soft-pill"
          />
        ) : null}
      </View>
      {onImportPress ? <ComposerImportPill onPress={onImportPress} /> : null}
    </View>
  );
}

export interface SoftHomeEmptyProps {
  formErrorMessage?: string | null;
  /** Optional keyboard shift style for the composer shell. */
  composerKeyboardStyle?: object;
  /**
   * Content above the pen-bar (path/branch/import). Prefer SoftHomeContextRow.
   */
  contextSlot?: ReactNode;
  /**
   * Compact Soft Home: tighter optical inset + mini hero (not a bottom-sheet-only dock).
   */
  compact?: boolean;
  children: ReactNode;
}

/**
 * Shared Soft Home shell: centered hero + context row + floating pen-bar.
 * Used by default /new Soft Home and workspace draft empty center.
 */
export function SoftHomeEmpty({
  formErrorMessage = null,
  composerKeyboardStyle,
  contextSlot = null,
  compact = false,
  children,
}: SoftHomeEmptyProps) {
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();

  // Optical vertical placement from window height — does not depend on flex free space.
  const softHomeTopInset = useMemo(
    () => resolveSoftHomeTopInset(windowHeight, compact),
    [compact, windowHeight],
  );

  const containerStyle = useMemo(
    () => [
      styles.container,
      compact ? styles.containerCompact : null,
      {
        paddingTop: softHomeTopInset,
        paddingBottom: Math.max(insets.bottom, compact ? 16 : 40),
      },
    ],
    [compact, insets.bottom, softHomeTopInset],
  );

  const composerShell = (
    <View style={styles.softHomeComposerShell}>
      {contextSlot}
      {children}
    </View>
  );

  return (
    <View style={containerStyle} testID="soft-home-empty">
      <View style={styles.softHomeInner}>
        <SoftHomeHero formErrorMessage={formErrorMessage} compact={compact} />
        {composerKeyboardStyle ? (
          <ReanimatedAnimated.View style={composerKeyboardStyle}>
            {composerShell}
          </ReanimatedAnimated.View>
        ) : (
          composerShell
        )}
      </View>
    </View>
  );
}

export const softHomeComposerInputWrapperStyle = {
  borderRadius: 18,
  ...resolveSoftComposerCardElevation(),
} as const;

/** Soft Home: zero Composer dock horizontal padding so path/import share pen-bar width. */
export const softHomeComposerInputAreaStyle = {
  paddingLeft: 0,
  paddingRight: 0,
  paddingTop: 0,
  paddingBottom: 0,
} as const;

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    flexDirection: "column",
    width: "100%",
    minWidth: 0,
    minHeight: 0,
    // Visible so the pen-bar soft shadow is not clipped into hard corners.
    overflow: "visible",
    backgroundColor: theme.colors.surfaceWorkspace,
    // Match session host inset so Soft Home pen-bar width tracks the chat dock.
    paddingHorizontal: 20,
  },
  // Compact Soft Home keeps a single host inset; composer dock padding is zeroed.
  containerCompact: {
    paddingHorizontal: 12,
    justifyContent: "flex-start",
  },
  softHomeInner: {
    width: "100%",
    maxWidth: WORKBENCH_ASSISTANT_MESSAGE_MAX_WIDTH,
    alignSelf: "center",
    flexShrink: 0,
    gap: theme.spacing[4],
  },
  softHomeHero: {
    width: "100%",
    alignItems: "center",
    gap: theme.spacing[1.5],
  },
  softHomeHeroCompact: {
    width: "100%",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  softHomeEyebrow: {
    color: theme.colors.foregroundMuted,
    fontSize: 12.5,
    lineHeight: 16,
    textAlign: "center",
  },
  softHomeEyebrowCompact: {
    color: theme.colors.foregroundMuted,
    fontSize: 12,
    lineHeight: 16,
    textAlign: "center",
  },
  softHomeTitle: {
    color: theme.colors.foreground,
    fontSize: 36,
    fontWeight: theme.fontWeight.bold,
    letterSpacing: -0.8,
    textAlign: "center",
    lineHeight: 42,
  },
  softHomeTitleCompact: {
    color: theme.colors.foreground,
    fontSize: 24,
    fontWeight: theme.fontWeight.bold,
    letterSpacing: -0.4,
    textAlign: "center",
    lineHeight: 30,
  },
  softHomeSubtitle: {
    color: theme.colors.foreground,
    fontSize: 28,
    fontWeight: theme.fontWeight.semibold,
    letterSpacing: -0.5,
    textAlign: "center",
    lineHeight: 34,
  },
  softHomeComposerShell: {
    width: "100%",
    gap: theme.spacing[2],
  },
  // Path / branch left, import right — never wider than the pen-bar below.
  softHomeContextRow: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
    minWidth: 0,
  },
  softHomeContextPills: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: theme.spacing[2],
  },
  softHomePathPill: {
    flexDirection: "row",
    alignItems: "center",
    height: 30,
    maxWidth: 220,
    paddingHorizontal: 10,
    borderRadius: theme.borderRadius.full,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface0,
    gap: 6,
  },
  softHomePathPillText: {
    color: theme.colors.foregroundMuted,
    fontSize: 12.5,
    lineHeight: 16,
    flexShrink: 1,
  },
  errorContainer: {
    marginTop: theme.spacing[2],
    width: "100%",
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    borderRadius: 14,
    backgroundColor: theme.colors.surface0,
    borderWidth: 1,
    borderColor: theme.colors.destructive,
  },
  errorText: {
    color: theme.colors.destructive,
  },
}));
