import { memo, useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { Keyboard, View } from "react-native";

import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/shallow";

import { getProviderIcon } from "@/components/provider-icons";
import { CombinedModelSelector } from "@/components/combined-model-selector";
import type {
  ProviderModelSelectionValue,
  ProviderSelectorProvider,
} from "@/provider-selection/provider-selection";
import { resolveProviderSnapshotLoadingState } from "@/provider-selection/provider-snapshot-loading";
import { resolveDraftModelSelectorLoading } from "@/composer/agent-controls/model-loading";
import { styles } from "@/composer/agent-controls/agent-control-styles";
import {
  DesktopAgentControlsContent,
  SheetAgentControlsContent,
} from "@/composer/agent-controls/agent-control-renderers";
import type {
  ActiveAgentControlSheet,
  AgentControlOption,
  AgentControlSelector,
} from "@/composer/agent-controls/agent-control-types";
import { useRunningAgentModelControls } from "@/composer/agent-controls/running-agent-model-controls";
import { useSessionStore } from "@/stores/session-store";
import { useProvidersSnapshot } from "@/hooks/use-providers-snapshot";
import {
  buildFavoriteModelKey,
  mergeProviderPreferences,
  toggleFavoriteModel,
  useFormPreferences,
} from "@/hooks/use-form-preferences";
import type { ComboboxOption } from "@/components/ui/combobox";
import { DraftAgentModeControl, AgentModeControl } from "@/composer/agent-controls/mode-control";
import type {
  AgentFeature,
  AgentMode,
  AgentModelDefinition,
  AgentProvider,
} from "@chisacode/protocol/agent-types";
import type { AgentProviderDefinition } from "@chisacode/protocol/provider-manifest";
import { formatThinkingOptionLabel } from "@/composer/agent-controls/utils";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useToast } from "@/contexts/toast-context";
import { toErrorMessage } from "@/utils/error-messages";

interface ControlledAgentControlsProps {
  provider: string;
  providerOptions?: AgentControlOption[];
  selectedProviderId?: string;
  onSelectProvider?: (providerId: string) => void;
  modelOptions?: AgentControlOption[];
  selectedModelId?: string;
  selectedRuntimeProviderId?: string | null;
  onSelectModel?: (modelId: string) => void;
  onSelectProviderAndModel?: (provider: string, modelId: string, runtimeProvider?: string) => void;
  thinkingOptions?: AgentControlOption[];
  selectedThinkingOptionId?: string;
  onSelectThinkingOption?: (thinkingOptionId: string) => void;
  disabled?: boolean;
  isModelLoading?: boolean;
  modelSelectorProviders?: ProviderSelectorProvider[];
  favoriteKeys?: Set<string>;
  onToggleFavoriteModel?: (provider: string, modelId: string) => void;
  features?: AgentFeature[];
  onSetFeature?: (featureId: string, value: unknown) => void;
  onDropdownClose?: () => void;
  onModelSelectorOpen?: () => void;
  onRetryModelProvider?: (provider: AgentProvider) => void;
  isRetryingModelProvider?: boolean;
  /** Extra elements rendered inline with the agent controls (desktop only). */
  desktopExtras?: ReactNode;
  /** Extra elements rendered inline with the compact sheet controls. */
  compactExtras?: ReactNode;
  modelSelectorServerId?: string | null;
  /**
   * Soft desktop cbar partition.
   * - `full`: provider/model/thinking + extras (legacy single row)
   * - `model`: provider/model/thinking only (right cbar)
   * - `mode`: extras only (left cbar; typically the mode chip)
   */
  desktopSegment?: "full" | "model" | "mode";
}

