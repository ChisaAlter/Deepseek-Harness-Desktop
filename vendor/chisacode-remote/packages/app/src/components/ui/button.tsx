import {
  default as React,
  useCallback,
  useMemo,
  useState,
  type ComponentType,
  type PropsWithChildren,
  type ReactElement,
  type ReactNode,
} from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import type {
  PressableProps,
  PressableStateCallbackType,
  StyleProp,
  TextStyle,
  ViewStyle,
} from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { Theme } from "@/styles/theme";

type ButtonVariant = "default" | "secondary" | "outline" | "ghost" | "destructive";
type ButtonSize = "xs" | "sm" | "md" | "lg";

type LeftIcon =
  | ReactElement
  | ComponentType<{ color: string; size: number }>
  | ((color: string) => ReactElement)
  | null;

const BUTTON_ICON_SIZE: Record<ButtonSize, number> = { xs: 12, sm: 14, md: 16, lg: 20 };

const ThemedActivityIndicator = withUnistyles(ActivityIndicator);

type ColorMapping = (theme: Theme) => { color: string };

const accentForegroundColorMapping: ColorMapping = (theme) => ({
  color: theme.colors.accentForeground,
});
const foregroundColorMapping: ColorMapping = (theme) => ({
  color: theme.colors.foreground,
});
const foregroundMutedColorMapping: ColorMapping = (theme) => ({
  color: theme.colors.foregroundMuted,
});

/** Injects a theme-reactive `color` prop into render-function left icons. */
function IconColorHost({
  color,
  size: _size,
  render,
}: {
  color: string;
  size?: number;
  render: (color: string) => ReactElement;
}) {
  return render(color);
}

const ThemedIconColorHost = withUnistyles(IconColorHost);

/** Injects theme-reactive `color` into component-type left icons. */
function IconComponentHost({
  color,
  size,
  Icon,
}: {
  color: string;
  size: number;
  Icon: ComponentType<{ color: string; size: number }>;
}) {
  return <Icon color={color} size={size} />;
}

const ThemedIconComponentHost = withUnistyles(IconComponentHost);

function normalizeGeneratedAccessibilityLabel(value: string | number): string | undefined {
  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeButtonVariant(variant: ButtonVariant): ButtonVariant {
  if (
    variant === "default" ||
    variant === "secondary" ||
    variant === "outline" ||
    variant === "ghost" ||
    variant === "destructive"
  ) {
    return variant;
  }
  return "secondary";
}

function normalizeButtonSize(size: ButtonSize): ButtonSize {
  if (size === "xs" || size === "sm" || size === "md" || size === "lg") {
    return size;
  }
  return "md";
}

function resolveIconColorMapping(
  normalizedVariant: ButtonVariant,
  isGhostHovered: boolean,
): ColorMapping {
  if (normalizedVariant === "default") {
    return accentForegroundColorMapping;
  }
  if (normalizedVariant === "ghost") {
    if (isGhostHovered) {
      return foregroundColorMapping;
    }
    return foregroundMutedColorMapping;
  }
  return foregroundColorMapping;
}

const styles = StyleSheet.create((theme) => ({
  // Soft Workbench buttons: quiet pills, shadow only when elevated.
  base: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[2],
    minHeight: 36,
    borderRadius: theme.borderRadius.full,
    borderWidth: 1,
    borderColor: "transparent",
  },
  md: {
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
  },
  xs: {
    minHeight: 28,
    paddingVertical: theme.spacing[1],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.full,
  },
  sm: {
    minHeight: 32,
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.full,
  },
  lg: {
    paddingVertical: theme.spacing[4],
    paddingHorizontal: theme.spacing[6],
    borderRadius: theme.borderRadius.full,
  },
  default: {
    backgroundColor: theme.colors.accent,
    borderColor: theme.colors.accent,
  },
  secondary: {
    backgroundColor: theme.colors.surface0,
    borderColor: theme.colors.border,
  },
  outline: {
    backgroundColor: "transparent",
    borderColor: theme.colors.border,
  },
  ghost: {
    backgroundColor: "transparent",
    borderColor: "transparent",
  },
  ghostHovered: {
    backgroundColor: theme.colors.surfaceWorkspace,
    borderColor: "transparent",
  },
  destructive: {
    backgroundColor: theme.colors.destructive,
    borderColor: theme.colors.destructive,
  },
  pressed: {
    opacity: 0.85,
  },
  disabled: {
    opacity: theme.opacity[50],
  },
  text: {
    minWidth: 0,
    flexShrink: 1,
    color: theme.colors.foreground,
    // Soft button sm label: 12.5 meta.
    fontSize: 12.5,
    lineHeight: 18,
    fontWeight: theme.fontWeight.normal,
  },
  textXs: {
    fontSize: 12.5,
    lineHeight: 16,
  },
  textDefault: {
    color: theme.colors.palette.white,
  },
  textDestructive: {
    color: theme.colors.palette.white,
  },
  textGhost: {
    color: theme.colors.foregroundMuted,
  },
  textGhostHovered: {
    color: theme.colors.foreground,
  },
}));

