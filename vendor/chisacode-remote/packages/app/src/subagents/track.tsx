import { useCallback, useMemo, useState, type ReactElement } from "react";
import { Pressable, ScrollView, Text, View, type PressableStateCallbackType } from "react-native";
import { Archive, ChevronDown, ChevronRight } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { getProviderIcon } from "@/components/provider-icons";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useIsCompactFormFactor, MAX_CONTENT_WIDTH } from "@/constants/layout";
import { isNative, isWeb } from "@/constants/platform";
import {
  WorkspaceTabIcon,
  type WorkspaceTabPresentation,
} from "@/screens/workspace/workspace-tab-presentation";
import type { Theme } from "@/styles/theme";
import type { SubagentRow } from "./select";
import { buildSubagentRowPresentationData, formatHeaderLabel } from "./track-presentation";

const ThemedArchive = withUnistyles(Archive);
const ThemedChevronDown = withUnistyles(ChevronDown);
const ThemedChevronRight = withUnistyles(ChevronRight);

const foregroundColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const foregroundMutedColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});

export interface SubagentsTrackProps {
  rows: SubagentRow[];
  onOpenSubagent: (id: string) => void;
  onArchiveSubagent: (id: string) => void;
}

const SUBAGENTS_LIST_MAX_HEIGHT = 200;

function buildRowPresentation(row: SubagentRow): WorkspaceTabPresentation {
  return {
    ...buildSubagentRowPresentationData(row),
    icon: getProviderIcon(row.provider),
  };
}

export function SubagentsTrack({
  rows,
  onOpenSubagent,
  onArchiveSubagent,
}: SubagentsTrackProps): ReactElement | null {
  const [expanded, setExpanded] = useState(false);

  const toggleExpanded = useCallback(() => {
    setExpanded((current) => !current);
  }, []);

  const surfaceStyle = useMemo(
    () => [styles.surface, expanded && styles.surfaceExpanded],
    [expanded],
  );

  const headerStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType) => [
      styles.header,
      expanded ? styles.headerDivider : styles.headerCollapsed,
      (hovered || pressed) && styles.headerActive,
    ],
    [expanded],
  );

  if (rows.length === 0) {
    return null;
  }

  const headerLabel = formatHeaderLabel(rows);

  return (
    <View style={styles.outer} testID="subagents-track">
      <View style={styles.track}>
        <View style={surfaceStyle}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={headerLabel}
            testID="subagents-track-header"
            onPress={toggleExpanded}
            style={headerStyle}
          >
            {expanded ? (
              <ThemedChevronDown size={12} uniProps={foregroundMutedColorMapping} />
            ) : (
              <ThemedChevronRight size={12} uniProps={foregroundMutedColorMapping} />
            )}
            <Text style={styles.headerLabel} numberOfLines={1}>
              {headerLabel}
            </Text>
          </Pressable>
          {expanded ? (
            <ScrollView
              style={styles.scroll}
              contentContainerStyle={styles.scrollContent}
              showsVerticalScrollIndicator={false}
              nestedScrollEnabled
            >
              {rows.map((row) => (
                <SubagentsTrackRow
                  key={row.id}
                  row={row}
                  onOpenSubagent={onOpenSubagent}
                  onArchiveSubagent={onArchiveSubagent}
                />
              ))}
            </ScrollView>
          ) : null}
        </View>
      </View>
    </View>
  );
}

interface SubagentsTrackRowProps {
  row: SubagentRow;
  onOpenSubagent: (id: string) => void;
  onArchiveSubagent: (id: string) => void;
}

