import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { AgentProviderDefinition } from "@chisacode/protocol/provider-manifest";
import type {
  AgentMode,
  AgentModelDefinition,
  AgentProvider,
  ProviderSnapshotEntry,
} from "@chisacode/protocol/agent-types";
import { useHosts } from "@/runtime/host-runtime";
import { buildProviderDefinitions } from "@/utils/provider-definitions";
import {
  buildSelectableProviderSelectorProviders,
  type ProviderSelectorProvider,
} from "@/provider-selection/provider-selection";
import { useProvidersSnapshot } from "./use-providers-snapshot";
import {
  useFormPreferences,
  mergeProviderPreferences,
  type FormPreferences,
} from "./use-form-preferences";
import {
  resolveAgentForm,
  resolveEffectiveModel,
  normalizeSelectedModelId,
  resolveDefaultModelId,
  mergeSelectedComposerPreferences,
  combineInitialValues,
  buildProviderDefinitionMap,
  buildProviderDefinitionMapForStatuses,
  INITIAL_USER_MODIFIED,
  RESOLVABLE_PROVIDER_STATUSES,
  SELECTABLE_PROVIDER_STATUSES,
  type FormInitialValues,
  type FormState,
} from "@/provider-selection/resolve-agent-form";
import {
  isProviderEntryLoading,
  resolveProviderSnapshotLoadingState,
} from "@/provider-selection/provider-snapshot-loading";
import { resolveProviderSnapshotModels } from "@/provider-selection/provider-snapshot-models";

export type { FormInitialValues } from "@/provider-selection/resolve-agent-form";

export interface UseAgentFormStateOptions {
  initialServerId?: string | null;
  initialValues?: FormInitialValues;
  isVisible?: boolean;
  isCreateFlow?: boolean;
  isTargetDaemonReady?: boolean;
  onlineServerIds?: string[];
}

export interface UseAgentFormStateResult {
  selectedServerId: string | null;
  setSelectedServerId: (value: string | null) => void;
  setSelectedServerIdFromUser: (value: string | null) => void;
  selectedProvider: AgentProvider | null;
  selectedRuntimeProvider: AgentProvider | null;
  setProviderFromUser: (provider: AgentProvider) => void;
  selectedMode: string;
  setModeFromUser: (modeId: string) => void;
  selectedModel: string;
  setModelFromUser: (modelId: string, runtimeProvider?: AgentProvider | null) => void;
  selectedThinkingOptionId: string;
  setThinkingOptionFromUser: (thinkingOptionId: string) => void;
  workingDir: string;
  setWorkingDir: (value: string) => void;
  setWorkingDirFromUser: (value: string) => void;
  providerDefinitions: AgentProviderDefinition[];
  providerDefinitionMap: Map<AgentProvider, AgentProviderDefinition>;
  agentDefinition?: AgentProviderDefinition;
  allProviderEntries?: ProviderSnapshotEntry[];
  modeOptions: AgentMode[];
  availableModels: AgentModelDefinition[];
  allProviderModels: Map<string, AgentModelDefinition[]>;
  modelSelectorProviders: ProviderSelectorProvider[];
  isAllModelsLoading: boolean;
  isProviderModelsRefreshing: boolean;
  availableThinkingOptions: NonNullable<AgentModelDefinition["thinkingOptions"]>;
  isModelLoading: boolean;
  modelError: string | null;
  refreshProviderModels: (provider?: AgentProvider) => void;
  refetchProviderModelsIfStale: () => void;
  setProviderAndModelFromUser: (
    provider: AgentProvider,
    modelId: string,
    runtimeProvider?: AgentProvider | null,
  ) => void;
  workingDirIsEmpty: boolean;
  persistFormPreferences: () => Promise<void>;
}

function shouldAutoSelectServerId(input: {
  isVisible: boolean;
  isCreateFlow: boolean;
  isPreferencesLoading: boolean;
  hasResolved: boolean;
  userModifiedServerId: boolean;
  initialServerId: string | null | undefined;
  currentServerId: string | null;
}): boolean {
  const {
    isVisible,
    isCreateFlow,
    isPreferencesLoading,
    hasResolved,
    userModifiedServerId,
    initialServerId,
    currentServerId,
  } = input;
  if (!isVisible || !isCreateFlow) return false;
  if (isPreferencesLoading) return false;
  if (!hasResolved) return false;
  if (userModifiedServerId) return false;
  if (initialServerId !== undefined) return false;
  if (currentServerId) return false;
  return true;
}

