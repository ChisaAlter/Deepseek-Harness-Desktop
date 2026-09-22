import { useMemo, type ReactNode } from "react";
import { Pressable, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { Info } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { ICON_SIZE, type Theme } from "@/styles/theme";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const ThemedInfo = withUnistyles(Info);
const foregroundMutedColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});

interface SettingsGroupProps {
  title: string;
  info?: ReactNode;
  trailing?: ReactNode;
  testID?: string;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}

/**
 * Top-level grouping above one or more SettingsSection blocks. Use when a
 * settings screen has more than one logical area — the group title carries the
 * category, the optional info tooltip explains it, and the inner sections keep
 * their muted iOS-style labels.
 */
export function SettingsGroup({
  title,
  info,
  trailing,
  testID,
  style,
  children,
}: SettingsGroupProps) {
  const groupStyle = useMemo(() => [styles.group, style], [style]);
  return (
    <View style={groupStyle} testID={testID}>
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <Text style={styles.title}>{title}</Text>
          {info ? (
            <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile>
              <TooltipTrigger asChild>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`About ${title}`}
                  testID={testID ? `${testID}-info` : undefined}
                  hitSlop={8}
                  style={styles.infoButton}
                >
                  <ThemedInfo size={ICON_SIZE.sm} uniProps={foregroundMutedColorMapping} />
                </Pressable>
              </TooltipTrigger>
              <TooltipContent side="top" align="start" offset={8}>
                <Text style={styles.tooltipText}>{info}</Text>
              </TooltipContent>
            </Tooltip>
          ) : null}
        </View>
        {trailing}
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  group: {
    marginBottom: theme.spacing[8],
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
    marginBottom: theme.spacing[4],
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  title: {
    color: theme.colors.foreground,
    // Soft settings group title: 14.5 medium-weight body.
    fontSize: 14.5,
    lineHeight: 20,
    fontWeight: theme.fontWeight.normal,
  },
  infoButton: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
    marginLeft: -theme.spacing[1],
  },
  tooltipText: {
    color: theme.colors.foreground,
    fontSize: 12.5,
    maxWidth: 280,
    lineHeight: 18,
  },
}));
