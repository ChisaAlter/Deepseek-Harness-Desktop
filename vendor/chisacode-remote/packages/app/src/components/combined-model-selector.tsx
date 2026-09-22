import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import {
  View,
  Text,
  Pressable,
  ActivityIndicator,
  type GestureResponderEvent,
  type PressableStateCallbackType,
} from "react-native";
import { BottomSheetFlatList } from "@gorhom/bottom-sheet";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import {
  useIsCompactFormFactor,
  WORKBENCH_COMPOSER_CONTROL_HEIGHT,
  WORKBENCH_META_LINE_HEIGHT,
} from "@/constants/layout";
import { isNative, isWeb as platformIsWeb } from "@/constants/platform";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Search,
  Settings,
  Star,
} from "lucide-react-native";
import { useTranslation } from "react-i18next";
import type { AgentProvider } from "@chisacode/protocol/agent-types";
import type { SheetHeader } from "@/components/adaptive-modal-sheet";
import { useProviderSettingsStore } from "@/stores/provider-settings-store";
import { Button } from "@/components/ui/button";
import { ThemedIconHost } from "@/components/themed-icon-host";
import { ICON_SIZE, type Theme } from "@/styles/theme";
const IS_WEB = platformIsWeb;

// Inject theme color via ThemedIconHost so call-site `uniProps` never reaches
// lucide/provider icon leaves (web withUnistyles merges props onto the child).
function ActivityIndicatorHost({
  color,
  size = "small",
  style,
}: {
  color: string;
  size?: number | "small" | "large";
  style?: object;
}) {
  return <ActivityIndicator color={color} size={size} style={style} />;
}

const ThemedActivityIndicatorHost = withUnistyles(ActivityIndicatorHost);

type IconColorMapping = (theme: Theme) => { color: string; fill?: string };

const foregroundMutedColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});
const warningColorMapping = (theme: Theme) => ({
  color: theme.colors.statusWarning,
});
const foregroundColorMapping = (theme: Theme) => ({
  color: theme.colors.foreground,
});
// Favorite star: amber stroke + amber fill when favorited.
const favoriteStarColorMapping = (theme: Theme) => ({
  color: theme.colors.palette.amber[500],
  fill: theme.colors.palette.amber[500],
});
// Hovered (not favorited) star: muted stroke, transparent fill.
const hoveredStarColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
  fill: "transparent",
});
// Default (not favorited, not hovered) star: border stroke, transparent fill.
const defaultStarColorMapping = (theme: Theme) => ({
  color: theme.colors.border,
  fill: "transparent",
});
const settingsIconColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});
const settingsIconDisabledColorMapping = (theme: Theme) => ({
  color: theme.colors.border,
});

import { Combobox, ComboboxItem, type ComboboxOption } from "@/components/ui/combobox";
import {
  resolveInitialSelectorView,
  resolveSingleProviderView,
  resolveTopLevelFavoriteRows,
  type SelectorView,
} from "@/components/combined-model-selector-state";

const EMPTY_COMBOBOX_OPTIONS: ComboboxOption[] = [];

function noop() {}

function favoriteButtonStyle({
  hovered,
  pressed,
}: PressableStateCallbackType & { hovered?: boolean }) {
  return [
    styles.favoriteButton,
    Boolean(hovered) && styles.favoriteButtonHovered,
    pressed && styles.favoriteButtonPressed,
  ];
}

function drillDownRowStyle({
  hovered,
  pressed,
}: PressableStateCallbackType & { hovered?: boolean }) {
  return [
    styles.drillDownRow,
    Boolean(hovered) && styles.drillDownRowHovered,
    pressed && styles.drillDownRowPressed,
  ];
}
import { getProviderIcon } from "@/components/provider-icons";
import {
  buildSelectedTriggerLabel,
  filterAndRankModelRows,
  findErrorSelectorProvider,
  getProviderModelRows,
  resolveSelectedModelLabel,
  type ProviderModelSelectionValue,
  type ProviderSelectionModelRow,
  type ProviderSelectorProvider,
} from "@/provider-selection/provider-selection";

// TODO: this should be configured per provider in the provider manifest
const PROVIDERS_WITH_MODEL_DESCRIPTIONS = new Set(["opencode", "pi"]);
const DESKTOP_PROVIDER_VIEW_MIN_HEIGHT = 220;
const DESKTOP_PROVIDER_VIEW_MAX_HEIGHT = 400;
const DESKTOP_PROVIDER_VIEW_BASE_HEIGHT = 80;
const DESKTOP_MODEL_ROW_HEIGHT = 40;

