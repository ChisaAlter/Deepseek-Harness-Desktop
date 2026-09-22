import { useCallback, useMemo } from "react";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { useTranslation } from "react-i18next";
import { ChevronDown, ListTodo, Settings2, ShieldCheck, Zap } from "lucide-react-native";
import { withUnistyles } from "react-native-unistyles";
import type { AgentFeature } from "@chisacode/protocol/agent-types";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { styles } from "@/composer/agent-controls/agent-control-styles";
import {
  resolveFeatureControlSelector,
  resolveFeatureDisplayLabel,
  type FeatureControlSelector,
} from "@/composer/agent-controls/feature-control-model";
import { getFeatureHighlightColor, getFeatureTooltip } from "@/composer/agent-controls/utils";
import { ICON_SIZE, type Theme } from "@/styles/theme";

interface FeatureItemProps {
  feature: AgentFeature;
  disabled: boolean;
  openSelector: string | null;
  handleOpenChange: (selector: FeatureControlSelector) => (nextOpen: boolean) => void;
  onSetFeature?: (featureId: string, value: unknown) => void;
}

// Lucide icons only accept `color`. On web, withUnistyles merges call-site
// `uniProps` onto the child and lucide forwards unknown props to the DOM SVG.
// Inject color via a host that only passes `color`/`size` to lucide.
type LucideIconComponent = typeof Zap;

function LucideIconHost({
  color,
  size,
  Icon,
}: {
  color: string;
  size: number;
  Icon: LucideIconComponent;
}) {
  return <Icon color={color} size={size} />;
}

const ThemedLucideIconHost = withUnistyles(LucideIconHost);

const FEATURE_ICONS: Record<string, LucideIconComponent> = {
  "list-todo": ListTodo,
  "shield-check": ShieldCheck,
  zap: Zap,
};

function getFeatureIcon(icon?: string): LucideIconComponent {
  return (icon && FEATURE_ICONS[icon]) || Settings2;
}

type IconColorMapping = (theme: Theme) => { color: string };

const foregroundMutedColorMapping: IconColorMapping = (theme) => ({
  color: theme.colors.foregroundMuted,
});
const featureHighlightBlueColorMapping: IconColorMapping = (theme) => ({
  color: theme.colors.palette.blue[400],
});
const featureHighlightGreenColorMapping: IconColorMapping = (theme) => ({
  color: theme.colors.palette.green[400],
});
const featureHighlightYellowColorMapping: IconColorMapping = (theme) => ({
  color: theme.colors.palette.yellow[400],
});

// Enabled feature icons use the feature highlight color; disabled/default icons
// fall back to foregroundMuted. Selects between mapping functions (no nested
// ternaries — oxlint rejects them). See docs/unistyles.md.
function getFeatureIconColorMapping(featureId: string, enabled: boolean): IconColorMapping {
  if (!enabled) {
    return foregroundMutedColorMapping;
  }

  switch (getFeatureHighlightColor(featureId)) {
    case "blue":
      return featureHighlightBlueColorMapping;
    case "green":
      return featureHighlightGreenColorMapping;
    case "yellow":
      return featureHighlightYellowColorMapping;
    default:
      return foregroundMutedColorMapping;
  }
}

function useFeatureItemActions({
  feature,
  handleOpenChange,
  onSetFeature,
}: Pick<FeatureItemProps, "feature" | "handleOpenChange" | "onSetFeature">) {
  const featureSelector = resolveFeatureControlSelector(feature.id);
  const handleFeatureOpenChange = useMemo(
    () => handleOpenChange(featureSelector),
    [handleOpenChange, featureSelector],
  );
  const handleTogglePress = useCallback(() => {
    if (feature.type === "toggle") {
      onSetFeature?.(feature.id, !feature.value);
    }
  }, [feature, onSetFeature]);
  const handleSelectOption = useCallback(
    (optionId: string) => {
      onSetFeature?.(feature.id, optionId);
    },
    [feature.id, onSetFeature],
  );
  return {
    featureSelector,
    handleFeatureOpenChange,
    handleSelectOption,
    handleTogglePress,
  };
}

