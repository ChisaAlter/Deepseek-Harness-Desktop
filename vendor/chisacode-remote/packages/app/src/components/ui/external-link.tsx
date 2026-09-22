import { useCallback, type ReactNode } from "react";
import { Pressable, Text } from "react-native";
import { ArrowUpRight } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { openExternalUrl } from "@/utils/open-external-url";
import type { Theme } from "@/styles/theme";

const ThemedArrowUpRight = withUnistyles(ArrowUpRight);

const foregroundMutedColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});

interface ExternalLinkProps {
  href: string;
  label: string;
  tooltip?: ReactNode;
  testID?: string;
  accessibilityLabel?: string;
}

/**
 * Inline "Docs ↗" affordance — muted text + arrow-top-right icon, opens the
 * URL via the platform's external opener. Wrap in a Tooltip when there's a
 * one-line hint worth surfacing on hover/tap.
 */
export function ExternalLink({
  href,
  label,
  tooltip,
  testID,
  accessibilityLabel,
}: ExternalLinkProps) {
  const handlePress = useCallback(() => {
    void openExternalUrl(href);
  }, [href]);

  const trigger = (
    <Pressable
      onPress={handlePress}
      hitSlop={8}
      accessibilityRole="link"
      accessibilityLabel={accessibilityLabel ?? label}
      testID={testID}
      style={styles.trigger}
    >
      <Text style={styles.label}>{label}</Text>
      <ThemedArrowUpRight size={12} uniProps={foregroundMutedColorMapping} />
    </Pressable>
  );

  if (!tooltip) {
    return trigger;
  }

  return (
    <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile>
      <TooltipTrigger asChild>{trigger}</TooltipTrigger>
      <TooltipContent side="top" align="end" offset={6}>
        <Text style={styles.tooltipText}>{tooltip}</Text>
      </TooltipContent>
    </Tooltip>
  );
}

const styles = StyleSheet.create((theme) => ({
  trigger: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    minHeight: 28,
  },
  label: {
    color: theme.colors.foregroundMuted,
    fontSize: 12.5,
    lineHeight: 16,
  },
  tooltipText: {
    color: theme.colors.foreground,
    // Soft external link: 12.5 meta.
    fontSize: 12.5,
    maxWidth: 280,
    lineHeight: 18,
  },
}));