function SubagentsTrackRow({
  row,
  onOpenSubagent,
  onArchiveSubagent,
}: SubagentsTrackRowProps): ReactElement {
  const isCompact = useIsCompactFormFactor();
  const [hovered, setHovered] = useState(false);
  const presentation = useMemo(() => buildRowPresentation(row), [row]);
  const displayLabel = presentation.titleState === "loading" ? "加载中..." : presentation.label;
  const handlePress = useCallback(() => {
    onOpenSubagent(row.id);
  }, [onOpenSubagent, row.id]);
  const handleArchivePress = useCallback(() => {
    onArchiveSubagent(row.id);
  }, [onArchiveSubagent, row.id]);
  const handlePointerEnter = useCallback(() => setHovered(true), []);
  const handlePointerLeave = useCallback(() => setHovered(false), []);
  const archiveAlwaysVisible = isNative || isCompact;
  const archiveVisible = archiveAlwaysVisible || hovered;

  return (
    // Wrapper View handles hover so moving the pointer between the row and
    // the archive button doesn't drop the hover state — the same pattern
    // used by sidebar workspace rows.
    <View onPointerEnter={handlePointerEnter} onPointerLeave={handlePointerLeave}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={displayLabel}
        testID={`subagents-track-row-${row.id}`}
        onPress={handlePress}
      >
        {({ pressed }) => (
          <View style={hovered || pressed ? styles.rowActive : styles.row}>
            <WorkspaceTabIcon presentation={presentation} />
            <Text style={styles.rowLabel} numberOfLines={1}>
              {displayLabel}
            </Text>
            <SubagentArchiveButton
              rowId={row.id}
              displayLabel={displayLabel}
              visible={archiveVisible}
              onPress={handleArchivePress}
            />
          </View>
        )}
      </Pressable>
    </View>
  );
}

function SubagentArchiveButton({
  rowId,
  displayLabel,
  visible,
  onPress,
}: {
  rowId: string;
  displayLabel: string;
  visible: boolean;
  onPress: () => void;
}): ReactElement {
  return (
    <View
      style={visible ? styles.archiveSlotVisible : styles.archiveSlotHidden}
      pointerEvents={visible ? "auto" : "none"}
    >
      <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile={false}>
        <TooltipTrigger asChild disabled={!visible}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`归档 ${displayLabel}`}
            testID={`subagents-track-archive-${rowId}`}
            onPress={onPress}
            style={styles.archiveButton}
            hitSlop={8}
          >
            {({ hovered, pressed }) => (
              <ThemedArchive
                size={14}
                uniProps={hovered || pressed ? foregroundColorMapping : foregroundMutedColorMapping}
              />
            )}
          </Pressable>
        </TooltipTrigger>
        <TooltipContent side="top" align="center" offset={8}>
          <Text style={styles.tooltipText}>归档子智能体</Text>
        </TooltipContent>
      </Tooltip>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  outer: {
    width: "100%",
    alignItems: "center",
    paddingHorizontal: theme.spacing[4],
  },
  track: {
    width: "100%",
    maxWidth: MAX_CONTENT_WIDTH,
    marginBottom: -theme.spacing[4],
  },
  // Soft subagent shelf: quiet elevated surface above pen-bar.
  surface: {
    alignSelf: "stretch",
    backgroundColor: theme.colors.surface0,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    borderBottomWidth: 0,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    overflow: "hidden",
    ...(isWeb
      ? ({
          boxShadow: "0 1px 2px rgba(20, 23, 31, 0.04), 0 8px 24px rgba(20, 23, 31, 0.06)",
        } as object)
      : theme.shadow.sm),
  },
  surfaceExpanded: {
    paddingBottom: theme.spacing[4],
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
  },
  headerCollapsed: {
    paddingBottom: theme.spacing[6],
  },
  // Soft selected wash: surface3 (surface1 remains hover-only).
  headerActive: {
    backgroundColor: theme.colors.surface3,
  },
  headerDivider: {
    borderBottomWidth: theme.borderWidth[1],
    // Soft quiet chrome rule (--border-soft).
    borderBottomColor: theme.colors.secondary,
  },
  headerLabel: {
    flexShrink: 1,
    minWidth: 0,
    fontSize: 12.5,
    lineHeight: 16,
    color: theme.colors.foregroundMuted,
  },
  scroll: {
    maxHeight: SUBAGENTS_LIST_MAX_HEIGHT,
  },
  scrollContent: {
    paddingVertical: theme.spacing[1],
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
  },
  rowActive: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    backgroundColor: theme.colors.surfaceWorkspace,
  },
  // Soft list row label: 12.5 meta chrome.
  rowLabel: {
    flex: 1,
    minWidth: 0,
    fontSize: 12.5,
    lineHeight: 16,
    color: theme.colors.foreground,
  },
  archiveSlotVisible: {
    opacity: 1,
  },
  archiveSlotHidden: {
    opacity: 0,
  },
  archiveButton: {
    padding: theme.spacing[1],
    alignItems: "center",
    justifyContent: "center",
  },
  tooltipText: {
    fontSize: 12.5,
    lineHeight: 16,
    color: theme.colors.foreground,
  },
}));