export function Button({
  children,
  variant = "secondary",
  size = "md",
  leftIcon,
  trailing,
  style,
  textStyle,
  disabled,
  loading = false,
  accessibilityLabel,
  accessibilityRole,
  ...props
}: PropsWithChildren<
  Omit<PressableProps, "style"> & {
    variant?: ButtonVariant;
    size?: ButtonSize;
    leftIcon?: LeftIcon;
    trailing?: ReactNode;
    style?: StyleProp<ViewStyle>;
    textStyle?: StyleProp<TextStyle>;
    loading?: boolean;
  }
>) {
  const [hovered, setHovered] = useState(false);
  const isDisabled = disabled || loading;
  const normalizedVariant = normalizeButtonVariant(variant);
  const normalizedSize = normalizeButtonSize(size);

  let variantStyle: ViewStyle;
  if (normalizedVariant === "default") {
    variantStyle = styles.default;
  } else if (normalizedVariant === "secondary") {
    variantStyle = styles.secondary;
  } else if (normalizedVariant === "outline") {
    variantStyle = styles.outline;
  } else if (normalizedVariant === "ghost") {
    variantStyle = styles.ghost;
  } else {
    variantStyle = styles.destructive;
  }

  let sizeStyle: ViewStyle;
  if (normalizedSize === "xs") {
    sizeStyle = styles.xs;
  } else if (normalizedSize === "sm") {
    sizeStyle = styles.sm;
  } else if (normalizedSize === "lg") {
    sizeStyle = styles.lg;
  } else {
    sizeStyle = styles.md;
  }
  const isGhostHovered = hovered && normalizedVariant === "ghost";
  const iconColorMapping = resolveIconColorMapping(normalizedVariant, isGhostHovered);

  const handleHoverIn = useCallback(() => setHovered(true), []);
  const handleHoverOut = useCallback(() => setHovered(false), []);

  const pressableStyle = useCallback(
    ({ pressed }: PressableStateCallbackType): StyleProp<ViewStyle> => [
      styles.base,
      sizeStyle,
      variantStyle,
      hovered && normalizedVariant === "ghost" ? styles.ghostHovered : null,
      pressed ? styles.pressed : null,
      isDisabled ? styles.disabled : null,
      style,
    ],
    [sizeStyle, variantStyle, hovered, normalizedVariant, isDisabled, style],
  );

  const resolvedTextStyle = useMemo(
    () => [
      styles.text,
      normalizedSize === "xs" ? styles.textXs : null,
      normalizedVariant === "default" ? styles.textDefault : null,
      normalizedVariant === "destructive" ? styles.textDestructive : null,
      normalizedVariant === "ghost" ? styles.textGhost : null,
      textStyle,
      isGhostHovered ? styles.textGhostHovered : null,
    ],
    [normalizedSize, normalizedVariant, textStyle, isGhostHovered],
  );

  const accessibilityState = useMemo(
    () => ({ disabled: isDisabled, busy: loading }),
    [isDisabled, loading],
  );
  const explicitAccessibilityLabel =
    typeof accessibilityLabel === "string"
      ? normalizeGeneratedAccessibilityLabel(accessibilityLabel)
      : undefined;
  const generatedAccessibilityLabel =
    typeof children === "string" || typeof children === "number"
      ? normalizeGeneratedAccessibilityLabel(children)
      : undefined;
  const resolvedAccessibilityLabel = explicitAccessibilityLabel ?? generatedAccessibilityLabel;

  function renderIcon() {
    if (loading) {
      return (
        <View>
          <ThemedActivityIndicator size="small" uniProps={iconColorMapping} />
        </View>
      );
    }

    if (!leftIcon) return null;

    // Pre-rendered element — pass through
    if (typeof leftIcon === "object" && "type" in leftIcon) {
      return <View>{leftIcon}</View>;
    }

    const iconSize = BUTTON_ICON_SIZE[normalizedSize];

    // Render function
    if (
      typeof leftIcon === "function" &&
      !leftIcon.prototype?.isReactComponent &&
      leftIcon.length > 0
    ) {
      return (
        <View>
          <ThemedIconColorHost
            uniProps={iconColorMapping}
            render={leftIcon as (color: string) => ReactElement}
          />
        </View>
      );
    }

    // Component type
    const Icon = leftIcon as ComponentType<{ color: string; size: number }>;
    return (
      <View>
        <ThemedIconComponentHost Icon={Icon} size={iconSize} uniProps={iconColorMapping} />
      </View>
    );
  }

  return (
    <Pressable
      {...props}
      accessibilityLabel={resolvedAccessibilityLabel}
      accessibilityRole={accessibilityRole ?? "button"}
      accessibilityState={accessibilityState}
      disabled={isDisabled}
      onHoverIn={handleHoverIn}
      onHoverOut={handleHoverOut}
      style={pressableStyle}
    >
      {renderIcon()}
      {children != null ? (
        <Text style={resolvedTextStyle} numberOfLines={1} ellipsizeMode="tail">
          {children}
        </Text>
      ) : null}
      {trailing}
    </Pressable>
  );
}
