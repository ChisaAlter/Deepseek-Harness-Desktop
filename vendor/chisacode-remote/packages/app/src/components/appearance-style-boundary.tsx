import { Fragment, type ReactNode } from "react";
import { withUnistyles } from "react-native-unistyles";
import type { Theme } from "@/styles/theme";

interface AppearanceStyleBoundaryProps {
  appearanceKey?: string;
  children: ReactNode;
}

/**
 * Remounts children when typography/color tokens that affect markdown change.
 * Adapted from Paseo for ChisaCode Theme tokens.
 */
function AppearanceStyleBoundaryBase({ appearanceKey, children }: AppearanceStyleBoundaryProps) {
  return <Fragment key={appearanceKey}>{children}</Fragment>;
}

const appearanceStyleBoundaryMapping = (theme: Theme): Partial<AppearanceStyleBoundaryProps> => ({
  appearanceKey: [
    theme.fontSize.xs,
    theme.fontSize.sm,
    theme.fontSize.base,
    theme.fontSize.lg,
    theme.fontSize.xl,
    theme.fontSize["2xl"],
    theme.fontSize["3xl"],
    theme.fontSize["4xl"],
    theme.fontSize.code,
    theme.lineHeight.body,
    theme.lineHeight.diff,
    theme.colors.foreground,
    theme.colors.foregroundMuted,
    theme.colors.mutedForeground,
    theme.colors.surface1,
    theme.colors.surface2,
    theme.colors.border,
    theme.colors.accentBright,
  ].join("\u0000"),
});

const ThemedAppearanceStyleBoundary = withUnistyles(AppearanceStyleBoundaryBase);

export function AppearanceStyleBoundary({ children }: { children: ReactNode }) {
  return (
    <ThemedAppearanceStyleBoundary uniProps={appearanceStyleBoundaryMapping}>
      {children}
    </ThemedAppearanceStyleBoundary>
  );
}