function resolveSelectedProviderModes(input: {
  selectedEntry: ProviderSnapshotEntry | null;
  provider: AgentProvider | null;
  providerDefinitionMap: Map<AgentProvider, AgentProviderDefinition>;
}): AgentMode[] {
  const { selectedEntry, provider, providerDefinitionMap } = input;
  if (selectedEntry?.modes?.length) {
    return selectedEntry.modes;
  }
  if (provider) {
    return providerDefinitionMap.get(provider)?.modes ?? [];
  }
  return [];
}

function buildAllProviderModels(
  snapshotEntries: ProviderSnapshotEntry[] | undefined,
): Map<string, AgentModelDefinition[]> {
  const map = new Map<string, AgentModelDefinition[]>();
  for (const entry of snapshotEntries ?? []) {
    map.set(entry.provider, entry.models ?? []);
  }
  return map;
}

function findProviderSnapshotEntry(
  snapshotEntries: ProviderSnapshotEntry[] | undefined,
  provider: AgentProvider | null | undefined,
): ProviderSnapshotEntry | null {
  return provider
    ? ((snapshotEntries ?? []).find((entry) => entry.provider === provider) ?? null)
    : null;
}

async function persistProviderPreferences(input: {
  provider: AgentProvider;
  runtimeProvider?: AgentProvider | null;
  formState: FormState;
  availableModels: AgentModelDefinition[] | null;
  updatePreferences: (
    updates: Partial<FormPreferences> | ((current: FormPreferences) => FormPreferences),
  ) => Promise<void>;
}): Promise<void> {
  const { provider, formState, availableModels, updatePreferences } = input;
  const resolvedModel = resolveEffectiveModel(availableModels, formState.model);
  const modelId = resolvedModel?.id ?? formState.model;
  await updatePreferences((current) =>
    mergeProviderPreferences({
      preferences: current,
      provider,
      updates: {
        model: modelId || undefined,
        mode: formState.modeId || undefined,
        ...(modelId && input.runtimeProvider && input.runtimeProvider !== input.provider
          ? { runtimeProviderByModel: { [modelId]: input.runtimeProvider } }
          : {}),
        ...(modelId && formState.thinkingOptionId
          ? { thinkingByModel: { [modelId]: formState.thinkingOptionId } }
          : {}),
      },
    }),
  );
}