export function DesktopFeatureItem({
  feature,
  disabled,
  openSelector,
  handleOpenChange,
  onSetFeature,
}: FeatureItemProps) {
  const { featureSelector, handleFeatureOpenChange, handleSelectOption, handleTogglePress } =
    useFeatureItemActions({ feature, handleOpenChange, onSetFeature });
  const tooltip = getFeatureTooltip(feature);

  const togglePressableStyle = useCallback(
    ({ pressed, hovered }: PressableStateCallbackType) => [
      styles.modeIconBadge,
      hovered && styles.modeBadgeHovered,
      pressed && styles.modeBadgePressed,
      disabled && styles.disabledBadge,
    ],
    [disabled],
  );

  const selectPressableStyle = useCallback(
    ({ pressed, hovered }: PressableStateCallbackType) => [
      styles.modeBadge,
      hovered && styles.modeBadgeHovered,
      (pressed || openSelector === featureSelector) && styles.modeBadgePressed,
      disabled && styles.disabledBadge,
    ],
    [disabled, featureSelector, openSelector],
  );

  if (feature.type === "toggle") {
    const FeatureIcon = getFeatureIcon(feature.icon);
    return (
      <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile={false}>
        <TooltipTrigger asChild triggerRefProp="ref">
          <Pressable
            disabled={disabled}
            onPress={handleTogglePress}
            style={togglePressableStyle}
            accessibilityRole="button"
            accessibilityLabel={tooltip}
            testID={`agent-feature-${feature.id}`}
          >
            <ThemedLucideIconHost
              Icon={FeatureIcon}
              size={ICON_SIZE.md}
              uniProps={getFeatureIconColorMapping(feature.id, feature.value)}
            />
          </Pressable>
        </TooltipTrigger>
        <TooltipContent side="top" align="center" offset={8}>
          <Text style={styles.tooltipText}>{tooltip}</Text>
        </TooltipContent>
      </Tooltip>
    );
  }

  if (feature.type === "select") {
    const FeatureIcon = getFeatureIcon(feature.icon);
    return (
      <DropdownMenu open={openSelector === featureSelector} onOpenChange={handleFeatureOpenChange}>
        <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile={false}>
          <TooltipTrigger asChild triggerRefProp="ref">
            <DropdownMenuTrigger
              disabled={disabled}
              style={selectPressableStyle}
              accessibilityRole="button"
              accessibilityLabel={tooltip}
              testID={`agent-feature-${feature.id}`}
            >
              <ThemedLucideIconHost
                Icon={FeatureIcon}
                size={ICON_SIZE.md}
                uniProps={foregroundMutedColorMapping}
              />
              <Text style={styles.modeBadgeText}>{resolveFeatureDisplayLabel(feature)}</Text>
              <ThemedLucideIconHost
                Icon={ChevronDown}
                size={ICON_SIZE.sm}
                uniProps={foregroundMutedColorMapping}
              />
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="top" align="center" offset={8}>
            <Text style={styles.tooltipText}>{tooltip}</Text>
          </TooltipContent>
        </Tooltip>
        <DropdownMenuContent side="top" align="start">
          {feature.options.map((option) => (
            <FeatureOptionMenuItem
              key={option.id}
              option={option}
              selected={option.id === feature.value}
              onSelect={handleSelectOption}
            />
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  return null;
}

export function SheetFeatureItem({
  feature,
  disabled,
  openSelector,
  handleOpenChange,
  onSetFeature,
}: FeatureItemProps) {
  const { t } = useTranslation();
  const { featureSelector, handleFeatureOpenChange, handleSelectOption, handleTogglePress } =
    useFeatureItemActions({ feature, handleOpenChange, onSetFeature });
  const tooltip = getFeatureTooltip(feature);

  const togglePressableStyle = useCallback(
    ({ pressed }: PressableStateCallbackType) => [
      styles.sheetSelect,
      pressed && styles.sheetSelectPressed,
      disabled && styles.disabledSheetSelect,
    ],
    [disabled],
  );

  if (feature.type === "toggle") {
    const FeatureIcon = getFeatureIcon(feature.icon);
    return (
      <View style={styles.sheetSection}>
        <Pressable
          disabled={disabled}
          onPress={handleTogglePress}
          style={togglePressableStyle}
          accessibilityRole="button"
          accessibilityLabel={tooltip}
          testID={`agent-feature-${feature.id}`}
        >
          <ThemedLucideIconHost
            Icon={FeatureIcon}
            size={ICON_SIZE.md}
            uniProps={getFeatureIconColorMapping(feature.id, feature.value)}
          />
          <Text style={styles.sheetSelectText}>{feature.label}</Text>
          <Text style={styles.modeBadgeText}>
            {feature.value ? t("composer.controls.on") : t("composer.controls.off")}
          </Text>
        </Pressable>
      </View>
    );
  }

  if (feature.type === "select") {
    return (
      <View style={styles.sheetSection}>
        <DropdownMenu
          open={openSelector === featureSelector}
          onOpenChange={handleFeatureOpenChange}
        >
          <DropdownMenuTrigger
            disabled={disabled}
            style={togglePressableStyle}
            accessibilityRole="button"
            accessibilityLabel={tooltip}
            testID={`agent-feature-${feature.id}`}
          >
            <Text style={styles.sheetSelectText}>{resolveFeatureDisplayLabel(feature)}</Text>
            <ThemedLucideIconHost
              Icon={ChevronDown}
              size={ICON_SIZE.md}
              uniProps={foregroundMutedColorMapping}
            />
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start">
            {feature.options.map((option) => (
              <FeatureOptionMenuItem
                key={option.id}
                option={option}
                selected={option.id === feature.value}
                onSelect={handleSelectOption}
              />
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </View>
    );
  }

  return null;
}

function FeatureOptionMenuItem({
  option,
  selected,
  onSelect,
}: {
  option: { id: string; label: string };
  selected: boolean;
  onSelect: (optionId: string) => void;
}) {
  const handleSelect = useCallback(() => {
    onSelect(option.id);
  }, [onSelect, option.id]);

  return (
    <DropdownMenuItem selected={selected} onSelect={handleSelect}>
      {option.label}
    </DropdownMenuItem>
  );
}
