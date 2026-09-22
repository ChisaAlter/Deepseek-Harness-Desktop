import { useCallback, useMemo, useRef, type ReactNode, type RefObject } from "react";
import {
  Pressable,
  Text,
  View,
  type PressableStateCallbackType,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { Brain, ChevronDown, Settings2 } from "lucide-react-native";
import { withUnistyles } from "react-native-unistyles";
import type { AgentFeature, AgentProvider } from "@chisacode/protocol/agent-types";

import { AdaptiveModalSheet } from "@/components/adaptive-modal-sheet";
import { CombinedModelSelector } from "@/components/combined-model-selector";
import { getProviderIcon } from "@/components/provider-icons";
import { Combobox, ComboboxItem, type ComboboxOption } from "@/components/ui/combobox";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { styles } from "@/composer/agent-controls/agent-control-styles";
import type {
  ActiveAgentControlSheet,
  AgentControlOption,
  AgentControlSelector,
} from "@/composer/agent-controls/agent-control-types";
import { SheetFeatureItem } from "@/composer/agent-controls/feature-controls";
import { formatCompactModelLabel, getAgentControlHint } from "@/composer/agent-controls/utils";
import type {
  ProviderModelSelectionValue,
  ProviderSelectorProvider,
} from "@/provider-selection/provider-selection";
import { ICON_SIZE, type Theme } from "@/styles/theme";

interface DesktopAgentControlsContentProps {
  provider: string;
  providerOptions?: AgentControlOption[];
  selectedProviderId?: string;
  selectedModelId?: string;
  selectedRuntimeProviderId?: string | null;
  thinkingOptions?: AgentControlOption[];
  selectedThinkingOptionId?: string;
  onToggleFavoriteModel?: (provider: string, modelId: string) => void;
  onDropdownClose?: () => void;
  onModelSelectorOpen?: () => void;
  onRetryModelProvider?: (provider: AgentProvider) => void;
  isRetryingModelProvider: boolean;
  favoriteKeys: Set<string>;
  disabled: boolean;
  isModelLoading: boolean;
  canSelectProvider: boolean;
  canSelectModel: boolean;
  canSelectThinking: boolean;
  modelSelectorProviders: ProviderSelectorProvider[];
  modelDisabled: boolean;
  comboboxProviderOptions: ComboboxOption[];
  comboboxThinkingOptions: ComboboxOption[];
  displayProvider: string;
  displayThinking: string;
  selectProviderLabel: string;
  selectThinkingLabel: string;
  openSelector: AgentControlSelector | null;
  providerAnchorRef: RefObject<View | null>;
  thinkingAnchorRef: RefObject<View | null>;
  handleProviderPress: () => void;
  handleThinkingPress: () => void;
  handleProviderSelect: (id: string) => void;
  handleThinkingSelect: (id: string) => void;
  handleDesktopModelSelect: (selection: ProviderModelSelectionValue) => void;
  handleProviderOpenChange: (open: boolean) => void;
  handleThinkingOpenChange: (open: boolean) => void;
  extras?: ReactNode;
  modelSelectorServerId: string | null;
  /** When false, omit provider/model/thinking — Soft left cbar (mode only). */
  showModelCluster?: boolean;
}

interface SheetAgentControlsContentProps {
  provider: string;
  selectedModelId?: string;
  selectedRuntimeProviderId?: string | null;
  selectedThinkingOptionId?: string;
  features?: AgentFeature[];
  onSetFeature?: (featureId: string, value: unknown) => void;
  onToggleFavoriteModel?: (provider: string, modelId: string) => void;
  onDropdownClose?: () => void;
  onModelSelectorOpen?: () => void;
  onRetryModelProvider?: (provider: AgentProvider) => void;
  isRetryingModelProvider: boolean;
  favoriteKeys: Set<string>;
  disabled: boolean;
  isModelLoading: boolean;
  canSelectModel: boolean;
  canSelectThinking: boolean;
  modelSelectorProviders: ProviderSelectorProvider[];
  modelDisabled: boolean;
  comboboxThinkingOptions: ComboboxOption[];
  openSelector: AgentControlSelector | null;
  ProviderIcon: ReturnType<typeof getProviderIcon> | null;
  selectThinkingLabel: string;
  thinkingTitle: string;
  featuresTitle: string;
  openFeaturesLabel: string;
  activeSheet: ActiveAgentControlSheet;
  handleOpenSheet: (sheet: Exclude<ActiveAgentControlSheet, null>) => void;
  handleCloseSheet: () => void;
  handleSheetModelSelect: (selection: ProviderModelSelectionValue) => void;
  handleSelectThinkingAndClose: (thinkingOptionId: string) => void;
  handleOpenChange: (selector: AgentControlSelector) => (nextOpen: boolean) => void;
  modelSelectorServerId: string | null;
}

const DESKTOP_SEARCH_THRESHOLD = 6;

// Lucide icons only accept `color` (a non-style prop). On web, withUnistyles
// merges call-site `uniProps` onto the child and lucide forwards unknown props
// to the DOM SVG. Inject color via a host that only passes `color`/`size`.
type LucideIconComponent = typeof Brain;

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

const foregroundColorMapping = (theme: Theme) => ({
  color: theme.colors.foreground,
});
const foregroundMutedColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});