export function useAgentFormState(options: UseAgentFormStateOptions = {}): UseAgentFormStateResult {
  const { t } = useTranslation();
  const {
    initialServerId = null,
    initialValues,
    isVisible = true,
    isCreateFlow = true,
    isTargetDaemonReady: _isTargetDaemonReady = true,
    onlineServerIds = [],
  } = options;

  const { preferences, isLoading: isPreferencesLoading, updatePreferences } = useFormPreferences();

  const daemons = useHosts();

  const validServerIds = useMemo(() => new Set(daemons.map((d) => d.serverId)), [daemons]);

  const [{ form: formState, userModified }, dispatch] = useReducer(
    resolveAgentForm,
    initialServerId,
    (serverId) => ({
      form: {
        serverId,
        provider: null,
        runtimeProvider: null,
        modeId: "",
        model: "",
        thinkingOptionId: "",
        workingDir: "",
      },
      userModified: INITIAL_USER_MODIFIED,
    }),
  );

  const reducerStateRef = useRef({ form: formState, userModified });
  useEffect(() => {
    reducerStateRef.current = { form: formState, userModified };
  }, [formState, userModified]);

  const hasResolvedRef = useRef(false);
  const hydrationPreferencesRef = useRef<FormPreferences | null>(null);

  useEffect(() => {
    if (!isVisible) {
      dispatch({ type: "RESET" });
      hasResolvedRef.current = false;
      hydrationPreferencesRef.current = null;
    }
  }, [isVisible]);

  const {
    entries: snapshotEntries,
    isLoading: snapshotIsLoading,
    isRefreshing: snapshotIsRefreshing,
    error: snapshotError,
    refresh: refreshSnapshot,
    refetchIfStale: refetchSnapshotIfStale,
  } = useProvidersSnapshot(formState.serverId, { cwd: formState.workingDir });

  const allProviderEntries = useMemo(() => snapshotEntries ?? [], [snapshotEntries]);
  const snapshotProviderDefinitions = useMemo(
    () => buildProviderDefinitions(snapshotEntries),
    [snapshotEntries],
  );
  const snapshotProviderDefinitionMap = useMemo(
    () => buildProviderDefinitionMap(snapshotProviderDefinitions),
    [snapshotProviderDefinitions],
  );
  const snapshotResolvableProviderDefinitionMap = useMemo(
    () =>
      buildProviderDefinitionMapForStatuses({
        snapshotEntries,
        providerDefinitions: snapshotProviderDefinitions,
        statuses: RESOLVABLE_PROVIDER_STATUSES,
      }),
    [snapshotEntries, snapshotProviderDefinitions],
  );
  const snapshotSelectableProviderDefinitionMap = useMemo(() => {
    return buildProviderDefinitionMapForStatuses({
      snapshotEntries,
      providerDefinitions: snapshotProviderDefinitions,
      statuses: SELECTABLE_PROVIDER_STATUSES,
    });
  }, [snapshotEntries, snapshotProviderDefinitions]);
  const snapshotAllProviderModels = useMemo(
    () => buildAllProviderModels(snapshotEntries),
    [snapshotEntries],
  );
  const snapshotModelSelectorProviders = useMemo(
    () =>
      buildSelectableProviderSelectorProviders(snapshotEntries, {
        defaultModelLabel: t("modelSelector.defaultModel"),
        unavailable: t("modelSelector.unavailable"),
        unknownError: t("modelSelector.unknownError"),
      }),
    [snapshotEntries, t],
  );
  const snapshotSelectedEntry = useMemo(
    () => findProviderSnapshotEntry(snapshotEntries, formState.provider),
    [formState.provider, snapshotEntries],
  );
  const snapshotRuntimeEntry = useMemo(
    () =>
      findProviderSnapshotEntry(snapshotEntries, formState.runtimeProvider ?? formState.provider),
    [formState.provider, formState.runtimeProvider, snapshotEntries],
  );
  const snapshotSelectedProviderModels = resolveProviderSnapshotModels({
    runtimeProvider: formState.runtimeProvider,
    runtimeEntry: snapshotRuntimeEntry,
    selectedEntry: snapshotSelectedEntry,
  });
  const selectedProviderIsLoading = isProviderEntryLoading({
    runtimeProvider: formState.runtimeProvider,
    runtimeEntry: snapshotRuntimeEntry,
    selectedEntry: snapshotSelectedEntry,
  });
  const snapshotSelectedProviderModes = resolveSelectedProviderModes({
    selectedEntry: snapshotSelectedEntry,
    provider: formState.provider,
    providerDefinitionMap: snapshotProviderDefinitionMap,
  });
  const providerDefinitions = snapshotProviderDefinitions;
  const providerDefinitionMap = snapshotProviderDefinitionMap;
  const selectableProviderDefinitionMap = snapshotSelectableProviderDefinitionMap;
  const allProviderModels = snapshotAllProviderModels;
  const modelSelectorProviders = snapshotModelSelectorProviders;
  const availableModels = snapshotSelectedProviderModels;
  const modeOptions = snapshotSelectedProviderModes;
  const providerSnapshotLoadingState = resolveProviderSnapshotLoadingState({
    snapshotIsLoading,
    snapshotEntries,
    selectedProviderIsLoading,
  });
  const isAllModelsLoading = providerSnapshotLoadingState.isAllModelsLoading;

  const combinedInitialValues = useMemo(
    () => combineInitialValues(initialValues, initialServerId),
    [initialValues, initialServerId],
  );

  useEffect(() => {
    if (!isVisible || !isCreateFlow) {
      return;
    }

    if (isPreferencesLoading && !hasResolvedRef.current) {
      return;
    }

    if (!hasResolvedRef.current) {
      hydrationPreferencesRef.current = preferences;
    }
    const hydrationPreferences = hydrationPreferencesRef.current ?? preferences;

    dispatch({
      type: "RESOLVE",
      initialValues: combinedInitialValues,
      preferences: hydrationPreferences,
      availableModels,
      allowedProviderMap: snapshotResolvableProviderDefinitionMap,
    });

    hasResolvedRef.current = true;
  }, [
    isVisible,
    isCreateFlow,
    isPreferencesLoading,
    combinedInitialValues,
    preferences,
    availableModels,
    snapshotResolvableProviderDefinitionMap,
  ]);

  const onlineServerIdsKey = onlineServerIds.join("|");
  useEffect(() => {
    const canAutoSelectServerId = shouldAutoSelectServerId({
      isVisible,
      isCreateFlow,
      isPreferencesLoading,
      hasResolved: hasResolvedRef.current,
      userModifiedServerId: userModified.serverId,
      initialServerId: combinedInitialValues?.serverId,
      currentServerId: reducerStateRef.current.form.serverId,
    });
    if (!canAutoSelectServerId) return;

    const candidate = onlineServerIds.find((id) => validServerIds.has(id)) ?? null;
    if (!candidate) return;

    dispatch({ type: "AUTO_SELECT_SERVER", candidateServerId: candidate });
  }, [
    combinedInitialValues?.serverId,
    isCreateFlow,
    isPreferencesLoading,
    isVisible,
    onlineServerIds,
    onlineServerIdsKey,
    userModified.serverId,
    validServerIds,
  ]);

  const setSelectedServerIdFromUser = useCallback((value: string | null) => {
    dispatch({ type: "SET_SERVER_ID_FROM_USER", value });
  }, []);

  const setProviderFromUser = useCallback(
    (provider: AgentProvider) => {
      if (!selectableProviderDefinitionMap.has(provider)) {
        return;
      }
      const providerModels = allProviderModels.get(provider) ?? null;
      const providerDef = selectableProviderDefinitionMap.get(provider);
      const providerPrefs = preferences?.providerPreferences?.[provider];

      dispatch({
        type: "SET_PROVIDER_FROM_USER",
        provider,
        providerModels,
        providerDef,
        providerPrefs,
      });
      void updatePreferences({ provider });
    },
    [
      allProviderModels,
      preferences?.providerPreferences,
      selectableProviderDefinitionMap,
      updatePreferences,
    ],
  );

  const setProviderAndModelFromUser = useCallback(
    (provider: AgentProvider, modelId: string, runtimeProvider?: AgentProvider | null) => {
      if (!selectableProviderDefinitionMap.has(provider)) {
        return;
      }
      const selectedRuntimeProvider = runtimeProvider || provider;
      const providerDef = selectableProviderDefinitionMap.get(provider);
      const providerModels = allProviderModels.get(selectedRuntimeProvider) ?? null;
      const providerPrefs = preferences?.providerPreferences?.[provider];
      const normalizedModelId = normalizeSelectedModelId(modelId);
      const nextModelId = normalizedModelId || resolveDefaultModelId(providerModels);

      dispatch({
        type: "SET_PROVIDER_AND_MODEL_FROM_USER",
        provider,
        runtimeProvider: selectedRuntimeProvider,
        modelId,
        providerDef,
        providerModels,
        providerPrefs,
      });
      void updatePreferences((current) =>
        mergeSelectedComposerPreferences({
          preferences: current,
          provider,
          updates: {
            model: nextModelId || undefined,
            ...(nextModelId && selectedRuntimeProvider !== provider
              ? { runtimeProviderByModel: { [nextModelId]: selectedRuntimeProvider } }
              : {}),
          },
        }),
      );
    },
    [
      allProviderModels,
      preferences?.providerPreferences,
      selectableProviderDefinitionMap,
      updatePreferences,
    ],
  );

  const setModeFromUser = useCallback(
    (modeId: string) => {
      dispatch({ type: "SET_MODE_FROM_USER", modeId });
      const provider = reducerStateRef.current.form.provider;
      if (provider) {
        void updatePreferences((current) =>
          mergeSelectedComposerPreferences({
            preferences: current,
            provider,
            updates: {
              mode: modeId || undefined,
            },
          }),
        );
      }
    },
    [updatePreferences],
  );

  const setModelFromUser = useCallback(
    (modelId: string, runtimeProvider?: AgentProvider | null) => {
      const selectedRuntimeProvider =
        runtimeProvider ?? reducerStateRef.current.form.runtimeProvider;
      const providerModels =
        selectedRuntimeProvider && allProviderModels.has(selectedRuntimeProvider)
          ? (allProviderModels.get(selectedRuntimeProvider) ?? null)
          : availableModels;
      dispatch({
        type: "SET_MODEL_FROM_USER",
        modelId,
        runtimeProvider: selectedRuntimeProvider,
        availableModels: providerModels,
      });
      const provider = reducerStateRef.current.form.provider;
      if (provider) {
        const normalizedModelId = normalizeSelectedModelId(modelId);
        const nextModelId = normalizedModelId || resolveDefaultModelId(providerModels);
        void updatePreferences((current) =>
          mergeSelectedComposerPreferences({
            preferences: current,
            provider,
            updates: {
              model: nextModelId || undefined,
              ...(nextModelId && selectedRuntimeProvider && selectedRuntimeProvider !== provider
                ? { runtimeProviderByModel: { [nextModelId]: selectedRuntimeProvider } }
                : {}),
            },
          }),
        );
      }
    },
    [allProviderModels, availableModels, updatePreferences],
  );

  const setThinkingOptionFromUser = useCallback(
    (thinkingOptionId: string) => {
      dispatch({ type: "SET_THINKING_OPTION_FROM_USER", thinkingOptionId });
      const { provider, model: modelId } = reducerStateRef.current.form;
      if (provider && modelId) {
        void updatePreferences((current) =>
          mergeSelectedComposerPreferences({
            preferences: current,
            provider,
            updates: {
              thinkingByModel: {
                [modelId]: thinkingOptionId,
              },
            },
          }),
        );
      }
    },
    [updatePreferences],
  );

  const setWorkingDir = useCallback((value: string) => {
    dispatch({ type: "SET_WORKING_DIR", value });
  }, []);

  const setWorkingDirFromUser = useCallback((value: string) => {
    dispatch({ type: "SET_WORKING_DIR_FROM_USER", value });
  }, []);

  const setSelectedServerId = useCallback((value: string | null) => {
    dispatch({ type: "SET_SERVER_ID", value });
  }, []);

  const refreshProviderModels = useCallback(
    (provider?: AgentProvider) => {
      void refreshSnapshot(provider ? [provider] : undefined);
    },
    [refreshSnapshot],
  );

  const refetchProviderModelsIfStale = useCallback(() => {
    refetchSnapshotIfStale();
  }, [refetchSnapshotIfStale]);

  const persistFormPreferences = useCallback(async () => {
    if (!formState.provider) {
      return;
    }
    await persistProviderPreferences({
      provider: formState.provider,
      runtimeProvider: formState.runtimeProvider,
      formState,
      availableModels,
      updatePreferences,
    });
  }, [availableModels, formState, updatePreferences]);

  const agentDefinition = formState.provider
    ? providerDefinitionMap.get(formState.provider)
    : undefined;
  const effectiveModel = resolveEffectiveModel(availableModels, formState.model);
  const resolvedModelId = effectiveModel?.id ?? formState.model;
  const availableThinkingOptionsRaw = effectiveModel?.thinkingOptions;
  const availableThinkingOptions = useMemo(
    () => availableThinkingOptionsRaw ?? [],
    [availableThinkingOptionsRaw],
  );
  const isModelLoading = providerSnapshotLoadingState.isModelLoading;
  const modelError = snapshotError;

  const workingDirIsEmpty = !formState.workingDir.trim();

  return useMemo(
    () => ({
      selectedServerId: formState.serverId,
      setSelectedServerId,
      setSelectedServerIdFromUser,
      selectedProvider: formState.provider,
      selectedRuntimeProvider: formState.runtimeProvider,
      setProviderFromUser,
      selectedMode: formState.modeId,
      setModeFromUser,
      selectedModel: resolvedModelId,
      setModelFromUser,
      selectedThinkingOptionId: formState.thinkingOptionId,
      setThinkingOptionFromUser,
      workingDir: formState.workingDir,
      setWorkingDir,
      setWorkingDirFromUser,
      providerDefinitions,
      providerDefinitionMap,
      agentDefinition,
      allProviderEntries,
      modeOptions,
      availableModels: availableModels ?? [],
      allProviderModels,
      modelSelectorProviders,
      isAllModelsLoading,
      isProviderModelsRefreshing: snapshotIsRefreshing,
      availableThinkingOptions,
      isModelLoading,
      modelError,
      refreshProviderModels,
      refetchProviderModelsIfStale,
      setProviderAndModelFromUser,
      workingDirIsEmpty,
      persistFormPreferences,
    }),
    [
      formState.serverId,
      formState.provider,
      formState.runtimeProvider,
      formState.modeId,
      resolvedModelId,
      formState.thinkingOptionId,
      formState.workingDir,
      setSelectedServerId,
      setSelectedServerIdFromUser,
      setProviderFromUser,
      setModeFromUser,
      setModelFromUser,
      setThinkingOptionFromUser,
      setWorkingDir,
      setWorkingDirFromUser,
      providerDefinitions,
      providerDefinitionMap,
      agentDefinition,
      allProviderEntries,
      modeOptions,
      availableModels,
      allProviderModels,
      modelSelectorProviders,
      isAllModelsLoading,
      snapshotIsRefreshing,
      availableThinkingOptions,
      isModelLoading,
      modelError,
      refreshProviderModels,
      refetchProviderModelsIfStale,
      setProviderAndModelFromUser,
      workingDirIsEmpty,
      persistFormPreferences,
    ],
  );
}

export type CreateAgentInitialValues = FormInitialValues;