export interface DraftAgentControlsProps {
  providerDefinitions: AgentProviderDefinition[];
  selectedProvider: AgentProvider | null;
  onSelectProvider: (provider: AgentProvider) => void;
  modeOptions: AgentMode[];
  selectedMode: string;
  onSelectMode: (modeId: string) => void;
  models: AgentModelDefinition[];
  selectedModel: string;
  selectedRuntimeProvider?: string | null;
  onSelectModel: (modelId: string) => void;
  isModelLoading: boolean;
  modelSelectorProviders: ProviderSelectorProvider[];
  isAllModelsLoading: boolean;
  onSelectProviderAndModel: (
    provider: AgentProvider,
    modelId: string,
    runtimeProvider?: string,
  ) => void;
  thinkingOptions: NonNullable<AgentModelDefinition["thinkingOptions"]>;
  selectedThinkingOptionId: string;
  onSelectThinkingOption: (thinkingOptionId: string) => void;
  features?: AgentFeature[];
  onSetFeature?: (featureId: string, value: unknown) => void;
  onDropdownClose?: () => void;
  onModelSelectorOpen?: () => void;
  onRetryModelProvider?: (provider: AgentProvider) => void;
  isRetryingModelProvider?: boolean;
  disabled?: boolean;
  modelSelectorServerId?: string | null;
  /** Soft Workbench cbar partition. Default keeps prior single-cluster layout. */
  slot?: AgentControlsSlot;
}

/**
 * Soft pen-bar toolbar slot.
 * - `all`: single cluster (compact / legacy)
 * - `mode`: left cbar — mode chip only
 * - `model`: right cbar — provider/model/thinking (no mode)
 */
export type AgentControlsSlot = "all" | "mode" | "model";

interface AgentControlsProps {
  agentId: string;
  serverId: string;
  onDropdownClose?: () => void;
  /** Soft Workbench cbar partition. Default keeps prior single-cluster layout. */
  slot?: AgentControlsSlot;
}

function findOptionLabel(
  options: AgentControlOption[] | undefined,
  selectedId: string | undefined,
  fallback: string,
) {
  if (!options || options.length === 0) {
    return fallback;
  }
  const selected = options.find((option) => option.id === selectedId);
  return selected?.label ?? fallback;
}

// Mobile agent controls only — strip namespace prefix so providers like OpenCode
// show "gpt-5.5" instead of "openrouter/gpt-5.5". Full label still appears in
// the model picker.
function resolveHasAnyControl({
  providerOptions,
  canSelectModel,
  thinkingOptions,
  features,
  hasDesktopExtras,
}: {
  providerOptions: AgentControlOption[] | undefined;
  canSelectModel: boolean;
  thinkingOptions: AgentControlOption[] | undefined;
  features: AgentFeature[] | undefined;
  hasDesktopExtras: boolean;
}) {
  return (
    Boolean(providerOptions?.length) ||
    canSelectModel ||
    Boolean(thinkingOptions?.length) ||
    Boolean(features?.length) ||
    hasDesktopExtras
  );
}

function resolveDesktopSegmentVisibility(desktopSegment: "full" | "model" | "mode") {
  return {
    showDesktopModelCluster: desktopSegment !== "mode",
    showDesktopModeCluster: desktopSegment !== "model",
  };
}

function resolveSegmentedHasAnyControl(input: {
  isCompact: boolean;
  showDesktopModelCluster: boolean;
  showDesktopModeCluster: boolean;
  providerOptions: AgentControlOption[] | undefined;
  canSelectModel: boolean;
  thinkingOptions: AgentControlOption[] | undefined;
  features: AgentFeature[] | undefined;
  desktopExtras: ReactNode;
}) {
  const includeModelCluster = input.showDesktopModelCluster || input.isCompact;
  return resolveHasAnyControl({
    providerOptions: includeModelCluster ? input.providerOptions : undefined,
    canSelectModel: includeModelCluster && input.canSelectModel,
    thinkingOptions: includeModelCluster ? input.thinkingOptions : undefined,
    features: input.isCompact ? input.features : undefined,
    hasDesktopExtras:
      input.showDesktopModeCluster &&
      input.desktopExtras !== null &&
      input.desktopExtras !== undefined,
  });
}

function toComboboxOptions(options: AgentControlOption[] | undefined): ComboboxOption[] {
  return (options ?? []).map((o) => ({ id: o.id, label: o.label }));
}

function toThinkingControlOptions(options: AgentControlOption[] | undefined): AgentControlOption[] {
  return (options ?? []).map((option) => ({
    id: option.id,
    label: formatThinkingOptionLabel(option),
  }));
}