interface CombinedModelSelectorProps {
  providers: ProviderSelectorProvider[];
  selectedProvider: string;
  selectedRuntimeProvider?: string | null;
  selectedModel: string;
  onSelect: (selection: ProviderModelSelectionValue) => void;
  isLoading: boolean;
  favoriteKeys?: Set<string>;
  onToggleFavorite?: (provider: string, modelId: string) => void;
  renderTrigger?: (input: {
    selectedModelLabel: string;
    onPress: () => void;
    disabled: boolean;
    isOpen: boolean;
  }) => React.ReactNode;
  onOpen?: () => void;
  onClose?: () => void;
  onRetryProvider?: (provider: AgentProvider) => void;
  isRetryingProvider?: boolean;
  disabled?: boolean;
  serverId?: string | null;
}

interface SelectorContentProps {
  view: SelectorView;
  providers: ProviderSelectorProvider[];
  selectedProvider: string;
  selectedRuntimeProvider?: string | null;
  selectedModel: string;
  searchQuery: string;
  favoriteKeys: Set<string>;
  onSelect: (selection: ProviderModelSelectionValue) => void;
  onToggleFavorite?: (provider: string, modelId: string) => void;
  onDrillDown: (providerId: string, providerLabel: string) => void;
  onRetryProvider?: (provider: AgentProvider) => void;
  isRetryingProvider: boolean;
}

function normalizeSearchQuery(value: string): string {
  return value.trim().toLowerCase();
}

function sortFavoritesFirst(
  rows: ProviderSelectionModelRow[],
  favoriteKeys: Set<string>,
): ProviderSelectionModelRow[] {
  const favorites: ProviderSelectionModelRow[] = [];
  const rest: ProviderSelectionModelRow[] = [];
  for (const row of rows) {
    if (favoriteKeys.has(row.favoriteKey)) {
      favorites.push(row);
    } else {
      rest.push(row);
    }
  }
  return [...favorites, ...rest];
}

function ModelRow({
  row,
  isSelected,
  isFavorite,
  elevated = false,
  onPress,
  onToggleFavorite,
}: {
  row: ProviderSelectionModelRow;
  isSelected: boolean;
  isFavorite: boolean;
  elevated?: boolean;
  onPress: () => void;
  onToggleFavorite?: (provider: string, modelId: string) => void;
}) {
  const { t } = useTranslation();
  const ProviderIcon = getProviderIcon(row.agentProvider);

  const handleToggleFavorite = useCallback(
    (event: GestureResponderEvent) => {
      event.stopPropagation();
      onToggleFavorite?.(row.provider, row.modelId);
    },
    [onToggleFavorite, row.modelId, row.provider],
  );

  const leadingSlot = useMemo(
    () => (
      <ThemedIconHost
        Icon={ProviderIcon}
        size={ICON_SIZE.sm}
        uniProps={foregroundMutedColorMapping}
      />
    ),
    [ProviderIcon],
  );
  const trailingSlot = useMemo(
    () =>
      onToggleFavorite ? (
        <Pressable
          onPress={handleToggleFavorite}
          hitSlop={8}
          style={favoriteButtonStyle}
          accessibilityRole="button"
          accessibilityLabel={
            isFavorite ? t("modelSelector.unfavoriteModel") : t("modelSelector.favoriteModel")
          }
          testID={`favorite-model-${row.provider}-${row.modelId}`}
        >
          {({ hovered }) => {
            let starUniProps: IconColorMapping;
            if (isFavorite) {
              starUniProps = favoriteStarColorMapping;
            } else if (hovered) {
              starUniProps = hoveredStarColorMapping;
            } else {
              starUniProps = defaultStarColorMapping;
            }
            return <ThemedIconHost Icon={Star} size={16} uniProps={starUniProps} />;
          }}
        </Pressable>
      ) : null,
    [onToggleFavorite, handleToggleFavorite, isFavorite, row.provider, row.modelId, t],
  );

  const showDescription = row.description && PROVIDERS_WITH_MODEL_DESCRIPTIONS.has(row.provider);

  return (
    <ComboboxItem
      label={row.modelLabel}
      description={showDescription ? row.description : undefined}
      selected={isSelected}
      elevated={elevated}
      onPress={onPress}
      leadingSlot={leadingSlot}
      trailingSlot={trailingSlot}
      accessibilityRole={onToggleFavorite ? "menuitem" : "button"}
    />
  );
}

interface SelectableModelRowProps {
  row: ProviderSelectionModelRow;
  isSelected: boolean;
  isFavorite: boolean;
  elevated?: boolean;
  onSelect: (selection: ProviderModelSelectionValue) => void;
  onToggleFavorite?: (provider: string, modelId: string) => void;
}