function makeBadgePressableStyle(
  baseStyle: StyleProp<ViewStyle>,
  disabledStyle: StyleProp<ViewStyle>,
  disabled: boolean,
  isOpen: boolean,
) {
  return ({ pressed, hovered }: PressableStateCallbackType) => [
    baseStyle,
    hovered && styles.modeBadgeHovered,
    (pressed || isOpen) && styles.modeBadgePressed,
    disabled && disabledStyle,
  ];
}

function ThinkingComboboxOption({
  option,
  selected,
  active,
  onPress,
}: {
  option: ComboboxOption;
  selected: boolean;
  active: boolean;
  onPress: () => void;
}) {
  const leadingSlot = useMemo(
    () => <ThemedLucideIconHost Icon={Brain} size={16} uniProps={foregroundColorMapping} />,
    [],
  );
  return (
    <ComboboxItem
      label={option.label}
      selected={selected}
      active={active}
      onPress={onPress}
      leadingSlot={leadingSlot}
    />
  );
}

function useThinkingOptionRenderer() {
  return useCallback(
    (args: { option: ComboboxOption; selected: boolean; active: boolean; onPress: () => void }) => (
      <ThinkingComboboxOption
        option={args.option}
        selected={args.selected}
        active={args.active}
        onPress={args.onPress}
      />
    ),
    [],
  );
}

