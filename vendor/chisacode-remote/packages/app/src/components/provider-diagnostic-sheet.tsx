import { AlertTriangle, Copy, FileText, Plus, RotateCw, Trash2 } from "lucide-react-native";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  type PressableStateCallbackType,
  ScrollView,
  Text,
  View,
} from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import {
  AdaptiveModalSheet,
  AdaptiveTextInput,
  type SheetHeader,
} from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import * as Clipboard from "expo-clipboard";
import { isWeb } from "@/constants/platform";
import { Fonts } from "@/constants/theme";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { useProvidersSnapshot } from "@/hooks/use-providers-snapshot";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { settingsStyles } from "@/styles/settings";
import { resolveProviderLabel } from "@/utils/provider-definitions";
import { formatTimeAgo } from "@/utils/time";
import { compareMatchScores, scoreTextFields } from "@/utils/score-match";
import {
  buildAddCustomModelToProviderPatch,
  buildDeleteCustomModelFromProviderPatch,
} from "@/screens/settings/custom-models";
import type {
  AgentModelDefinition,
  AgentProvider,
  ProviderSnapshotEntry,
} from "@chisacode/protocol/agent-types";
import type { ProviderProfileModel } from "@chisacode/protocol/provider-config";
import { ICON_SIZE, type Theme } from "@/styles/theme";

const ThemedTrash2 = withUnistyles(Trash2);
const ThemedCopy = withUnistyles(Copy);
const ThemedRotateCw = withUnistyles(RotateCw);
const ThemedAlertTriangle = withUnistyles(AlertTriangle);
const ThemedActivityIndicator = withUnistyles(ActivityIndicator);

const destructiveSmIconMapping = (theme: Theme) => ({
  color: theme.colors.destructive,
  size: ICON_SIZE.sm,
});
const foregroundMutedColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});
const mutedSmIconMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
  size: ICON_SIZE.sm,
});
const mutedMdIconMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
  size: ICON_SIZE.md,
});

interface ProviderDiagnosticSheetProps {
  provider: string;
  visible: boolean;
  onClose: () => void;
  serverId: string;
}

function rankModels<T>(items: T[], query: string, fields: (item: T) => string[]): T[] {
  if (!query.trim()) return items;
  const scored = items
    .map((item) => ({ item, score: scoreTextFields(query, fields(item)) }))
    .filter(
      (entry): entry is { item: T; score: NonNullable<typeof entry.score> } => entry.score !== null,
    );
  scored.sort((a, b) => compareMatchScores(a.score, b.score));
  return scored.map((entry) => entry.item);
}

function DiscoveredModelRow({ model }: { model: AgentModelDefinition }) {
  return (
    <View style={sheetStyles.modelRow}>
      <Text style={sheetStyles.modelTitle} numberOfLines={1}>
        {model.label}
      </Text>
      <Text style={sheetStyles.monoHint} numberOfLines={1} selectable>
        {model.id}
      </Text>
      {model.description ? (
        <Text style={sheetStyles.descriptionInline} numberOfLines={1}>
          {model.description}
        </Text>
      ) : null}
    </View>
  );
}

function CustomModelRow({
  model,
  deleting,
  onDelete,
}: {
  model: ProviderProfileModel;
  deleting: boolean;
  onDelete: (modelId: string) => void;
}) {
  const { t } = useTranslation();
  const handleDelete = useCallback(() => onDelete(model.id), [model.id, onDelete]);
  const deleteButtonStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      sheetStyles.iconButton,
      (Boolean(hovered) || pressed) && sheetStyles.iconButtonHovered,
      deleting ? sheetStyles.disabled : null,
    ],
    [deleting],
  );

  return (
    <View style={sheetStyles.modelRow}>
      <Text style={sheetStyles.modelTitle} numberOfLines={1}>
        {model.label}
      </Text>
      <Text style={sheetStyles.monoHint} numberOfLines={1} selectable>
        {model.id}
      </Text>
      <View style={sheetStyles.modelRowFiller} />
      <Pressable
        onPress={handleDelete}
        disabled={deleting}
        hitSlop={8}
        style={deleteButtonStyle}
        accessibilityRole="button"
        accessibilityLabel={t("providerDiagnostics.removeModel", { model: model.id })}
      >
        <ThemedTrash2 uniProps={destructiveSmIconMapping} />
      </Pressable>
    </View>
  );
}