function SelectableModelRow({
  row,
  isSelected,
  isFavorite,
  elevated,
  onSelect,
  onToggleFavorite,
}: SelectableModelRowProps) {
  const handlePress = useCallback(() => {
    onSelect({
      agentProvider: row.agentProvider,
      runtimeProvider: row.runtimeProvider,
      modelId: row.modelId,
    });
  }, [onSelect, row.agentProvider, row.runtimeProvider, row.modelId]);
  return (
    <ModelRow
      row={row}
      isSelected={isSelected}
      isFavorite={isFavorite}
      elevated={elevated}
      onPress={handlePress}
      onToggleFavorite={onToggleFavorite}
    />
  );
}

function FavoritesSection({
  favoriteRows,
  selectedProvider,
  selectedRuntimeProvider,
  selectedModel,
  favoriteKeys,
  onSelect,
  onToggleFavorite,
}: {
  favoriteRows: ProviderSelectionModelRow[];
  selectedProvider: string;
  selectedRuntimeProvider?: string | null;
  selectedModel: string;
  favoriteKeys: Set<string>;
  onSelect: (selection: ProviderModelSelectionValue) => void;
  onToggleFavorite?: (provider: string, modelId: string) => void;
}) {
  const { t } = useTranslation();
  if (favoriteRows.length === 0) {
    return null;
  }

  return (
    <View style={styles.favoritesContainer}>
      <View style={styles.sectionHeading}>
        <Text style={styles.sectionHeadingText}>{t("modelSelector.favorites")}</Text>
      </View>
      {favoriteRows.map((row) => (
        <SelectableModelRow
          key={row.favoriteKey}
          row={row}
          isSelected={
            row.agentProvider === selectedProvider &&
            row.runtimeProvider === (selectedRuntimeProvider ?? selectedProvider) &&
            row.modelId === selectedModel
          }
          isFavorite={favoriteKeys.has(row.favoriteKey)}
          elevated
          onSelect={onSelect}
          onToggleFavorite={onToggleFavorite}
        />
      ))}
    </View>
  );
}

interface GroupProviderButtonProps {
  provider: ProviderSelectorProvider;
  onDrillDown: (providerId: string, providerLabel: string) => void;
}

function iconButtonStyle({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) {
  return [
    styles.rowIconButton,
    Boolean(hovered) && styles.rowIconButtonHovered,
    pressed && styles.rowIconButtonPressed,
  ];
}

function cachedWarningRetryStyle({
  hovered,
  pressed,
}: PressableStateCallbackType & { hovered?: boolean }) {
  return [
    styles.cachedWarningRetry,
    Boolean(hovered) && styles.cachedWarningRetryHovered,
    pressed && styles.cachedWarningRetryPressed,
  ];
}

function GroupProviderButton({ provider, onDrillDown }: GroupProviderButtonProps) {
  const { t } = useTranslation();
  const ProvIcon = getProviderIcon(provider.id);
  const selection = provider.modelSelection;

  const handlePress = useCallback(() => {
    onDrillDown(provider.id, provider.label);
  }, [onDrillDown, provider.id, provider.label]);

  let stateNode: React.ReactNode;
  if (selection.kind === "models") {
    const count = selection.rows.length;
    stateNode = (
      <View style={styles.rowStateInline}>
        <Text style={styles.drillDownCount}>{t("modelSelector.modelCount", { count })}</Text>
        {provider.status === "error" ? (
          <Text style={styles.cachedBadge}>{t("modelSelector.cachedBadge")}</Text>
        ) : null}
      </View>
    );
  } else if (selection.kind === "loading") {
    stateNode = (
      <View style={styles.rowStateInline}>
        <ThemedActivityIndicatorHost
          size="small"
          uniProps={foregroundMutedColorMapping}
          style={styles.rowSpinner}
        />
        <Text style={styles.drillDownCount}>{t("modelSelector.loading")}</Text>
      </View>
    );
  } else {
    stateNode = (
      <View style={styles.rowStateInline}>
        <ThemedIconHost
          Icon={AlertTriangle}
          size={ICON_SIZE.sm}
          uniProps={foregroundMutedColorMapping}
        />
        <Text style={styles.drillDownCount}>{t("modelSelector.error")}</Text>
      </View>
    );
  }

  return (
    <Pressable
      onPress={handlePress}
      style={drillDownRowStyle}
      accessibilityRole="button"
      accessibilityLabel={provider.label}
    >
      <ThemedIconHost Icon={ProvIcon} size={ICON_SIZE.sm} uniProps={foregroundMutedColorMapping} />
      <Text style={styles.drillDownText}>{provider.label}</Text>
      <View style={styles.drillDownTrailing}>
        {stateNode}
        <ThemedIconHost
          Icon={ChevronRight}
          size={ICON_SIZE.sm}
          uniProps={foregroundMutedColorMapping}
        />
      </View>
    </Pressable>
  );
}

function GroupedProviderRows({
  providers,
  onDrillDown,
}: {
  providers: ProviderSelectorProvider[];
  onDrillDown: (providerId: string, providerLabel: string) => void;
}) {
  return (
    <View>
      {providers.map((provider, index) => (
        <View key={provider.id}>
          {index > 0 ? <View style={styles.separator} /> : null}
          <GroupProviderButton provider={provider} onDrillDown={onDrillDown} />
        </View>
      ))}
    </View>
  );
}

function ProviderModelRows({
  rows,
  selectedProvider,
  selectedRuntimeProvider,
  selectedModel,
  favoriteKeys,
  onSelect,
  onToggleFavorite,
  normalizedQuery,
}: {
  rows: ProviderSelectionModelRow[];
  selectedProvider: string;
  selectedRuntimeProvider?: string | null;
  selectedModel: string;
  favoriteKeys: Set<string>;
  onSelect: (selection: ProviderModelSelectionValue) => void;
  onToggleFavorite?: (provider: string, modelId: string) => void;
  normalizedQuery: string;
}) {
  const isMobile = useIsCompactFormFactor();
  const useVirtualizedList = isMobile && isNative;
  const displayRows = useMemo(
    () => (normalizedQuery ? rows : sortFavoritesFirst(rows, favoriteKeys)),
    [favoriteKeys, normalizedQuery, rows],
  );
  const renderItem = useCallback(
    ({ item }: { item: ProviderSelectionModelRow }) => (
      <SelectableModelRow
        row={item}
        isSelected={
          item.agentProvider === selectedProvider &&
          item.runtimeProvider === (selectedRuntimeProvider ?? selectedProvider) &&
          item.modelId === selectedModel
        }
        isFavorite={favoriteKeys.has(item.favoriteKey)}
        onSelect={onSelect}
        onToggleFavorite={onToggleFavorite}
      />
    ),
    [
      favoriteKeys,
      onSelect,
      onToggleFavorite,
      selectedModel,
      selectedProvider,
      selectedRuntimeProvider,
    ],
  );
  const keyExtractor = useCallback((row: ProviderSelectionModelRow) => row.favoriteKey, []);

  if (useVirtualizedList) {
    return (
      <BottomSheetFlatList
        data={displayRows}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        style={styles.virtualizedModelList}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.virtualizedModelListContent}
      />
    );
  }

  return (
    <View>
      {displayRows.map((row) => (
        <View key={row.favoriteKey}>{renderItem({ item: row })}</View>
      ))}
    </View>
  );
}

