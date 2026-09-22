import {
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  type PressableStateCallbackType,
} from "react-native";
import { memo, useCallback, useEffect, useMemo, useRef, type ReactNode } from "react";
import {
  Bot,
  GitCompare,
  Home,
  MessagesSquare,
  PanelRight,
  Plus,
  Settings,
  TerminalSquare,
} from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { ThemedIconHost } from "@/components/themed-icon-host";
import { useCommandCenter } from "@/hooks/use-command-center";
import type { AggregatedAgent } from "@/hooks/use-aggregated-agents";
import { formatTimeAgo } from "@/utils/time";
import { shortenPath } from "@/utils/shorten-path";
import { AgentStatusDot } from "@/components/agent-status-dot";
import { Shortcut } from "@/components/ui/shortcut";
import type { Theme } from "@/styles/theme";

import { useTranslation } from "react-i18next";

// Inject theme colors via ThemedIconHost so call-site `uniProps` never reaches
// lucide leaves (web withUnistyles merges props onto the child).
// `TextInput.placeholderTextColor` is a non-style prop Unistyles does not track
// via the `style` prop, so wrap TextInput and map it through `uniProps`.
const ThemedTextInput = withUnistyles(TextInput);

const foregroundMutedColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});
const placeholderTextColorMapping = (theme: Theme) => ({
  placeholderTextColor: theme.colors.foregroundMuted,
});

function agentKey(agent: Pick<AggregatedAgent, "serverId" | "id">): string {
  return `${agent.serverId}:${agent.id}`;
}

interface CommandCenterRowProps {
  active: boolean;
  accessibilityLabel?: string;
  children: ReactNode;
  onPress: () => void;
  registerRow: (el: View | null) => void;
}

const CommandCenterRow = memo(function CommandCenterRow({
  active,
  accessibilityLabel,
  children,
  onPress,
  registerRow,
}: CommandCenterRowProps) {
  const pressableStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.row,
      (Boolean(hovered) || pressed || active) && styles.rowActive,
    ],
    [active],
  );
  const accessibilityState = useMemo(() => ({ selected: active }), [active]);

  return (
    <Pressable
      ref={registerRow}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={accessibilityState}
      style={pressableStyle}
      onPress={onPress}
    >
      {children}
    </Pressable>
  );
});

interface CommandCenterRowContainerProps {
  rowIndex: number;
  active: boolean;
  accessibilityLabel?: string;
  rowRefs: React.MutableRefObject<Map<number, View>>;
  onPress: () => void;
  children: ReactNode;
}

function CommandCenterRowContainer({
  rowIndex,
  active,
  accessibilityLabel,
  rowRefs,
  onPress,
  children,
}: CommandCenterRowContainerProps) {
  const registerRow = useCallback(
    (el: View | null) => {
      if (el) rowRefs.current.set(rowIndex, el);
      else rowRefs.current.delete(rowIndex);
    },
    [rowRefs, rowIndex],
  );
  return (
    <CommandCenterRow
      active={active}
      accessibilityLabel={accessibilityLabel}
      registerRow={registerRow}
      onPress={onPress}
    >
      {children}
    </CommandCenterRow>
  );
}

interface CommandCenterActionRowProps {
  item: Extract<ReturnType<typeof useCommandCenter>["items"][number], { kind: "action" }>;
  rowIndex: number;
  active: boolean;
  rowRefs: React.MutableRefObject<Map<number, View>>;
  onSelect: (item: ReturnType<typeof useCommandCenter>["items"][number]) => void;
}

