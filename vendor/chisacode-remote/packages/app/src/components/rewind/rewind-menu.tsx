import { memo, useCallback, useMemo, useState, type ReactElement } from "react";
import { Text, View } from "react-native";
import { FileText, Layers, MessageSquare, Undo2 } from "lucide-react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ThemedIconHost } from "@/components/themed-icon-host";
import type { Theme } from "@/styles/theme";
import { type RewindMode, useRewindCapabilities } from "./use-rewind-capabilities";
import type { AgentCapabilityFlags } from "@chisacode/protocol/agent-types";

export type { RewindMode };

interface RewindMenuProps {
  capabilities: AgentCapabilityFlags;
  rewoundText: string;
  onRewind: (input: { mode: RewindMode; rewoundText: string }) => Promise<void> | void;
  isPending?: boolean;
  testID?: string;
}

const foregroundColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const foregroundMutedColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});

function getIcon(mode: RewindMode): ReactElement {
  switch (mode) {
    case "conversation":
      return <ThemedIconHost Icon={MessageSquare} size={16} uniProps={foregroundColorMapping} />;
    case "files":
      return <ThemedIconHost Icon={FileText} size={16} uniProps={foregroundColorMapping} />;
    case "both":
      return <ThemedIconHost Icon={Layers} size={16} uniProps={foregroundColorMapping} />;
  }
}

export const RewindMenu = memo(function RewindMenu({
  capabilities,
  rewoundText,
  onRewind,
  isPending: isPendingProp = false,
  testID = "rewind-menu",
}: RewindMenuProps) {
  const { t } = useTranslation();
  const items = useRewindCapabilities(capabilities);
  const [isOpen, setIsOpen] = useState(false);
  const [pendingMode, setPendingMode] = useState<RewindMode | null>(null);
  const isLocked = isPendingProp || pendingMode !== null;

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next && pendingMode !== null) return;
      setIsOpen(next);
    },
    [pendingMode],
  );

  const handleSelect = useCallback(
    (mode: RewindMode) => async () => {
      if (isLocked) return;
      setPendingMode(mode);
      try {
        await onRewind({ mode, rewoundText });
      } catch {
        // useRewindAgentMutation owns the toast; the menu only owns flow state.
      } finally {
        setPendingMode(null);
        setIsOpen(false);
      }
    },
    [isLocked, onRewind, rewoundText],
  );

  const triggerStyle = useCallback(
    () => [styles.trigger, isLocked ? styles.triggerDisabled : null],
    [isLocked],
  );

  const tooltipContent = useMemo(
    () => (
      <TooltipContent side="top" align="center" offset={8}>
        <Text style={styles.tooltipText}>{t("review.rewindToMessage")}</Text>
      </TooltipContent>
    ),
    [t],
  );

  const modeIcons = useMemo(() => {
    const map = new Map<RewindMode, ReactElement>();
    for (const item of items) {
      map.set(item.mode, getIcon(item.mode));
    }
    return map;
  }, [items]);

  if (items.length === 0) {
    return null;
  }

  return (
    <DropdownMenu open={isOpen} onOpenChange={handleOpenChange}>
      <Tooltip delayDuration={250} enabledOnDesktop enabledOnMobile={false}>
        <TooltipTrigger asChild>
          <View style={styles.triggerSlot} collapsable={false}>
            <DropdownMenuTrigger
              accessibilityLabel={t("review.rewindToMessage")}
              accessibilityRole="button"
              disabled={isLocked}
              style={triggerStyle}
              testID={`${testID}-trigger`}
            >
              {({ hovered, open }) => (
                <ThemedIconHost
                  Icon={Undo2}
                  size={16}
                  uniProps={hovered || open ? foregroundColorMapping : foregroundMutedColorMapping}
                />
              )}
            </DropdownMenuTrigger>
          </View>
        </TooltipTrigger>
        {tooltipContent}
      </Tooltip>
      <DropdownMenuContent align="end" minWidth={220} side="bottom" testID={`${testID}-content`}>
        <View style={styles.warningHeader}>
          <Text style={styles.warningText}>{t("review.rewindWarning")}</Text>
        </View>
        <DropdownMenuSeparator />
        {items.map((item) => (
          <DropdownMenuItem
            key={item.mode}
            closeOnSelect={false}
            disabled={isLocked && pendingMode !== item.mode}
            leading={modeIcons.get(item.mode)}
            onSelect={handleSelect(item.mode)}
            status={pendingMode === item.mode ? "pending" : undefined}
            testID={item.testID}
          >
            {item.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
});

const styles = StyleSheet.create((theme) => ({
  trigger: {
    padding: theme.spacing[1],
    paddingTop: theme.spacing[1],
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
  },
  triggerDisabled: {
    opacity: theme.opacity[50],
  },
  triggerSlot: {
    alignSelf: "center",
  },
  tooltipText: {
    color: theme.colors.foreground,
    fontSize: 12.5,
    lineHeight: 16,
  },
  warningHeader: {
    paddingHorizontal: theme.spacing[3],
    paddingTop: theme.spacing[2],
    paddingBottom: theme.spacing[2],
  },
  warningText: {
    color: theme.colors.foregroundMuted,
    fontSize: 12.5,
    lineHeight: 16,
  },
}));