function buildFallbackModelSelectorProviders(
  provider: string,
  modelOptions: AgentControlOption[] | undefined,
): ProviderSelectorProvider[] {
  if (!modelOptions || modelOptions.length === 0) {
    return [];
  }
  return [
    {
      id: provider,
      label: provider,
      modelSelection: {
        kind: "models",
        rows: modelOptions.map((option) => ({
          favoriteKey: buildFavoriteModelKey({ provider, modelId: option.id }),
          provider,
          agentProvider: provider,
          runtimeProvider: provider,
          providerLabel: provider,
          modelId: option.id,
          modelLabel: option.label,
        })),
      },
    },
  ];
}

function pickSheetModel({
  selection,
  currentProvider,
  onSelectProviderAndModel,
  onSelectProvider,
  onSelectModel,
}: {
  selection: ProviderModelSelectionValue;
  currentProvider: string;
  onSelectProviderAndModel?: (provider: string, modelId: string, runtimeProvider?: string) => void;
  onSelectProvider?: (providerId: string) => void;
  onSelectModel?: (modelId: string) => void;
}) {
  if (onSelectProviderAndModel) {
    onSelectProviderAndModel(selection.agentProvider, selection.modelId, selection.runtimeProvider);
    return;
  }
  if (selection.agentProvider !== currentProvider) {
    onSelectProvider?.(selection.agentProvider);
  }
  onSelectModel?.(selection.modelId);
}

function pickDesktopModel({
  selection,
  currentProvider,
  onSelectProviderAndModel,
  onSelectModel,
}: {
  selection: ProviderModelSelectionValue;
  currentProvider: string;
  onSelectProviderAndModel?: (provider: string, modelId: string, runtimeProvider?: string) => void;
  onSelectModel?: (modelId: string) => void;
}) {
  if (selection.agentProvider === currentProvider) {
    if (onSelectProviderAndModel) {
      onSelectProviderAndModel(
        selection.agentProvider,
        selection.modelId,
        selection.runtimeProvider,
      );
      return;
    }
    onSelectModel?.(selection.modelId);
  }
}

function resolveProviderIcon(provider: string) {
  if (provider.trim().length === 0) {
    return null;
  }
  return getProviderIcon(provider);
}

type AgentControlsSlice = {
  provider: string;
  runtimeProvider: string | null;
  cwd: string | null;
  runtimeModelId: string | null;
  model: string | null | undefined;
  features: AgentFeature[] | undefined;
  thinkingOptionId: string | null | undefined;
  lastUsage: unknown;
} | null;
function selectAgentControlsSlice(
  state: ReturnType<typeof useSessionStore.getState>,
  serverId: string,
  agentId: string,
): AgentControlsSlice {
  const currentAgent = state.sessions[serverId]?.agents?.get(agentId) ?? null;
  if (!currentAgent) {
    return null;
  }
  return {
    provider: currentAgent.provider,
    runtimeProvider: currentAgent.runtimeInfo?.provider ?? null,
    cwd: currentAgent.cwd,
    runtimeModelId: currentAgent.runtimeInfo?.model ?? null,
    model: currentAgent.model,
    features: currentAgent.features,
    thinkingOptionId: currentAgent.thinkingOptionId,
    lastUsage: currentAgent.lastUsage,
  };
}

function buildOpenChangeHandler(
  selector: AgentControlSelector,
  setOpenSelector: (next: AgentControlSelector | null) => void,
  onDropdownClose?: () => void,
) {
  return (nextOpen: boolean) => {
    setOpenSelector(nextOpen ? selector : null);
    if (!nextOpen) {
      onDropdownClose?.();
    }
  };
}