function CommandCenterActionRow({
  item,
  rowIndex,
  active,
  rowRefs,
  onSelect,
}: CommandCenterActionRowProps) {
  const handlePress = useCallback(() => onSelect(item), [onSelect, item]);
  const action = item.action;
  let actionIcon: React.ReactNode = null;
  if (action.icon === "plus") {
    actionIcon = (
      <ThemedIconHost
        Icon={Plus}
        size={16}
        strokeWidth={2.4}
        uniProps={foregroundMutedColorMapping}
      />
    );
  } else if (action.icon === "settings") {
    actionIcon = (
      <ThemedIconHost
        Icon={Settings}
        size={16}
        strokeWidth={2.2}
        uniProps={foregroundMutedColorMapping}
      />
    );
  } else if (action.icon === "home") {
    actionIcon = (
      <ThemedIconHost
        Icon={Home}
        size={16}
        strokeWidth={2.2}
        uniProps={foregroundMutedColorMapping}
      />
    );
  } else if (action.icon === "sessions") {
    actionIcon = (
      <ThemedIconHost
        Icon={MessagesSquare}
        size={16}
        strokeWidth={2.2}
        uniProps={foregroundMutedColorMapping}
      />
    );
  } else if (action.icon === "changes") {
    actionIcon = (
      <ThemedIconHost
        Icon={GitCompare}
        size={16}
        strokeWidth={2.2}
        uniProps={foregroundMutedColorMapping}
      />
    );
  } else if (action.icon === "environment") {
    actionIcon = (
      <ThemedIconHost
        Icon={PanelRight}
        size={16}
        strokeWidth={2.2}
        uniProps={foregroundMutedColorMapping}
      />
    );
  } else if (action.icon === "terminal") {
    actionIcon = (
      <ThemedIconHost
        Icon={TerminalSquare}
        size={16}
        strokeWidth={2.2}
        uniProps={foregroundMutedColorMapping}
      />
    );
  } else if (action.icon === "agent") {
    actionIcon = (
      <ThemedIconHost
        Icon={Bot}
        size={16}
        strokeWidth={2.2}
        uniProps={foregroundMutedColorMapping}
      />
    );
  }
  const titleStyle = useMemo(() => [styles.title, active && styles.titleActive], [active]);
  const subtitleStyle = useMemo(() => [styles.subtitle], []);
  const iconSlotStyle = useMemo(() => [styles.iconSlot, active && styles.iconSlotActive], [active]);
  const accessibilityLabel = action.subtitle ? `${action.title}, ${action.subtitle}` : action.title;
  return (
    <CommandCenterRowContainer
      rowIndex={rowIndex}
      active={active}
      accessibilityLabel={accessibilityLabel}
      rowRefs={rowRefs}
      onPress={handlePress}
    >
      <View style={styles.rowContent}>
        <View style={styles.rowMain}>
          {actionIcon ? <View style={iconSlotStyle}>{actionIcon}</View> : null}
          <View style={styles.textContent}>
            <Text style={titleStyle} numberOfLines={1}>
              {action.title}
            </Text>
            {action.subtitle ? (
              <Text style={subtitleStyle} numberOfLines={1}>
                {action.subtitle}
              </Text>
            ) : null}
          </View>
        </View>
        {action.shortcutKeys ? (
          <Shortcut chord={action.shortcutKeys} style={styles.rowShortcut} />
        ) : null}
      </View>
    </CommandCenterRowContainer>
  );
}

interface CommandCenterAgentRowProps {
  item: Extract<ReturnType<typeof useCommandCenter>["items"][number], { kind: "agent" }>;
  rowIndex: number;
  active: boolean;
  rowRefs: React.MutableRefObject<Map<number, View>>;
  onSelect: (item: ReturnType<typeof useCommandCenter>["items"][number]) => void;
  children: ReactNode;
}

function CommandCenterAgentRow({
  rowIndex,
  active,
  rowRefs,
  onSelect,
  item,
  children,
}: CommandCenterAgentRowProps) {
  const { t } = useTranslation();
  const handlePress = useCallback(() => onSelect(item), [onSelect, item]);
  const accessibilityLabel = useMemo(() => {
    const title = item.agent.title || t("workspace.newAgent");
    return `${title}, ${shortenPath(item.agent.cwd)}, ${formatTimeAgo(item.agent.lastActivityAt)}`;
  }, [item.agent.cwd, item.agent.lastActivityAt, item.agent.title, t]);
  return (
    <CommandCenterRowContainer
      rowIndex={rowIndex}
      active={active}
      accessibilityLabel={accessibilityLabel}
      rowRefs={rowRefs}
      onPress={handlePress}
    >
      {children}
    </CommandCenterRowContainer>
  );
}

interface CommandCenterAgentRowContentProps {
  agent: AggregatedAgent;
}

function CommandCenterAgentRowContent({ agent }: CommandCenterAgentRowContentProps) {
  const { t } = useTranslation();
  const titleStyle = useMemo(() => [styles.title], []);
  const subtitleStyle = useMemo(() => [styles.subtitle], []);
  return (
    <View style={styles.rowContent}>
      <View style={styles.rowMain}>
        <View style={styles.iconSlot}>
          <AgentStatusDot
            status={agent.status}
            requiresAttention={agent.requiresAttention}
            showInactive
          />
        </View>
        <View style={styles.textContent}>
          <Text style={titleStyle} numberOfLines={1}>
            {agent.title || t("workspace.newAgent")}
          </Text>
          <Text style={subtitleStyle} numberOfLines={1}>
            {shortenPath(agent.cwd)} · {formatTimeAgo(agent.lastActivityAt)}
          </Text>
        </View>
      </View>
    </View>
  );
}