function ProviderErrorEmptyState({
  providerId,
  message,
  onRetryProvider,
  isRetryingProvider,
}: {
  providerId: string;
  message: string;
  onRetryProvider?: (provider: AgentProvider) => void;
  isRetryingProvider: boolean;
}) {
  const { t } = useTranslation();
  const handleRetry = useCallback(() => {
    onRetryProvider?.(providerId);
  }, [onRetryProvider, providerId]);
  return (
    <View style={styles.emptyState}>
      <ThemedIconHost
        Icon={AlertTriangle}
        size={ICON_SIZE.md}
        uniProps={foregroundMutedColorMapping}
      />
      <Text style={styles.emptyStateText}>{message}</Text>
      {onRetryProvider ? (
        <Button variant="default" size="sm" onPress={handleRetry} disabled={isRetryingProvider}>
          {isRetryingProvider ? t("modelSelector.retrying") : t("common.retry")}
        </Button>
      ) : null}
    </View>
  );
}

/**
 * Warning strip rendered above a provider's model list when the provider is in
 * error but last-good cached models are still shown. Retry targets only this
 * provider.
 */
function ProviderCachedWarningStrip({
  providerId,
  message,
  onRetryProvider,
  isRetryingProvider,
}: {
  providerId: string;
  message: string;
  onRetryProvider?: (provider: AgentProvider) => void;
  isRetryingProvider: boolean;
}) {
  const { t } = useTranslation();
  const handleRetry = useCallback(() => {
    onRetryProvider?.(providerId);
  }, [onRetryProvider, providerId]);
  return (
    <View style={styles.cachedWarningStrip}>
      <ThemedIconHost Icon={AlertTriangle} size={ICON_SIZE.sm} uniProps={warningColorMapping} />
      <View style={styles.cachedWarningBody}>
        <Text numberOfLines={1} style={styles.cachedWarningText}>
          {t("modelSelector.connectionIssueHeader")}
        </Text>
        <Text numberOfLines={1} style={styles.cachedWarningDetail}>
          {message}
        </Text>
      </View>
      {onRetryProvider ? (
        <Pressable
          onPress={handleRetry}
          disabled={isRetryingProvider}
          style={cachedWarningRetryStyle}
          accessibilityRole="button"
          accessibilityLabel={t("common.retry")}
        >
          {isRetryingProvider ? (
            <ThemedActivityIndicatorHost
              size="small"
              uniProps={warningColorMapping}
              style={styles.cachedWarningRetrySpinner}
            />
          ) : null}
          <Text style={styles.cachedWarningRetryText}>
            {isRetryingProvider ? t("modelSelector.retrying") : t("common.retry")}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function SelectorContent({
  view,
  providers,
  selectedProvider,
  selectedRuntimeProvider,
  selectedModel,
  searchQuery,
  favoriteKeys,
  onSelect,
  onToggleFavorite,
  onDrillDown,
  onRetryProvider,
  isRetryingProvider,
}: SelectorContentProps) {
  const { t } = useTranslation();
  const normalizedQuery = useMemo(() => normalizeSearchQuery(searchQuery), [searchQuery]);
  const selectedViewProvider = useMemo(
    () =>
      view.kind === "provider"
        ? providers.find((provider) => provider.id === view.providerId)
        : null,
    [providers, view],
  );
  const visibleRows = useMemo(
    () =>
      selectedViewProvider
        ? filterAndRankModelRows(getProviderModelRows(selectedViewProvider), normalizedQuery)
        : [],
    [normalizedQuery, selectedViewProvider],
  );
  const favoriteRows = useMemo(
    () => resolveTopLevelFavoriteRows({ providers, favoriteKeys }),
    [favoriteKeys, providers],
  );
  const hasResults = favoriteRows.length > 0 || providers.length > 0;
  let emptyMessage = t("providerSelection.noProviders");
  if (normalizedQuery.length > 0) {
    emptyMessage = t("modelSelector.noSearchMatches");
  } else if (view.kind === "provider") {
    emptyMessage = t("providerSelection.providerNoModels");
  }
  const emptyState = (
    <View style={styles.emptyState}>
      <ThemedIconHost Icon={Search} size={ICON_SIZE.md} uniProps={foregroundMutedColorMapping} />
      <Text style={styles.emptyStateText}>{emptyMessage}</Text>
    </View>
  );

  if (view.kind === "provider") {
    if (!selectedViewProvider) {
      return emptyState;
    }
    const drillSelection = selectedViewProvider.modelSelection;
    if (drillSelection.kind === "loading") {
      return (
        <View style={styles.emptyState}>
          <ThemedActivityIndicatorHost
            size="small"
            uniProps={foregroundMutedColorMapping}
            style={styles.rowSpinner}
          />
          <Text style={styles.emptyStateText}>{t("modelSelector.loading")}</Text>
        </View>
      );
    }
    if (drillSelection.kind === "error") {
      return (
        <ProviderErrorEmptyState
          providerId={view.providerId}
          message={drillSelection.message}
          onRetryProvider={onRetryProvider}
          isRetryingProvider={isRetryingProvider}
        />
      );
    }
    if (visibleRows.length === 0) {
      return emptyState;
    }

    return (
      <>
        {selectedViewProvider.status === "error" ? (
          <ProviderCachedWarningStrip
            providerId={view.providerId}
            message={selectedViewProvider.error ?? t("modelSelector.unknownError")}
            onRetryProvider={onRetryProvider}
            isRetryingProvider={isRetryingProvider}
          />
        ) : null}
        <ProviderModelRows
          rows={visibleRows}
          selectedProvider={selectedProvider}
          selectedRuntimeProvider={selectedRuntimeProvider}
          selectedModel={selectedModel}
          favoriteKeys={favoriteKeys}
          onSelect={onSelect}
          onToggleFavorite={onToggleFavorite}
          normalizedQuery={normalizedQuery}
        />
      </>
    );
  }

  return (
    <View>
      <FavoritesSection
        favoriteRows={favoriteRows}
        selectedProvider={selectedProvider}
        selectedRuntimeProvider={selectedRuntimeProvider}
        selectedModel={selectedModel}
        favoriteKeys={favoriteKeys}
        onSelect={onSelect}
        onToggleFavorite={onToggleFavorite}
      />

      {providers.length > 0 ? (
        <GroupedProviderRows providers={providers} onDrillDown={onDrillDown} />
      ) : null}

      {!hasResults ? emptyState : null}
    </View>
  );
}

export function CombinedModelSelector({
  providers,
  selectedProvider,
  selectedRuntimeProvider = null,
  selectedModel,
  onSelect,
  isLoading,
  favoriteKeys = new Set<string>(),
  onToggleFavorite,
  renderTrigger,
  onOpen,
  onClose,
  onRetryProvider,
  isRetryingProvider = false,
  disabled = false,
  serverId = null,
}: CombinedModelSelectorProps) {
  const { t } = useTranslation();
  const anchorRef = useRef<View>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [isContentReady, setIsContentReady] = useState(platformIsWeb);
  const [view, setView] = useState<SelectorView>({ kind: "all" });
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResetKey, bumpSearchResetKey] = useReducer((key: number) => key + 1, 0);

  // Single-provider mode: only one provider → skip Level 1 entirely
  const singleProviderView = useMemo<SelectorView | null>(() => {
    return resolveSingleProviderView(providers);
  }, [providers]);

  const computeInitialView = useCallback((): SelectorView => {
    return resolveInitialSelectorView({
      providers,
      selectedProvider,
      selectedModel,
      favoriteKeys,
    });
  }, [selectedProvider, selectedModel, favoriteKeys, providers]);

  const handleOpenChange = useCallback(
    (open: boolean) => {
      setIsOpen(open);
      setView(computeInitialView());
      if (open) {
        onOpen?.();
      } else {
        setSearchQuery("");
        bumpSearchResetKey();
        onClose?.();
      }
    },
    [onOpen, onClose, computeInitialView],
  );

  const handleSelect = useCallback(
    (selection: ProviderModelSelectionValue) => {
      onSelect(selection);
      setIsOpen(false);
      setSearchQuery("");
      bumpSearchResetKey();
    },
    [onSelect],
  );

  const selectedModelLabel = useMemo(() => {
    return resolveSelectedModelLabel({
      providers,
      selectedProvider,
      selectedRuntimeProvider,
      selectedModel,
      isLoading,
      copy: {
        selectModel: t("modelSelector.selectModel"),
        loading: t("modelSelector.loading"),
        error: t("modelSelector.error"),
      },
    });
  }, [isLoading, providers, selectedModel, selectedProvider, selectedRuntimeProvider, t]);

  const selectedProviderIsError = useMemo(
    () => findErrorSelectorProvider(providers, selectedProvider) !== null,
    [providers, selectedProvider],
  );

  const desktopFixedHeight = useMemo(() => {
    if (view.kind !== "provider") {
      return undefined;
    }
    const provider = providers.find((entry) => entry.id === view.providerId);
    if (!provider || provider.modelSelection.kind !== "models") {
      return DESKTOP_PROVIDER_VIEW_MIN_HEIGHT;
    }
    const modelCount = getProviderModelRows(provider).length;
    return Math.min(
      Math.max(
        DESKTOP_PROVIDER_VIEW_MIN_HEIGHT,
        DESKTOP_PROVIDER_VIEW_BASE_HEIGHT + modelCount * DESKTOP_MODEL_ROW_HEIGHT,
      ),
      DESKTOP_PROVIDER_VIEW_MAX_HEIGHT,
    );
  }, [providers, view]);

  const triggerLabel = useMemo(() => {
    return buildSelectedTriggerLabel(selectedModelLabel);
  }, [selectedModelLabel]);

  useEffect(() => {
    if (platformIsWeb) {
      return () => {};
    }

    if (!isOpen) {
      setIsContentReady(false);
      return () => {};
    }

    const frame = requestAnimationFrame(() => {
      setIsContentReady(true);
    });

    return () => cancelAnimationFrame(frame);
  }, [isOpen]);

  const handleTriggerPress = useCallback(() => {
    handleOpenChange(!isOpen);
  }, [handleOpenChange, isOpen]);

  const handleClose = useCallback(() => {
    handleOpenChange(false);
  }, [handleOpenChange]);

  const triggerStyle = useCallback(
    ({ pressed, hovered }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.trigger,
      Boolean(hovered) && styles.triggerHovered,
      (pressed || isOpen) && styles.triggerPressed,
      disabled && styles.triggerDisabled,
      renderTrigger ? styles.customTriggerWrapper : null,
    ],
    [disabled, isOpen, renderTrigger],
  );

  const handleBackToAll = useCallback(() => {
    setView({ kind: "all" });
    setSearchQuery("");
    bumpSearchResetKey();
  }, []);

  const handleDrillDown = useCallback((providerId: string, providerLabel: string) => {
    setView({ kind: "provider", providerId, providerLabel });
  }, []);

  const handleSearchQueryChange = useCallback((value: string) => {
    setSearchQuery(value);
  }, []);

  const openHeaderProviderSettings = useCallback(() => {
    if (!serverId || view.kind !== "provider") return;
    useProviderSettingsStore.getState().open({ serverId, provider: view.providerId });
    handleClose();
  }, [serverId, view, handleClose]);

  const sheetHeader = useMemo<SheetHeader>(() => {
    if (view.kind === "all") {
      return { title: t("modelSelector.selectProvider") };
    }
    const ProviderIconForView = getProviderIcon(view.providerId);
    const headerActions = (
      <Pressable
        onPress={openHeaderProviderSettings}
        disabled={!serverId}
        hitSlop={8}
        style={iconButtonStyle}
        accessibilityRole="button"
        accessibilityLabel={t("modelSelector.openProviderSettings", {
          provider: view.providerLabel,
        })}
        testID={`selector-header-settings-${view.providerId}`}
      >
        <ThemedIconHost
          Icon={Settings}
          size={ICON_SIZE.sm}
          uniProps={!serverId ? settingsIconDisabledColorMapping : settingsIconColorMapping}
        />
      </Pressable>
    );
    return {
      title: view.providerLabel,
      leading: ProviderIconForView ? (
        <ThemedIconHost
          Icon={ProviderIconForView}
          size={ICON_SIZE.md}
          uniProps={foregroundColorMapping}
        />
      ) : undefined,
      back: singleProviderView ? undefined : { onPress: handleBackToAll },
      actions: headerActions,
      search: {
        onChange: handleSearchQueryChange,
        resetKey: `${view.providerId}:${searchResetKey}`,
        placeholder: t("modelSelector.searchModels"),
        autoFocus: platformIsWeb,
        testID: "model-search-input",
      },
    };
  }, [
    view,
    singleProviderView,
    serverId,
    openHeaderProviderSettings,
    handleBackToAll,
    handleSearchQueryChange,
    searchResetKey,
    t,
  ]);

  return (
    <>
      <Pressable
        ref={anchorRef}
        collapsable={false}
        disabled={disabled}
        onPress={handleTriggerPress}
        style={triggerStyle}
        accessibilityRole="button"
        accessibilityLabel={t("modelSelector.selectModelWithValue", {
          value: selectedModelLabel,
        })}
        testID="combined-model-selector"
      >
        {renderTrigger ? (
          renderTrigger({
            selectedModelLabel: triggerLabel,
            onPress: handleTriggerPress,
            disabled,
            isOpen,
          })
        ) : (
          <>
            <Text style={styles.triggerText} numberOfLines={1} ellipsizeMode="tail">
              {triggerLabel}
            </Text>
            {selectedProviderIsError ? <View style={styles.triggerWarningDot} /> : null}
            <ThemedIconHost Icon={ChevronDown} size={10} uniProps={foregroundMutedColorMapping} />
          </>
        )}
      </Pressable>
      <Combobox
        options={EMPTY_COMBOBOX_OPTIONS}
        value=""
        onSelect={noop}
        open={isOpen}
        onOpenChange={handleOpenChange}
        anchorRef={anchorRef}
        desktopPlacement="top-start"
        desktopMinWidth={360}
        desktopFixedHeight={desktopFixedHeight}
        header={sheetHeader}
        mobileChildrenScrollEnabled={view.kind !== "provider" || !isNative}
      >
        {isContentReady ? (
          <SelectorContent
            view={view}
            providers={providers}
            selectedProvider={selectedProvider}
            selectedRuntimeProvider={selectedRuntimeProvider}
            selectedModel={selectedModel}
            searchQuery={searchQuery}
            favoriteKeys={favoriteKeys}
            onSelect={handleSelect}
            onToggleFavorite={onToggleFavorite}
            onDrillDown={handleDrillDown}
            onRetryProvider={onRetryProvider}
            isRetryingProvider={isRetryingProvider}
          />
        ) : (
          <View style={styles.sheetLoadingState}>
            <ThemedActivityIndicatorHost size="small" uniProps={foregroundMutedColorMapping} />
            <Text style={styles.sheetLoadingText}>{t("modelSelector.loadingSelector")}</Text>
          </View>
        )}
      </Combobox>
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  trigger: {
    height: WORKBENCH_COMPOSER_CONTROL_HEIGHT,
    minWidth: 73,
    flexShrink: 1,
    flexDirection: "row",
    alignItems: "center",
    // Flat into the composer surface — no chip border/fill.
    backgroundColor: "transparent",
    gap: 3,
    paddingHorizontal: 8,
    borderRadius: 10,
  },
  triggerHovered: {
    backgroundColor: theme.colors.surface1,
  },
  triggerPressed: {
    backgroundColor: theme.colors.surface1,
  },
  triggerDisabled: {
    opacity: 0.5,
  },
  // Soft composer meta chip: 12.5 muted.
  triggerText: {
    minWidth: 0,
    flexShrink: 1,
    color: theme.colors.foregroundMuted,
    fontSize: 12.5,
    lineHeight: WORKBENCH_META_LINE_HEIGHT,
    fontWeight: theme.fontWeight.normal,
  },
  triggerWarningDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: theme.colors.statusWarning,
    flexShrink: 0,
  },
  customTriggerWrapper: {
    paddingHorizontal: 0,
    paddingVertical: 0,
    height: "auto",
  },
  favoritesContainer: {
    backgroundColor: theme.colors.surfaceWorkspace,
    borderBottomWidth: 1,
    // Soft quiet strip rule (--border-soft).
    borderBottomColor: theme.colors.secondary,
  },
  separator: {
    height: 1,
    backgroundColor: theme.colors.secondary,
  },
  sectionHeading: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: 10,
    paddingTop: theme.spacing[2],
    paddingBottom: theme.spacing[1],
    ...(IS_WEB ? {} : { marginHorizontal: theme.spacing[1] }),
  },
  // Soft menu section label: 12.5 medium muted.
  sectionHeadingText: {
    fontSize: 12.5,
    lineHeight: 16,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.foregroundMuted,
  },
  // Soft menu-hint row: pad 8 10, minH 34.
  drillDownRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: 10,
    paddingVertical: 8,
    minHeight: 34,
    ...(IS_WEB ? {} : { marginHorizontal: theme.spacing[1] }),
  },
  drillDownRowHovered: {
    backgroundColor: theme.colors.surface1,
  },
  drillDownRowPressed: {
    backgroundColor: theme.colors.surface1,
  },
  drillDownText: {
    flex: 1,
    fontSize: 12.5,
    lineHeight: 16,
    color: theme.colors.foreground,
  },
  drillDownTrailing: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  drillDownCount: {
    fontSize: 12.5,
    lineHeight: 16,
    color: theme.colors.foregroundMuted,
  },
  // Amber "cached" badge on provider rows whose probe is in error while
  // last-good models are still shown.
  cachedBadge: {
    fontSize: 11,
    lineHeight: 14,
    color: theme.colors.statusWarning,
    backgroundColor: theme.colors.statusWarningBg,
    borderRadius: 5,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  cachedWarningStrip: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    backgroundColor: theme.colors.statusWarningBg,
    borderWidth: 1,
    borderColor: "rgba(217, 119, 6, 0.28)",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginHorizontal: theme.spacing[1],
    marginBottom: theme.spacing[1],
  },
  cachedWarningBody: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  cachedWarningText: {
    fontSize: 12,
    lineHeight: 16,
    color: theme.colors.statusWarning,
  },
  cachedWarningDetail: {
    fontSize: 11,
    lineHeight: 14,
    color: theme.colors.foregroundMuted,
  },
  cachedWarningRetry: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    backgroundColor: theme.colors.surface0,
    borderWidth: 1,
    borderColor: "rgba(217, 119, 6, 0.28)",
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    flexShrink: 0,
  },
  cachedWarningRetryHovered: {
    backgroundColor: theme.colors.statusWarningBg,
  },
  cachedWarningRetryPressed: {
    backgroundColor: theme.colors.statusWarningBg,
  },
  cachedWarningRetryText: {
    fontSize: 12,
    lineHeight: 16,
    color: theme.colors.statusWarning,
  },
  cachedWarningRetrySpinner: {
    width: 10,
    height: 10,
  },
  rowStateInline: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    flexShrink: 1,
    minWidth: 0,
  },
  rowErrorText: {
    fontSize: 12.5,
    lineHeight: 16,
    color: theme.colors.foregroundMuted,
    maxWidth: 140,
  },
  rowIconButton: {
    width: 28,
    height: 28,
    borderRadius: theme.borderRadius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  rowSpinner: {
    transform: [{ scale: 0.7 }],
  },
  rowIconButtonHovered: {
    backgroundColor: theme.colors.surface1,
  },
  rowIconButtonPressed: {
    backgroundColor: theme.colors.surface1,
  },
  emptyState: {
    paddingVertical: theme.spacing[4],
    alignItems: "center",
    gap: theme.spacing[2],
  },
  emptyStateText: {
    // Soft empty menu copy: 12.5 muted.
    fontSize: 12.5,
    lineHeight: 16,
    color: theme.colors.foregroundMuted,
  },
  virtualizedModelList: {
    flex: 1,
  },
  virtualizedModelListContent: {
    paddingHorizontal: theme.spacing[2],
    paddingTop: theme.spacing[1],
    paddingBottom: theme.spacing[8],
  },
  favoriteButton: {
    width: 28,
    height: 28,
    borderRadius: theme.borderRadius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  favoriteButtonHovered: {
    backgroundColor: theme.colors.surface1,
  },
  favoriteButtonPressed: {
    backgroundColor: theme.colors.surface1,
  },
  sheetLoadingState: {
    minHeight: 160,
    justifyContent: "center",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  sheetLoadingText: {
    color: theme.colors.foregroundMuted,
    // Soft model sheet chrome: 12.5 meta.
    fontSize: 12.5,
    lineHeight: 18,
  },
}));