function ControlledAgentControls({
  provider,
  providerOptions,
  selectedProviderId,
  onSelectProvider,
  modelOptions,
  selectedModelId,
  selectedRuntimeProviderId,
  onSelectModel,
  onSelectProviderAndModel,
  thinkingOptions,
  selectedThinkingOptionId,
  onSelectThinkingOption,
  disabled = false,
  isModelLoading = false,
  modelSelectorProviders,
  favoriteKeys = new Set<string>(),
  onToggleFavoriteModel,
  features,
  onSetFeature,
  onDropdownClose,
  onModelSelectorOpen,
  onRetryModelProvider,
  isRetryingModelProvider = false,
  desktopExtras,
  compactExtras,
  modelSelectorServerId = null,
  desktopSegment = "full",
}: ControlledAgentControlsProps) {
  const { t } = useTranslation();
  const isCompact = useIsCompactFormFactor();
  const [activeSheet, setActiveSheet] = useState<ActiveAgentControlSheet>(null);
  const [openSelector, setOpenSelector] = useState<AgentControlSelector | null>(null);

  const providerAnchorRef = useRef<View>(null);
  const thinkingAnchorRef = useRef<View>(null);
  const { showDesktopModelCluster, showDesktopModeCluster } =
    resolveDesktopSegmentVisibility(desktopSegment);

  const canSelectProvider = Boolean(
    onSelectProvider && providerOptions && providerOptions.length > 0,
  );
  const canSelectModel = Boolean(onSelectModel);
  const canSelectThinking = Boolean(
    onSelectThinkingOption && thinkingOptions && thinkingOptions.length > 0,
  );

  const displayProvider = findOptionLabel(
    providerOptions,
    selectedProviderId,
    t("composer.controls.provider"),
  );
  const formattedThinkingOptions = useMemo(
    () => toThinkingControlOptions(thinkingOptions),
    [thinkingOptions],
  );
  const displayThinking = findOptionLabel(
    formattedThinkingOptions,
    selectedThinkingOptionId,
    formattedThinkingOptions[0]?.label ?? t("composer.controls.unknown"),
  );

  const ProviderIcon = resolveProviderIcon(provider);

  const hasAnyControl = resolveSegmentedHasAnyControl({
    isCompact,
    showDesktopModelCluster,
    showDesktopModeCluster,
    providerOptions,
    canSelectModel,
    thinkingOptions,
    features,
    desktopExtras,
  });

  const modelDisabled = disabled;

  const comboboxProviderOptions = useMemo<ComboboxOption[]>(
    () => toComboboxOptions(providerOptions),
    [providerOptions],
  );
  const fallbackModelSelectorProviders = useMemo(
    () => buildFallbackModelSelectorProviders(provider, modelOptions),
    [modelOptions, provider],
  );
  const effectiveModelSelectorProviders = modelSelectorProviders ?? fallbackModelSelectorProviders;
  const comboboxThinkingOptions = useMemo<ComboboxOption[]>(
    () => toComboboxOptions(formattedThinkingOptions),
    [formattedThinkingOptions],
  );

  const handleOpenChange = useCallback(
    (selector: AgentControlSelector) =>
      buildOpenChangeHandler(selector, setOpenSelector, onDropdownClose),
    [onDropdownClose],
  );

  const handleProviderPress = useCallback(() => {
    handleOpenChange("provider")(openSelector !== "provider");
  }, [handleOpenChange, openSelector]);

  const handleThinkingPress = useCallback(() => {
    handleOpenChange("thinking")(openSelector !== "thinking");
  }, [handleOpenChange, openSelector]);

  const handleProviderOpenChange = useMemo(() => handleOpenChange("provider"), [handleOpenChange]);
  const handleThinkingOpenChange = useMemo(() => handleOpenChange("thinking"), [handleOpenChange]);

  const handleProviderSelect = useCallback(
    (id: string) => onSelectProvider?.(id),
    [onSelectProvider],
  );
  const handleThinkingSelect = useCallback(
    (id: string) => onSelectThinkingOption?.(id),
    [onSelectThinkingOption],
  );

  const handleDesktopModelSelect = useCallback(
    (selection: ProviderModelSelectionValue) => {
      pickDesktopModel({
        selection,
        currentProvider: provider,
        onSelectProviderAndModel,
        onSelectModel,
      });
    },
    [onSelectModel, onSelectProviderAndModel, provider],
  );

  const handleOpenSheet = useCallback((sheet: Exclude<ActiveAgentControlSheet, null>) => {
    Keyboard.dismiss();
    setActiveSheet(sheet);
  }, []);

  const handleCloseSheet = useCallback(() => {
    setActiveSheet(null);
  }, []);

  const handleSelectThinkingAndClose = useCallback(
    (thinkingOptionId: string) => {
      onSelectThinkingOption?.(thinkingOptionId);
      setActiveSheet(null);
    },
    [onSelectThinkingOption],
  );

  const handleSheetModelSelect = useCallback(
    (selection: ProviderModelSelectionValue) => {
      pickSheetModel({
        selection,
        currentProvider: provider,
        onSelectProviderAndModel,
        onSelectProvider,
        onSelectModel,
      });
    },
    [onSelectModel, onSelectProvider, onSelectProviderAndModel, provider],
  );

  const containerStyle = useMemo(
    () => [styles.container, isCompact && styles.compactContainer],
    [isCompact],
  );

  if (!hasAnyControl) {
    return null;
  }

  return (
    <View style={containerStyle}>
      {!isCompact ? (
        <DesktopAgentControlsContent
          provider={provider}
          providerOptions={providerOptions}
          selectedProviderId={selectedProviderId}
          selectedModelId={selectedModelId}
          selectedRuntimeProviderId={selectedRuntimeProviderId}
          thinkingOptions={formattedThinkingOptions}
          selectedThinkingOptionId={selectedThinkingOptionId}
          onToggleFavoriteModel={onToggleFavoriteModel}
          onDropdownClose={onDropdownClose}
          onModelSelectorOpen={onModelSelectorOpen}
          onRetryModelProvider={onRetryModelProvider}
          isRetryingModelProvider={isRetryingModelProvider}
          favoriteKeys={favoriteKeys}
          disabled={disabled}
          isModelLoading={isModelLoading}
          canSelectProvider={canSelectProvider}
          canSelectModel={canSelectModel}
          canSelectThinking={canSelectThinking}
          modelSelectorProviders={effectiveModelSelectorProviders}
          modelDisabled={modelDisabled}
          comboboxProviderOptions={comboboxProviderOptions}
          comboboxThinkingOptions={comboboxThinkingOptions}
          displayProvider={displayProvider}
          displayThinking={displayThinking}
          selectProviderLabel={t("providers.title")}
          selectThinkingLabel={t("composer.controls.selectThinkingWithValue", {
            value: displayThinking,
          })}
          openSelector={openSelector}
          providerAnchorRef={providerAnchorRef}
          thinkingAnchorRef={thinkingAnchorRef}
          handleProviderPress={handleProviderPress}
          handleThinkingPress={handleThinkingPress}
          handleProviderSelect={handleProviderSelect}
          handleThinkingSelect={handleThinkingSelect}
          handleDesktopModelSelect={handleDesktopModelSelect}
          handleProviderOpenChange={handleProviderOpenChange}
          handleThinkingOpenChange={handleThinkingOpenChange}
          extras={showDesktopModeCluster ? desktopExtras : undefined}
          modelSelectorServerId={modelSelectorServerId}
          showModelCluster={showDesktopModelCluster}
        />
      ) : (
        <>
          <SheetAgentControlsContent
            provider={provider}
            selectedModelId={selectedModelId}
            selectedThinkingOptionId={selectedThinkingOptionId}
            features={features}
            onSetFeature={onSetFeature}
            onToggleFavoriteModel={onToggleFavoriteModel}
            onDropdownClose={onDropdownClose}
            onModelSelectorOpen={onModelSelectorOpen}
            onRetryModelProvider={onRetryModelProvider}
            isRetryingModelProvider={isRetryingModelProvider}
            favoriteKeys={favoriteKeys}
            disabled={disabled}
            isModelLoading={isModelLoading}
            canSelectModel={canSelectModel}
            canSelectThinking={canSelectThinking}
            modelSelectorProviders={effectiveModelSelectorProviders}
            modelDisabled={modelDisabled}
            comboboxThinkingOptions={comboboxThinkingOptions}
            selectedRuntimeProviderId={selectedRuntimeProviderId}
            openSelector={openSelector}
            ProviderIcon={ProviderIcon}
            selectThinkingLabel={t("composer.controls.selectThinking")}
            thinkingTitle={t("composer.controls.thinking")}
            featuresTitle={t("composer.controls.features")}
            openFeaturesLabel={t("composer.controls.openFeatures")}
            activeSheet={activeSheet}
            handleOpenSheet={handleOpenSheet}
            handleCloseSheet={handleCloseSheet}
            handleSheetModelSelect={handleSheetModelSelect}
            handleSelectThinkingAndClose={handleSelectThinkingAndClose}
            handleOpenChange={handleOpenChange}
            modelSelectorServerId={modelSelectorServerId}
          />
          {compactExtras}
        </>
      )}
    </View>
  );
}