interface AgentItemsSectionProps {
  agentItems: Extract<ReturnType<typeof useCommandCenter>["items"][number], { kind: "agent" }>[];
  actionItemsLength: number;
  activeIndex: number;
  rowRefs: React.MutableRefObject<Map<number, View>>;
  onSelect: (item: ReturnType<typeof useCommandCenter>["items"][number]) => void;
  sectionDividerStyle: React.ComponentProps<typeof View>["style"];
  sectionLabelStyle: React.ComponentProps<typeof Text>["style"];
}

function AgentItemsSection({
  agentItems,
  actionItemsLength,
  activeIndex,
  rowRefs,
  onSelect,
  sectionDividerStyle,
  sectionLabelStyle,
}: AgentItemsSectionProps) {
  const { t } = useTranslation();
  return (
    <>
      {actionItemsLength > 0 ? <View style={sectionDividerStyle} /> : null}
      <Text style={sectionLabelStyle}>{t("session.agents")}</Text>
      {agentItems.map((item, index) => {
        const rowIndex = actionItemsLength + index;
        const agent = item.agent;
        return (
          <CommandCenterAgentRow
            key={agentKey(agent)}
            item={item}
            rowIndex={rowIndex}
            active={rowIndex === activeIndex}
            rowRefs={rowRefs}
            onSelect={onSelect}
          >
            <CommandCenterAgentRowContent agent={agent} />
          </CommandCenterAgentRow>
        );
      })}
    </>
  );
}