function SectionHeader({ title, count, hint }: { title: string; count?: number; hint?: string }) {
  return (
    <View style={sheetStyles.sectionHeader}>
      <Text style={settingsStyles.sectionHeaderTitle}>{title}</Text>
      <View style={sheetStyles.sectionHeaderMeta}>
        {count !== undefined ? (
          <Text style={settingsStyles.sectionHeaderTitle}>{count}</Text>
        ) : null}
        {count !== undefined && hint ? (
          <Text style={settingsStyles.sectionHeaderTitle}>·</Text>
        ) : null}
        {hint ? <Text style={settingsStyles.sectionHeaderTitle}>{hint}</Text> : null}
      </View>
    </View>
  );
}

function ProviderInstallationSection({
  providerEntry,
  modelsRefreshing,
  clientAvailable,
  toolingAction,
  toolingOutput,
  onInstall,
  onUpdate,
  error,
}: {
  providerEntry: ProviderSnapshotEntry | undefined;
  modelsRefreshing: boolean;
  clientAvailable: boolean;
  toolingAction: "install" | "update" | null;
  toolingOutput: string | null;
  onInstall: () => void;
  onUpdate: () => void;
  error: string | null;
}) {
  const { t } = useTranslation();
  const installDisabled = toolingAction !== null || modelsRefreshing || !clientAvailable;
  const canInstall = providerEntry?.enabled === true && providerEntry.installAvailable === true;
  const canUpdate = providerEntry?.enabled === true && providerEntry.updateAvailable === true;

  return (
    <View style={sheetStyles.section}>
      <SectionHeader
        title={t("providerDiagnostics.installation")}
        hint={providerEntry?.packageName}
      />
      <View style={settingsStyles.card}>
        <View style={sheetStyles.toolingRow}>
          <View style={sheetStyles.toolingTextColumn}>
            <Text style={sheetStyles.modelTitle} numberOfLines={1}>
              {providerEntry?.installedVersion
                ? t("providerDiagnostics.installedVersion", {
                    version: providerEntry.installedVersion,
                  })
                : t("providerDiagnostics.notInstalled")}
            </Text>
            <Text style={sheetStyles.monoHint} numberOfLines={1}>
              {providerEntry?.latestVersion
                ? t("providerDiagnostics.latestVersion", {
                    version: providerEntry.latestVersion,
                  })
                : t("providerDiagnostics.latestUnknown")}
            </Text>
          </View>
          <View style={sheetStyles.toolingActions}>
            <Button
              variant={canInstall ? "default" : "secondary"}
              size="sm"
              disabled={!canInstall || installDisabled}
              loading={toolingAction === "install"}
              onPress={onInstall}
            >
              {t("providerDiagnostics.install")}
            </Button>
            <Button
              variant={canUpdate ? "default" : "secondary"}
              size="sm"
              disabled={!canUpdate || installDisabled}
              loading={toolingAction === "update"}
              onPress={onUpdate}
            >
              {t("providerDiagnostics.update")}
            </Button>
          </View>
        </View>
        {error ? <Text style={sheetStyles.errorText}>{error}</Text> : null}
        {toolingOutput ? (
          <Text style={sheetStyles.toolingOutput} selectable>
            {toolingOutput}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

function AddCustomModelSubSheet({
  provider,
  serverId,
  visible,
  onClose,
  refresh,
}: {
  provider: string;
  serverId: string;
  visible: boolean;
  onClose: () => void;
  refresh: (providers?: AgentProvider[]) => Promise<void>;
}) {
  const { t } = useTranslation();
  const { config, patchConfig } = useDaemonConfig(serverId);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const additionalModels = useMemo(
    () => config?.providers?.[provider]?.additionalModels ?? [],
    [config?.providers, provider],
  );
  const trimmed = input.trim();
  const canAdd = trimmed.length > 0 && !additionalModels.some((model) => model.id === trimmed);

  useEffect(() => {
    if (!visible) {
      setInput("");
      setError(null);
    }
  }, [visible]);

  const handleAdd = useCallback(() => {
    if (!canAdd) return;
    setError(null);
    setSaving(true);
    void patchConfig(
      buildAddCustomModelToProviderPatch({
        currentProviders: config?.providers,
        providerId: provider,
        id: trimmed,
      }),
    )
      .then(() => refresh([provider]))
      .then(() => onClose())
      .catch((err) => {
        setError(err instanceof Error ? err.message : t("providerDiagnostics.saveModelFailed"));
      })
      .finally(() => setSaving(false));
  }, [canAdd, config?.providers, onClose, patchConfig, provider, refresh, t, trimmed]);

  const header = useMemo<SheetHeader>(
    () => ({ title: t("providerDiagnostics.addCustomModel") }),
    [t],
  );

  return (
    <AdaptiveModalSheet
      header={header}
      visible={visible}
      onClose={onClose}
      desktopMaxWidth={420}
      snapPoints={ADD_SNAP_POINTS}
    >
      <View style={sheetStyles.formGroup}>
        <Text style={sheetStyles.formLabel}>{t("providerDiagnostics.modelId")}</Text>
        <AdaptiveTextInput
          initialValue={input}
          resetKey={`add-custom-${visible}`}
          value={input}
          onChangeText={setInput}
          onSubmitEditing={handleAdd}
          placeholder="e.g. openai/gpt-5"
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="done"
          // @ts-expect-error - outlineStyle is web-only
          style={FORM_INPUT_STYLE}
        />
        {error ? <Text style={sheetStyles.errorText}>{error}</Text> : null}
        <View style={sheetStyles.formActions}>
          <Button variant="secondary" size="sm" onPress={onClose} disabled={saving}>
            {t("common.cancel")}
          </Button>
          <Button variant="default" size="sm" onPress={handleAdd} disabled={!canAdd || saving}>
            {saving ? t("providerDiagnostics.adding") : t("providerDiagnostics.add")}
          </Button>
        </View>
      </View>
    </AdaptiveModalSheet>
  );
}

function DiagnosticSubSheet({
  provider,
  serverId,
  visible,
  onClose,
}: {
  provider: string;
  serverId: string;
  visible: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const client = useHostRuntimeClient(serverId);
  const [diagnosticState, setDiagnosticState] = useState<
    { kind: "success"; text: string } | { kind: "error"; text: string } | null
  >(null);
  const requestSequence = useRef(0);
  const [loading, setLoading] = useState(false);

  const fetchDiagnostic = useCallback(async () => {
    if (!client) return;
    const sequence = ++requestSequence.current;
    setLoading(true);
    try {
      const result = await client.getProviderDiagnostic(provider);
      if (sequence === requestSequence.current) {
        setDiagnosticState({ kind: "success", text: result.diagnostic });
      }
    } catch (err) {
      if (sequence === requestSequence.current) {
        setDiagnosticState({
          kind: "error",
          text: err instanceof Error ? err.message : t("providerDiagnostics.diagnosticFailed"),
        });
      }
    } finally {
      if (sequence === requestSequence.current) {
        setLoading(false);
      }
    }
  }, [client, provider, t]);

  useEffect(() => {
    if (visible) {
      void fetchDiagnostic();
    } else {
      requestSequence.current += 1;
      setDiagnosticState(null);
    }
  }, [visible, fetchDiagnostic]);

  const refreshButtonStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      sheetStyles.iconButton,
      (Boolean(hovered) || pressed) && sheetStyles.iconButtonHovered,
      loading ? sheetStyles.disabled : null,
    ],
    [loading],
  );

  const handleRefreshPress = useCallback(() => {
    void fetchDiagnostic();
  }, [fetchDiagnostic]);

  const handleCopyPress = useCallback(async () => {
    if (diagnosticState?.kind !== "success") return;
    await Clipboard.setStringAsync(diagnosticState.text);
  }, [diagnosticState]);

  const header = useMemo<SheetHeader>(
    () => ({
      title: t("providerDiagnostics.diagnostic"),
      actions: (
        <>
          <Pressable
            onPress={handleCopyPress}
            disabled={diagnosticState?.kind !== "success"}
            hitSlop={8}
            style={refreshButtonStyle}
            accessibilityRole="button"
            accessibilityLabel={t("providerDiagnostics.copyDiagnostic")}
          >
            <ThemedCopy uniProps={mutedSmIconMapping} />
          </Pressable>
          <Pressable
            onPress={handleRefreshPress}
            disabled={loading}
            hitSlop={8}
            style={refreshButtonStyle}
            accessibilityRole="button"
            accessibilityLabel={
              loading
                ? t("providerDiagnostics.refreshingDiagnostic")
                : t("providerDiagnostics.refreshDiagnostic")
            }
          >
            {loading ? (
              <ThemedActivityIndicator size={ICON_SIZE.sm} uniProps={foregroundMutedColorMapping} />
            ) : (
              <ThemedRotateCw uniProps={mutedSmIconMapping} />
            )}
          </Pressable>
        </>
      ),
    }),
    [handleCopyPress, handleRefreshPress, loading, diagnosticState, refreshButtonStyle, t],
  );

  let body: React.ReactNode;
  if (loading && !diagnosticState) {
    body = (
      <View style={sheetStyles.codeBlockLoading}>
        <ThemedActivityIndicator size="small" uniProps={foregroundMutedColorMapping} />
        <Text style={sheetStyles.mutedText}>{t("providerDiagnostics.loadingDiagnostic")}</Text>
      </View>
    );
  } else if (diagnosticState?.kind === "success") {
    body = (
      <ScrollView style={sheetStyles.codeScroll} contentContainerStyle={sheetStyles.codeContent}>
        <ScrollView horizontal showsHorizontalScrollIndicator>
          <Text style={sheetStyles.codeText} selectable>
            {diagnosticState.text}
          </Text>
        </ScrollView>
      </ScrollView>
    );
  } else if (diagnosticState?.kind === "error") {
    body = (
      <View style={sheetStyles.codeBlockLoading}>
        <Text style={sheetStyles.errorText}>{diagnosticState.text}</Text>
        <Button variant="default" size="sm" onPress={handleRefreshPress} disabled={loading}>
          {t("common.retry")}
        </Button>
      </View>
    );
  } else {
    body = (
      <View style={sheetStyles.codeBlockLoading}>
        <Text style={sheetStyles.mutedText}>{t("providerDiagnostics.noDiagnostic")}</Text>
      </View>
    );
  }

  return (
    <AdaptiveModalSheet
      header={header}
      visible={visible}
      onClose={onClose}
      snapPoints={DIAGNOSTIC_SNAP_POINTS}
      scrollable={false}
    >
      <View style={DIAGNOSTIC_CARD_STYLE}>{body}</View>
    </AdaptiveModalSheet>
  );
}

interface ProviderModalBodyProps {
  discoveredCount: number;
  additionalCount: number;
  providerSnapshotRefreshing: boolean;
  providerErrorMessage: string | null;
  modelsRefreshing: boolean;
  searchActive: boolean;
  filteredDiscovered: AgentModelDefinition[];
  filteredCustom: ProviderProfileModel[];
  deletingModelId: string | null;
  deletingModelError: string | null;
  onRefresh: () => void;
  onDeleteCustom: (modelId: string) => void;
}

function ProviderModalBody(props: ProviderModalBodyProps) {
  const { t } = useTranslation();
  const {
    discoveredCount,
    additionalCount,
    providerSnapshotRefreshing,
    providerErrorMessage,
    modelsRefreshing,
    searchActive,
    filteredDiscovered,
    filteredCustom,
    deletingModelId,
    deletingModelError,
    onRefresh,
    onDeleteCustom,
  } = props;

  if (providerErrorMessage && discoveredCount === 0 && additionalCount === 0) {
    return (
      <View style={sheetStyles.emptyState}>
        <ThemedAlertTriangle uniProps={mutedMdIconMapping} />
        <Text style={sheetStyles.mutedText}>{providerErrorMessage}</Text>
        <Button variant="default" size="sm" onPress={onRefresh} disabled={modelsRefreshing}>
          {modelsRefreshing ? t("modelSelector.retrying") : t("common.retry")}
        </Button>
      </View>
    );
  }
  if (discoveredCount === 0 && additionalCount === 0 && providerSnapshotRefreshing) {
    return (
      <View style={sheetStyles.emptyState}>
        <ThemedActivityIndicator size="small" uniProps={foregroundMutedColorMapping} />
        <Text style={sheetStyles.mutedText}>{t("providerDiagnostics.loadingModels")}</Text>
      </View>
    );
  }
  if (filteredDiscovered.length === 0 && filteredCustom.length === 0 && searchActive) {
    return (
      <View style={sheetStyles.emptyState}>
        <Text style={sheetStyles.mutedText}>{t("providerDiagnostics.noSearchMatches")}</Text>
      </View>
    );
  }
  if (discoveredCount === 0 && additionalCount === 0) {
    return (
      <View style={sheetStyles.emptyState}>
        <Text style={sheetStyles.mutedText}>{t("providerDiagnostics.noModels")}</Text>
      </View>
    );
  }
  return (
    <>
      {deletingModelError ? (
        <View style={sheetStyles.backgroundErrorState}>
          <Text style={sheetStyles.errorText}>{deletingModelError}</Text>
        </View>
      ) : null}
      {providerErrorMessage ? (
        <View style={sheetStyles.backgroundErrorState}>
          <Text style={sheetStyles.errorText}>{providerErrorMessage}</Text>
          <Button variant="secondary" size="sm" onPress={onRefresh} disabled={modelsRefreshing}>
            {modelsRefreshing ? t("modelSelector.retrying") : t("common.retry")}
          </Button>
        </View>
      ) : null}
      {filteredDiscovered.length > 0 ? (
        <View style={sheetStyles.section}>
          <SectionHeader title={t("providers.discovered")} count={filteredDiscovered.length} />
          <View style={settingsStyles.card}>
            {filteredDiscovered.map((model) => (
              <DiscoveredModelRow key={model.id} model={model} />
            ))}
          </View>
        </View>
      ) : null}
      {filteredCustom.length > 0 ? (
        <View style={sheetStyles.section}>
          <SectionHeader title={t("providers.customModels")} count={filteredCustom.length} />
          <View style={settingsStyles.card}>
            {filteredCustom.map((model) => (
              <CustomModelRow
                key={model.id}
                model={model}
                deleting={deletingModelId === model.id}
                onDelete={onDeleteCustom}
              />
            ))}
          </View>
        </View>
      ) : null}
    </>
  );
}

function useProviderTooling(
  client: ReturnType<typeof useHostRuntimeClient>,
  provider: string,
  refresh: (providers?: AgentProvider[]) => Promise<void>,
) {
  const { t } = useTranslation();
  const [toolingAction, setToolingAction] = useState<"install" | "update" | null>(null);
  const [toolingOutput, setToolingOutput] = useState<string | null>(null);
  const [toolingError, setToolingError] = useState<string | null>(null);

  const runAction = useCallback(
    (action: "install" | "update") => {
      if (!client || toolingAction) return;
      setToolingAction(action);
      setToolingOutput(null);
      setToolingError(null);
      void client
        .runProviderToolingAction(provider, action)
        .then((result) => {
          const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
          if (!result.success) {
            const message = output || t("providerDiagnostics.toolingFailed");
            setToolingError(message);
            setToolingOutput(message);
            return;
          }
          setToolingOutput(output || t("providerDiagnostics.toolingSucceeded"));
          return refresh([provider]);
        })
        .catch((error) => {
          const message = error instanceof Error ? error.message : String(error);
          setToolingError(message);
          setToolingOutput(message);
        })
        .finally(() => {
          setToolingAction(null);
        });
    },
    [client, provider, refresh, t, toolingAction],
  );

  const handleRunInstall = useCallback(() => runAction("install"), [runAction]);
  const handleRunUpdate = useCallback(() => runAction("update"), [runAction]);

  return { toolingAction, toolingOutput, toolingError, handleRunInstall, handleRunUpdate };
}

function useDiscoveredModels(
  provider: string,
  providerEntry: { models?: AgentModelDefinition[] } | undefined,
) {
  const stableDiscoveredRef = useRef<{ provider: string; models: AgentModelDefinition[] } | null>(
    null,
  );
  if (providerEntry?.models && providerEntry.models.length > 0) {
    stableDiscoveredRef.current = { provider, models: providerEntry.models };
  }
  return stableDiscoveredRef.current?.provider === provider
    ? stableDiscoveredRef.current.models
    : (providerEntry?.models ?? []);
}

function useFetchedAtLabel(fetchedAt: string | undefined, visible: boolean) {
  const [clockTick, setClockTick] = useState(0);
  useEffect(() => {
    if (!visible) return;
    const id = setInterval(() => setClockTick((tick) => tick + 1), 10_000);
    return () => clearInterval(id);
  }, [visible]);
  return useMemo(() => {
    if (!fetchedAt) return null;
    void clockTick;
    return formatTimeAgo(new Date(fetchedAt));
  }, [fetchedAt, clockTick]);
}

export function ProviderDiagnosticSheet({
  provider,
  visible,
  onClose,
  serverId,
}: ProviderDiagnosticSheetProps) {
  const { t } = useTranslation();
  const client = useHostRuntimeClient(serverId);
  const {
    entries: snapshotEntries,
    refresh,
    isRefreshing,
    error: snapshotError,
    refreshError,
  } = useProvidersSnapshot(serverId);
  const { config, patchConfig } = useDaemonConfig(serverId);
  const [query, setQuery] = useState("");
  const [addSheetOpen, setAddSheetOpen] = useState(false);
  const [diagSheetOpen, setDiagSheetOpen] = useState(false);
  const [deletingModelId, setDeletingModelId] = useState<string | null>(null);
  const [deletingModelError, setDeletingModelError] = useState<string | null>(null);

  const providerLabel = resolveProviderLabel(provider, snapshotEntries);
  const providerEntry = useMemo(
    () => snapshotEntries?.find((entry) => entry.provider === provider),
    [snapshotEntries, provider],
  );
  const additionalModels = useMemo(
    () => config?.providers?.[provider]?.additionalModels ?? [],
    [config?.providers, provider],
  );
  const providerSnapshotRefreshing = providerEntry?.status === "loading";
  let providerStatusError: string | null = null;
  if (providerEntry?.status === "error") {
    providerStatusError = providerEntry.error ?? t("modelSelector.unknownError");
  } else if (providerEntry?.status === "unavailable") {
    providerStatusError = t("providerDiagnostics.providerUnavailable");
  }
  const providerErrorMessage = snapshotError ?? refreshError ?? providerStatusError;
  const modelsRefreshing = isRefreshing || providerSnapshotRefreshing;

  const discoveredModels = useDiscoveredModels(provider, providerEntry);
  const fetchedAtLabel = useFetchedAtLabel(providerEntry?.fetchedAt, visible);
  const { toolingAction, toolingOutput, toolingError, handleRunInstall, handleRunUpdate } =
    useProviderTooling(client, provider, refresh);

  useEffect(() => {
    if (!visible) {
      setQuery("");
      setAddSheetOpen(false);
      setDiagSheetOpen(false);
    }
  }, [visible]);

  const q = query.trim();
  const filteredDiscovered = useMemo(
    () => rankModels(discoveredModels, q, (m) => [m.label, m.id, m.description ?? ""]),
    [discoveredModels, q],
  );
  const filteredCustom = useMemo(
    () => rankModels(additionalModels, q, (m) => [m.label, m.id]),
    [additionalModels, q],
  );

  const handleRefreshModels = useCallback(() => {
    void refresh([provider]).catch(() => undefined);
  }, [provider, refresh]);

  const handleOpenAddSheet = useCallback(() => setAddSheetOpen(true), []);
  const handleCloseAddSheet = useCallback(() => setAddSheetOpen(false), []);
  const handleOpenDiagSheet = useCallback(() => setDiagSheetOpen(true), []);
  const handleCloseDiagSheet = useCallback(() => setDiagSheetOpen(false), []);

  const handleDeleteCustom = useCallback(
    (modelId: string) => {
      setDeletingModelId(modelId);
      setDeletingModelError(null);
      void patchConfig(
        buildDeleteCustomModelFromProviderPatch({
          currentProviders: config?.providers,
          providerId: provider,
          id: modelId,
        }),
      )
        .then(() => refresh([provider]))
        .catch((error) => {
          setDeletingModelError(
            error instanceof Error ? error.message : t("customModels.deleteFailed"),
          );
        })
        .finally(() => {
          setDeletingModelId((current) => (current === modelId ? null : current));
        });
    },
    [config?.providers, patchConfig, provider, refresh, t],
  );

  const sheetHeader = useMemo<SheetHeader>(
    () => ({
      title: providerLabel,
      search: {
        onChange: setQuery,
        placeholder: t("providerDiagnostics.searchModels"),
        testID: "provider-settings-search",
      },
    }),
    [providerLabel, t],
  );

  const footer = (
    <>
      <Text style={sheetStyles.footerMeta} numberOfLines={1}>
        {fetchedAtLabel ? t("providerDiagnostics.updated", { time: fetchedAtLabel }) : ""}
      </Text>
      <View style={sheetStyles.footerActions}>
        <Button variant="secondary" size="sm" leftIcon={Plus} onPress={handleOpenAddSheet}>
          {t("providerDiagnostics.addModel")}
        </Button>
        <Button variant="secondary" size="sm" leftIcon={FileText} onPress={handleOpenDiagSheet}>
          {t("providerDiagnostics.diagnostic")}
        </Button>
        <Button
          variant="default"
          size="sm"
          leftIcon={modelsRefreshing ? undefined : RotateCw}
          onPress={handleRefreshModels}
          disabled={modelsRefreshing}
        >
          {modelsRefreshing
            ? t("providerDiagnostics.refreshing")
            : t("providerDiagnostics.refresh")}
        </Button>
      </View>
    </>
  );

  return (
    <>
      <AdaptiveModalSheet
        header={sheetHeader}
        visible={visible}
        onClose={onClose}
        footer={footer}
        snapPoints={MAIN_SNAP_POINTS}
      >
        <ProviderInstallationSection
          providerEntry={providerEntry}
          modelsRefreshing={modelsRefreshing}
          clientAvailable={Boolean(client)}
          toolingAction={toolingAction}
          toolingOutput={toolingOutput}
          onInstall={handleRunInstall}
          onUpdate={handleRunUpdate}
          error={toolingError}
        />
        <ProviderModalBody
          discoveredCount={discoveredModels.length}
          additionalCount={additionalModels.length}
          providerSnapshotRefreshing={providerSnapshotRefreshing}
          providerErrorMessage={providerErrorMessage}
          modelsRefreshing={modelsRefreshing}
          searchActive={Boolean(q)}
          filteredDiscovered={filteredDiscovered}
          filteredCustom={filteredCustom}
          deletingModelId={deletingModelId}
          deletingModelError={deletingModelError}
          onRefresh={handleRefreshModels}
          onDeleteCustom={handleDeleteCustom}
        />
      </AdaptiveModalSheet>
      <AddCustomModelSubSheet
        provider={provider}
        serverId={serverId}
        visible={addSheetOpen}
        onClose={handleCloseAddSheet}
        refresh={refresh}
      />
      <DiagnosticSubSheet
        provider={provider}
        serverId={serverId}
        visible={diagSheetOpen}
        onClose={handleCloseDiagSheet}
      />
    </>
  );
}

const sheetStyles = StyleSheet.create((theme) => ({
  mutedText: {
    fontSize: 12.5,
    lineHeight: 16,
    color: theme.colors.foregroundMuted,
  },
  monoHint: {
    fontFamily: Fonts.mono,
    fontSize: theme.fontSize.code,
    color: theme.colors.foregroundMuted,
    flexShrink: 0,
  },
  descriptionInline: {
    flex: 1,
    fontSize: 12.5,
    lineHeight: 16,
    color: theme.colors.foregroundMuted,
  },
  errorText: {
    fontSize: 12.5,
    lineHeight: 16,
    color: theme.colors.destructive,
  },
  formInput: {
    backgroundColor: theme.colors.surface0,
    borderRadius: 12,
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
    color: theme.colors.foreground,
    borderWidth: 1,
    borderColor: theme.colors.border,
    // Soft form field body: 14.5 readability.
    fontSize: 14.5,
    lineHeight: 22,
  },
  iconButton: {
    width: 28,
    height: 28,
    borderRadius: theme.borderRadius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  iconButtonHovered: {
    backgroundColor: theme.colors.surface1,
  },
  disabled: {
    opacity: 0.5,
  },
  section: {
    marginBottom: theme.spacing[4],
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
    marginBottom: theme.spacing[2],
    marginLeft: theme.spacing[1],
  },
  sectionHeaderMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  modelRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[4],
    gap: theme.spacing[3],
    borderTopWidth: 1,
    // Soft quiet list divider (--border-soft).
    borderTopColor: theme.colors.secondary,
  },
  modelTitle: {
    color: theme.colors.foreground,
    // Soft chrome: 12.5 meta.
    fontSize: 12.5,
    lineHeight: 18,
    flexShrink: 0,
  },
  modelRowFiller: {
    flex: 1,
  },
  toolingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    padding: theme.spacing[3],
  },
  toolingTextColumn: {
    flex: 1,
    minWidth: 0,
    gap: theme.spacing[1],
  },
  toolingActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  toolingOutput: {
    borderTopWidth: 1,
    // Soft quiet chrome rule (--border-soft).
    borderTopColor: theme.colors.secondary,
    color: theme.colors.foregroundMuted,
    fontFamily: Fonts.mono,
    fontSize: 12.5,
    lineHeight: 16,
    padding: theme.spacing[3],
  },
  backgroundErrorState: {
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[2],
    alignItems: "flex-start",
    gap: theme.spacing[2],
  },
  emptyState: {
    paddingVertical: theme.spacing[8],
    alignItems: "center",
    gap: theme.spacing[3],
  },
  footerMeta: {
    flex: 1,
    fontSize: 12.5,
    lineHeight: 16,
    color: theme.colors.foregroundMuted,
  },
  footerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  formGroup: {
    gap: theme.spacing[3],
  },
  formLabel: {
    // Soft chrome: 12.5 meta.
    fontSize: 12.5,
    lineHeight: 18,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.foreground,
  },
  formActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: theme.spacing[2],
  },
  diagnosticCard: {
    overflow: "hidden",
  },
  codeScroll: {
    maxHeight: 480,
  },
  codeContent: {
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
  },
  codeText: {
    fontFamily: Fonts.mono,
    fontSize: theme.fontSize.code,
    color: theme.colors.foreground,
    lineHeight: 18,
  },
  codeBlockLoading: {
    paddingVertical: theme.spacing[4],
    paddingHorizontal: theme.spacing[4],
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
}));

const FORM_INPUT_STYLE = [sheetStyles.formInput, isWeb && { outlineStyle: "none" }];

const MAIN_SNAP_POINTS = ["65%", "92%"];
const ADD_SNAP_POINTS = ["40%"];
const DIAGNOSTIC_SNAP_POINTS = ["50%", "85%"];
const DIAGNOSTIC_CARD_STYLE = [settingsStyles.card, sheetStyles.diagnosticCard];