export const AgentControls = memo(function AgentControls({
  agentId,
  serverId,
  onDropdownClose,
  slot = "all",
}: AgentControlsProps) {
  const { t } = useTranslation();
  const { preferences, updatePreferences } = useFormPreferences();
  const agent = useSessionStore(
    useShallow((state) => selectAgentControlsSlice(state, serverId, agentId)),
  );
  const client = useSessionStore((state) => state.sessions[serverId]?.client ?? null);
  const toast = useToast();

  const {
    entries: snapshotEntries,
    isLoading: snapshotIsLoading,
    isRefreshing: snapshotIsRefreshing,
    refresh: refreshSnapshot,
    refetchIfStale: refetchSnapshotIfStale,
  } = useProvidersSnapshot(serverId, { cwd: agent?.cwd });

  const {
    agentProvider,
    agentRuntimeProvider,
    agentModelSelectorProviders,
    modelOptions,
    modelSelection,
    selectedProviderIsLoading,
    thinkingOptions,
  } = useRunningAgentModelControls({
    agent,
    snapshotEntries,
    defaultModelLabel: t("modelSelector.defaultModel"),
    unavailable: t("modelSelector.unavailable"),
    unknownError: t("modelSelector.unknownError"),
  });

  const favoriteKeys = useMemo(
    () =>
      new Set(
        (preferences.favoriteModels ?? []).map((favorite) => buildFavoriteModelKey(favorite)),
      ),
    [preferences.favoriteModels],
  );
  const activeModelId = modelSelection.activeModelId;
  const modelLoadingState = resolveProviderSnapshotLoadingState({
    snapshotIsLoading,
    snapshotEntries,
    selectedProviderIsLoading,
  });

  const handleSelectModel = useCallback(
    (modelId: string) => {
      if (!client || !agentProvider) {
        return;
      }
      void updatePreferences((current) =>
        mergeProviderPreferences({
          preferences: current,
          provider: agentProvider,
          updates: {
            model: modelId,
          },
        }),
      ).catch((error) => {
        console.warn("[AgentControls] persist model preference failed", error);
      });
      void client.setAgentModel(agentId, modelId).catch((error) => {
        console.warn("[AgentControls] setAgentModel failed", error);
        toast.error(toErrorMessage(error));
      });
    },
    [agentId, agentProvider, client, toast, updatePreferences],
  );

  const handleSelectProviderAndModel = useCallback(
    (provider: string, modelId: string, runtimeProvider?: string) => {
      if (!client || !agentProvider || provider !== agentProvider) {
        return;
      }
      void updatePreferences((current) =>
        mergeProviderPreferences({
          preferences: current,
          provider,
          updates: {
            model: modelId,
            runtimeProviderByModel: runtimeProvider
              ? {
                  [modelId]: runtimeProvider,
                }
              : undefined,
          },
        }),
      ).catch((error) => {
        console.warn("[AgentControls] persist model preference failed", error);
      });
      void client.setAgentModel(agentId, modelId, runtimeProvider).catch((error) => {
        console.warn("[AgentControls] setAgentModel failed", error);
        toast.error(toErrorMessage(error));
      });
    },
    [agentId, agentProvider, client, toast, updatePreferences],
  );

  const handleToggleFavoriteModel = useCallback(
    (provider: string, modelId: string) => {
      void updatePreferences((current) =>
        toggleFavoriteModel({ preferences: current, provider, modelId }),
      ).catch((error) => {
        console.warn("[AgentControls] toggle favorite model failed", error);
      });
    },
    [updatePreferences],
  );

  const handleSelectThinkingOption = useCallback(
    (thinkingOptionId: string) => {
      if (!client || !agentProvider) {
        return;
      }
      if (activeModelId) {
        void updatePreferences((current) =>
          mergeProviderPreferences({
            preferences: current,
            provider: agentProvider,
            updates: {
              model: activeModelId,
              thinkingByModel: {
                [activeModelId]: thinkingOptionId,
              },
            },
          }),
        ).catch((error) => {
          console.warn("[AgentControls] persist thinking preference failed", error);
        });
      }
      void client.setAgentThinkingOption(agentId, thinkingOptionId).catch((error) => {
        console.warn("[AgentControls] setAgentThinkingOption failed", error);
        toast.error(toErrorMessage(error));
      });
    },
    [activeModelId, agentId, agentProvider, client, toast, updatePreferences],
  );

  const handleSetFeature = useCallback(
    (featureId: string, value: unknown) => {
      if (!client || !agentProvider) {
        return;
      }
      void updatePreferences((current) =>
        mergeProviderPreferences({
          preferences: current,
          provider: agentProvider,
          updates: {
            featureValues: {
              [featureId]: value,
            },
          },
        }),
      ).catch((error) => {
        console.warn("[AgentControls] persist feature preference failed", error);
      });
      void client.setAgentFeature(agentId, featureId, value).catch((error) => {
        console.warn("[AgentControls] setAgentFeature failed", error);
        toast.error(toErrorMessage(error));
      });
    },
    [agentId, agentProvider, client, toast, updatePreferences],
  );

  const handleModelSelectorOpen = useCallback(() => {
    refetchSnapshotIfStale();
  }, [refetchSnapshotIfStale]);

  const handleRetryModelProvider = useCallback(
    (provider: AgentProvider) => {
      void refreshSnapshot([provider]);
    },
    [refreshSnapshot],
  );

  const modeChip = useMemo(
    () => <AgentModeControl serverId={serverId} agentId={agentId} placement="toolbar" />,
    [serverId, agentId],
  );

  if (!agent) {
    return null;
  }

  // Soft desktop cbar: left = mode, right = model cluster. Compact keeps a single row.
  if (slot === "mode") {
    return modeChip;
  }

  return (
    <ControlledAgentControls
      provider={agent.provider}
      modelSelectorProviders={agentModelSelectorProviders}
      modelOptions={modelOptions}
      selectedModelId={modelSelection.activeModelId ?? undefined}
      selectedRuntimeProviderId={agentRuntimeProvider}
      onSelectModel={handleSelectModel}
      onSelectProviderAndModel={handleSelectProviderAndModel}
      favoriteKeys={favoriteKeys}
      onToggleFavoriteModel={handleToggleFavoriteModel}
      thinkingOptions={thinkingOptions.length > 0 ? thinkingOptions : undefined}
      selectedThinkingOptionId={modelSelection.selectedThinkingId ?? undefined}
      onSelectThinkingOption={handleSelectThinkingOption}
      features={agent.features}
      onSetFeature={handleSetFeature}
      isModelLoading={modelLoadingState.isModelLoading}
      onModelSelectorOpen={handleModelSelectorOpen}
      onRetryModelProvider={handleRetryModelProvider}
      isRetryingModelProvider={snapshotIsRefreshing}
      onDropdownClose={onDropdownClose}
      disabled={!client}
      desktopExtras={slot === "all" ? modeChip : undefined}
      desktopSegment={slot === "model" ? "model" : "full"}
      modelSelectorServerId={serverId}
    />
  );
});