export function CommandCenter() {
  const { t } = useTranslation();
  const { open, inputRef, query, setQuery, activeIndex, items, handleClose, handleSelectItem } =
    useCommandCenter();

  const rowRefs = useRef<Map<number, View>>(new Map());
  const resultsRef = useRef<ScrollView>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const row = rowRefs.current.get(activeIndex);
    if (!row || typeof document === "undefined") {
      return;
    }
    const scrollNode =
      (
        resultsRef.current as
          | (ScrollView & {
              getScrollableNode?: () => HTMLElement | null;
            })
          | null
      )?.getScrollableNode?.() ?? null;
    const rowEl = row as unknown as HTMLElement;

    if (!scrollNode) {
      rowEl.scrollIntoView?.({ block: "nearest" });
      return;
    }

    const rowTop = rowEl.offsetTop;
    const rowBottom = rowTop + rowEl.offsetHeight;
    const visibleTop = scrollNode.scrollTop;
    const visibleBottom = visibleTop + scrollNode.clientHeight;

    if (rowTop < visibleTop) {
      scrollNode.scrollTop = rowTop;
      return;
    }

    if (rowBottom > visibleBottom) {
      scrollNode.scrollTop = rowBottom - scrollNode.clientHeight;
    }
  }, [activeIndex, open]);

  const actionItems = useMemo(() => items.filter((item) => item.kind === "action"), [items]);
  const agentItems = useMemo(() => items.filter((item) => item.kind === "agent"), [items]);

  const sectionLabelStyle = useMemo(() => [styles.sectionLabel], []);
  const sectionDividerStyle = useMemo(() => [styles.sectionDivider], []);

  // On mobile native, the command center modal renders but has no trigger yet
  // (keyboard shortcuts are disabled on compact/mobile). A UI trigger button
  // in the workspace header is planned for a follow-up.
  if (!open) return null;

  return (
    <Modal visible={open} transparent animationType="none" onRequestClose={handleClose}>
      <View style={styles.overlay}>
        <Pressable style={styles.backdrop} onPress={handleClose} />

        <View testID="command-center-panel" style={styles.panel}>
          <View style={styles.header}>
            <ThemedTextInput
              testID="command-center-input"
              ref={inputRef}
              value={query}
              onChangeText={setQuery}
              placeholder={t("commandCenter.placeholder")}
              uniProps={placeholderTextColorMapping}
              accessibilityLabel={t("commandCenter.searchLabel")}
              style={styles.input}
              autoCapitalize="none"
              autoCorrect={false}
              autoFocus
            />
          </View>

          <ScrollView
            ref={resultsRef}
            style={styles.results}
            contentContainerStyle={styles.resultsContent}
            keyboardShouldPersistTaps="always"
            showsVerticalScrollIndicator={false}
          >
            {items.length === 0 ? (
              <Text style={styles.emptyText}>{t("commandCenter.noMatches")}</Text>
            ) : (
              <>
                {actionItems.length > 0 ? (
                  <>
                    <Text style={sectionLabelStyle}>{t("commandCenter.actions")}</Text>
                    {actionItems.map((item, index) => (
                      <CommandCenterActionRow
                        key={`action:${item.action.id}`}
                        item={item}
                        rowIndex={index}
                        active={index === activeIndex}
                        rowRefs={rowRefs}
                        onSelect={handleSelectItem}
                      />
                    ))}
                  </>
                ) : null}

                {agentItems.length > 0 ? (
                  <AgentItemsSection
                    agentItems={agentItems}
                    actionItemsLength={actionItems.length}
                    activeIndex={activeIndex}
                    rowRefs={rowRefs}
                    onSelect={handleSelectItem}
                    sectionDividerStyle={sectionDividerStyle}
                    sectionLabelStyle={sectionLabelStyle}
                  />
                ) : null}
              </>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create((theme) => ({
  overlay: {
    flex: 1,
    justifyContent: "flex-start",
    alignItems: "center",
    paddingTop: theme.spacing[12],
  },
  // Soft quiet dimmer — less heavy than pure black 50%.
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(20, 23, 31, 0.28)",
  },
  // Soft floating command palette: r18 composer-family card.
  panel: {
    width: 640,
    maxWidth: "92%",
    maxHeight: "80%",
    borderRadius: 18,
    borderWidth: 1,
    borderColor: theme.colors.border,
    overflow: "hidden",
    backgroundColor: theme.colors.surface0,
    ...theme.shadow.md,
  },
  header: {
    // Soft floating panel header: quiet border-soft rule.
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
    borderBottomWidth: theme.borderWidth[1],
    borderBottomColor: theme.colors.secondary,
    backgroundColor: theme.colors.surface0,
  },
  input: {
    // Soft palette query: near .a 14.5 readability.
    fontSize: 14.5,
    lineHeight: 22,
    paddingVertical: theme.spacing[1],
    color: theme.colors.foreground,
    outlineStyle: "none",
  } as object,
  results: {
    flexGrow: 0,
  },
  resultsContent: {
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[2],
  },
  // Soft menu section label: 12.5 medium muted.
  sectionLabel: {
    paddingHorizontal: theme.spacing[3],
    paddingTop: 0,
    paddingBottom: theme.spacing[2],
    fontSize: 12.5,
    lineHeight: 16,
    color: theme.colors.foregroundMuted,
  },
  sectionDivider: {
    height: 1,
    marginTop: theme.spacing[2],
    marginBottom: theme.spacing[2],
    backgroundColor: theme.colors.border,
  },
  // Soft menu-hint row: quiet r10.
  row: {
    marginHorizontal: theme.spacing[1],
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderWidth: theme.borderWidth[1],
    borderColor: "transparent",
    borderRadius: 10,
  },
  rowActive: {
    // Soft selected command row: elevated surface0, not surface1 hover wash.
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface0,
    ...theme.shadow.sm,
  },
  rowContent: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[3],
  },
  rowMain: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing[3],
  },
  iconSlot: {
    width: 28,
    height: 28,
    borderRadius: 10,
    backgroundColor: theme.colors.surfaceWorkspace,
    alignItems: "center",
    justifyContent: "center",
  },
  iconSlotActive: {
    backgroundColor: theme.colors.surface0,
  },
  textContent: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  rowShortcut: {
    marginLeft: theme.spacing[2],
    flexShrink: 0,
  },
  // Soft menu-hint row title: 12.5 medium.
  title: {
    fontSize: 12.5,
    fontWeight: "500",
    lineHeight: 16,
    color: theme.colors.foreground,
  },
  // Active (selected) command row title. Kept distinct from `title` so the
  // non-active rows keep the base foreground color and only the active row
  // can opt into a stronger treatment if one is added later.
  titleActive: {
    color: theme.colors.foreground,
  },
  subtitle: {
    fontSize: 12.5,
    lineHeight: 16,
    color: theme.colors.foregroundMuted,
  },
  // Soft menu empty: 12.5 muted.
  emptyText: {
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[4],
    fontSize: 12.5,
    lineHeight: 16,
    color: theme.colors.foregroundMuted,
  },
}));