export function DesktopAgentControlsContent(props: DesktopAgentControlsContentProps) {
  const {
    provider,
    providerOptions,
    selectedProviderId,
    selectedModelId,
    selectedRuntimeProviderId,
    thinkingOptions,
    selectedThinkingOptionId,
    onToggleFavoriteModel,
    onDropdownClose,
    onModelSelectorOpen,
    onRetryModelProvider,
    isRetryingModelProvider,
    favoriteKeys,
    disabled,
    isModelLoading,
    canSelectProvider,
    canSelectModel,
    canSelectThinking,
    modelSelectorProviders,
    modelDisabled,
    comboboxProviderOptions,
    comboboxThinkingOptions,
    displayProvider,
    displayThinking,
    selectProviderLabel,
    selectThinkingLabel,
    openSelector,
    providerAnchorRef,
    thinkingAnchorRef,
    handleProviderPress,
    handleThinkingPress,
    handleProviderSelect,
    handleThinkingSelect,
    handleDesktopModelSelect,
    handleProviderOpenChange,
    handleThinkingOpenChange,
    extras,
    modelSelectorServerId,
    showModelCluster = true,
  } = props;
  const renderThinkingOption = useThinkingOptionRenderer();
  const providerPressableStyle = useMemo(
    () =>
      makeBadgePressableStyle(
        styles.modeBadge,
        styles.disabledBadge,
        disabled || !canSelectProvider,
        openSelector === "provider",
      ),
    [canSelectProvider, disabled, openSelector],
  );
  const thinkingPressableStyle = useMemo(
    () =>
      makeBadgePressableStyle(
        styles.modeBadge,
        styles.disabledBadge,
        disabled || !canSelectThinking,
        openSelector === "thinking",
      ),
    [canSelectThinking, disabled, openSelector],
  );

  return (
    <>
      {showModelCluster && providerOptions && providerOptions.length > 0 ? (
        <>
          <Pressable
            ref={providerAnchorRef}
            collapsable={false}
            disabled={disabled || !canSelectProvider}
            onPress={handleProviderPress}
            style={providerPressableStyle}
            accessibilityRole="button"
            accessibilityLabel={selectProviderLabel}
            testID="agent-provider-selector"
          >
            <Text style={styles.modeBadgeText}>{displayProvider}</Text>
            <ThemedLucideIconHost
              Icon={ChevronDown}
              size={ICON_SIZE.sm}
              uniProps={foregroundMutedColorMapping}
            />
          </Pressable>
          <Combobox
            options={comboboxProviderOptions}
            value={selectedProviderId ?? ""}
            onSelect={handleProviderSelect}
            searchable={comboboxProviderOptions.length > DESKTOP_SEARCH_THRESHOLD}
            open={openSelector === "provider"}
            onOpenChange={handleProviderOpenChange}
            anchorRef={providerAnchorRef}
            desktopPlacement="top-start"
          />
        </>
      ) : null}

      {showModelCluster && canSelectModel ? (
        <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile={false}>
          <TooltipTrigger asChild triggerRefProp="ref">
            <View>
              <CombinedModelSelector
                providers={modelSelectorProviders}
                selectedProvider={provider}
                selectedRuntimeProvider={selectedRuntimeProviderId}
                selectedModel={selectedModelId ?? ""}
                onSelect={handleDesktopModelSelect}
                favoriteKeys={favoriteKeys}
                onToggleFavorite={onToggleFavoriteModel}
                isLoading={isModelLoading}
                disabled={modelDisabled}
                onOpen={onModelSelectorOpen}
                onClose={onDropdownClose}
                onRetryProvider={onRetryModelProvider}
                isRetryingProvider={isRetryingModelProvider}
                serverId={modelSelectorServerId}
              />
            </View>
          </TooltipTrigger>
          <TooltipContent side="top" align="center" offset={8}>
            <Text style={styles.tooltipText}>{getAgentControlHint("model")}</Text>
          </TooltipContent>
        </Tooltip>
      ) : null}

      {showModelCluster && thinkingOptions && thinkingOptions.length > 0 ? (
        <>
          <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile={false}>
            <TooltipTrigger asChild triggerRefProp="ref">
              <Pressable
                ref={thinkingAnchorRef}
                collapsable={false}
                disabled={disabled || !canSelectThinking}
                onPress={handleThinkingPress}
                style={thinkingPressableStyle}
                accessibilityRole="button"
                accessibilityLabel={selectThinkingLabel}
                testID="agent-thinking-selector"
              >
                <ThemedLucideIconHost
                  Icon={Brain}
                  size={ICON_SIZE.md}
                  uniProps={foregroundMutedColorMapping}
                />
                <Text style={styles.modeBadgeText}>{displayThinking}</Text>
                <ThemedLucideIconHost
                  Icon={ChevronDown}
                  size={ICON_SIZE.sm}
                  uniProps={foregroundMutedColorMapping}
                />
              </Pressable>
            </TooltipTrigger>
            <TooltipContent side="top" align="center" offset={8}>
              <Text style={styles.tooltipText}>{getAgentControlHint("thinking")}</Text>
            </TooltipContent>
          </Tooltip>
          <Combobox
            options={comboboxThinkingOptions}
            value={selectedThinkingOptionId ?? ""}
            onSelect={handleThinkingSelect}
            searchable={comboboxThinkingOptions.length > DESKTOP_SEARCH_THRESHOLD}
            open={openSelector === "thinking"}
            onOpenChange={handleThinkingOpenChange}
            anchorRef={thinkingAnchorRef}
            desktopPlacement="top-start"
            renderOption={renderThinkingOption}
          />
        </>
      ) : null}

      {extras}
    </>
  );
}