export function DraftAgentControls({
  providerDefinitions,
  selectedProvider,
  onSelectProvider: _onSelectProvider,
  modeOptions,
  selectedMode,
  onSelectMode,
  models,
  selectedModel,
  selectedRuntimeProvider,
  onSelectModel,
  isModelLoading,
  modelSelectorProviders,
  isAllModelsLoading,
  onSelectProviderAndModel,
  thinkingOptions,
  selectedThinkingOptionId,
  onSelectThinkingOption,
  features,
  onSetFeature,
  onDropdownClose,
  onModelSelectorOpen,
  onRetryModelProvider,
  isRetryingModelProvider = false,
  disabled = false,
  modelSelectorServerId = null,
  slot = "all",
}: DraftAgentControlsProps) {
  const { preferences, updatePreferences } = useFormPreferences();
  const isCompact = useIsCompactFormFactor();

  const mappedThinkingOptions = useMemo<AgentControlOption[]>(() => {
    return toThinkingControlOptions(thinkingOptions);
  }, [thinkingOptions]);
  const favoriteKeys = useMemo(
    () =>
      new Set(
        (preferences.favoriteModels ?? []).map((favorite) => buildFavoriteModelKey(favorite)),
      ),
    [preferences.favoriteModels],
  );

  const effectiveSelectedThinkingOption =
    selectedThinkingOptionId || mappedThinkingOptions[0]?.id || undefined;

  const modelOptions = useMemo<AgentControlOption[]>(
    () =>
      models.map((model) => ({
        id: model.id,
        label: model.label,
      })),
    [models],
  );

  const handleToggleFavorite = useCallback(
    (provider: string, modelId: string) => {
      void updatePreferences((current) =>
        toggleFavoriteModel({ preferences: current, provider, modelId }),
      ).catch((error) => {
        console.warn("[DraftAgentControls] toggle favorite model failed", error);
      });
    },
    [updatePreferences],
  );
  const handleSelectProviderAndModel = useCallback(
    (selection: ProviderModelSelectionValue) => {
      onSelectProviderAndModel(
        selection.agentProvider,
        selection.modelId,
        selection.runtimeProvider,
      );
    },
    [onSelectProviderAndModel],
  );

  const draftModeChip = useMemo(
    () => (
      <DraftAgentModeControl
        placement="toolbar"
        selectedProvider={selectedProvider}
        providerDefinitions={providerDefinitions}
        modeOptions={modeOptions}
        selectedMode={selectedMode}
        onSelectMode={onSelectMode}
        disabled={disabled}
      />
    ),
    [selectedProvider, providerDefinitions, modeOptions, selectedMode, onSelectMode, disabled],
  );
  const modelSelectorLoading = resolveDraftModelSelectorLoading({
    isAllModelsLoading,
    isModelLoading,
    selectedProviderId: selectedProvider,
    selectedModelId: selectedModel,
  });

  // Soft desktop cbar: left = mode, right = model cluster.
  if (!isCompact && slot === "mode") {
    return draftModeChip;
  }

  if (!isCompact) {
    const modelCluster = (
      <>
        <CombinedModelSelector
          providers={modelSelectorProviders}
          selectedProvider={selectedProvider ?? ""}
          selectedRuntimeProvider={selectedRuntimeProvider}
          selectedModel={selectedModel}
          onSelect={handleSelectProviderAndModel}
          favoriteKeys={favoriteKeys}
          onToggleFavorite={handleToggleFavorite}
          isLoading={modelSelectorLoading}
          disabled={disabled}
          onOpen={onModelSelectorOpen}
          onClose={onDropdownClose}
          onRetryProvider={onRetryModelProvider}
          isRetryingProvider={isRetryingModelProvider}
          serverId={modelSelectorServerId}
        />
        {selectedProvider ? (
          <ControlledAgentControls
            provider={selectedProvider}
            thinkingOptions={mappedThinkingOptions.length > 0 ? mappedThinkingOptions : undefined}
            selectedThinkingOptionId={effectiveSelectedThinkingOption}
            onSelectThinkingOption={onSelectThinkingOption}
            features={features}
            onSetFeature={onSetFeature}
            onDropdownClose={onDropdownClose}
            onRetryModelProvider={onRetryModelProvider}
            isRetryingModelProvider={isRetryingModelProvider}
            disabled={disabled}
            desktopSegment="model"
          />
        ) : null}
      </>
    );

    if (slot === "model") {
      return <View style={styles.container}>{modelCluster}</View>;
    }

    return (
      <View style={styles.container}>
        {modelCluster}
        {draftModeChip}
      </View>
    );
  }

  return (
    <ControlledAgentControls
      provider={selectedProvider ?? ""}
      modelSelectorProviders={modelSelectorProviders}
      modelOptions={modelOptions}
      selectedModelId={selectedModel}
      selectedRuntimeProviderId={selectedRuntimeProvider}
      onSelectModel={onSelectModel}
      onSelectProviderAndModel={onSelectProviderAndModel}
      isModelLoading={modelSelectorLoading}
      favoriteKeys={favoriteKeys}
      onToggleFavoriteModel={handleToggleFavorite}
      thinkingOptions={mappedThinkingOptions.length > 0 ? mappedThinkingOptions : undefined}
      selectedThinkingOptionId={effectiveSelectedThinkingOption}
      onSelectThinkingOption={onSelectThinkingOption}
      features={features}
      onSetFeature={onSetFeature}
      onModelSelectorOpen={onModelSelectorOpen}
      onRetryModelProvider={onRetryModelProvider}
      isRetryingModelProvider={isRetryingModelProvider}
      disabled={disabled}
      modelSelectorServerId={modelSelectorServerId}
    />
  );
}