export function SheetAgentControlsContent(props: SheetAgentControlsContentProps) {
  const {
    provider,
    selectedModelId,
    selectedRuntimeProviderId,
    selectedThinkingOptionId,
    features,
    onSetFeature,
    onToggleFavoriteModel,
    onDropdownClose,
    onModelSelectorOpen,
    onRetryModelProvider,
    isRetryingModelProvider,
    favoriteKeys,
    disabled,
    isModelLoading,
    canSelectModel,
    canSelectThinking,
    modelSelectorProviders,
    modelDisabled,
    comboboxThinkingOptions,
    openSelector,
    ProviderIcon,
    selectThinkingLabel,
    thinkingTitle,
    featuresTitle,
    openFeaturesLabel,
    activeSheet,
    handleOpenSheet,
    handleCloseSheet,
    handleSheetModelSelect,
    handleSelectThinkingAndClose,
    handleOpenChange,
    modelSelectorServerId,
  } = props;

  const thinkingAnchorRef = useRef<View | null>(null);
  const renderThinkingOption = useThinkingOptionRenderer();
  const hasThinking = comboboxThinkingOptions.length > 0;
  const hasFeatures = Boolean(features && features.length > 0);
  const featuresHeader = useMemo(() => ({ title: featuresTitle }), [featuresTitle]);

  const handleOpenThinking = useCallback(() => handleOpenSheet("thinking"), [handleOpenSheet]);
  const handleOpenFeatures = useCallback(() => handleOpenSheet("features"), [handleOpenSheet]);
  const handleThinkingSheetOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (nextOpen) {
        handleOpenSheet("thinking");
      } else {
        handleCloseSheet();
      }
    },
    [handleCloseSheet, handleOpenSheet],
  );

  const renderModelTrigger = useCallback(
    ({
      selectedModelLabel,
    }: {
      selectedModelLabel: string;
      onPress: () => void;
      disabled: boolean;
      isOpen: boolean;
    }) => (
      <View pointerEvents="none" style={styles.prefsButton} testID="agent-controls-model">
        {ProviderIcon ? (
          <ThemedLucideIconHost
            Icon={ProviderIcon as LucideIconComponent}
            size={ICON_SIZE.lg}
            uniProps={foregroundMutedColorMapping}
          />
        ) : null}
        <Text style={styles.prefsButtonText} numberOfLines={1}>
          {formatCompactModelLabel(selectedModelLabel)}
        </Text>
      </View>
    ),
    [ProviderIcon],
  );

  const thinkingButtonStyle = makeBadgePressableStyle(
    styles.modeIconBadge,
    styles.disabledBadge,
    disabled || !canSelectThinking,
    activeSheet === "thinking",
  );
  const featuresButtonStyle = makeBadgePressableStyle(
    styles.modeIconBadge,
    styles.disabledBadge,
    disabled,
    activeSheet === "features",
  );

  return (
    <>
      {canSelectModel ? (
        <CombinedModelSelector
          providers={modelSelectorProviders}
          selectedProvider={provider}
          selectedRuntimeProvider={selectedRuntimeProviderId}
          selectedModel={selectedModelId ?? ""}
          onSelect={handleSheetModelSelect}
          favoriteKeys={favoriteKeys}
          onToggleFavorite={onToggleFavoriteModel}
          isLoading={isModelLoading}
          disabled={modelDisabled}
          onOpen={onModelSelectorOpen}
          onClose={onDropdownClose}
          onRetryProvider={onRetryModelProvider}
          isRetryingProvider={isRetryingModelProvider}
          renderTrigger={renderModelTrigger}
          serverId={modelSelectorServerId}
        />
      ) : null}

      {hasThinking ? (
        <Pressable
          ref={thinkingAnchorRef}
          onPress={handleOpenThinking}
          disabled={disabled || !canSelectThinking}
          style={thinkingButtonStyle}
          accessibilityRole="button"
          accessibilityLabel={selectThinkingLabel}
          testID="agent-controls-thinking"
        >
          <ThemedLucideIconHost
            Icon={Brain}
            size={ICON_SIZE.md}
            uniProps={foregroundMutedColorMapping}
          />
        </Pressable>
      ) : null}

      {hasFeatures ? (
        <Pressable
          onPress={handleOpenFeatures}
          disabled={disabled}
          style={featuresButtonStyle}
          accessibilityRole="button"
          accessibilityLabel={openFeaturesLabel}
          testID="agent-controls-features"
        >
          <ThemedLucideIconHost
            Icon={Settings2}
            size={ICON_SIZE.md}
            uniProps={foregroundMutedColorMapping}
          />
        </Pressable>
      ) : null}

      {hasThinking ? (
        <Combobox
          options={comboboxThinkingOptions}
          value={selectedThinkingOptionId ?? ""}
          onSelect={handleSelectThinkingAndClose}
          searchable={false}
          title={thinkingTitle}
          open={activeSheet === "thinking"}
          onOpenChange={handleThinkingSheetOpenChange}
          anchorRef={thinkingAnchorRef}
          renderOption={renderThinkingOption}
        />
      ) : null}

      <AdaptiveModalSheet
        header={featuresHeader}
        visible={activeSheet === "features"}
        onClose={handleCloseSheet}
        testID="agent-features-sheet"
      >
        {(features ?? []).map((feature) => (
          <SheetFeatureItem
            key={`feature-${feature.id}`}
            feature={feature}
            disabled={disabled}
            openSelector={openSelector}
            handleOpenChange={handleOpenChange}
            onSetFeature={onSetFeature}
          />
        ))}
      </AdaptiveModalSheet>
    </>
  );
}
