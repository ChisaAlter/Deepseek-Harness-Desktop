/* eslint-disable react-hooks/exhaustive-deps */
import { Pencil, Plus, Trash2 } from "lucide-react-native";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, type PressableStateCallbackType, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { ICON_SIZE, type Theme } from "@/styles/theme";
import {
  AdaptiveModalSheet,
  AdaptiveTextInput,
  type SheetHeader,
} from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { isWeb } from "@/constants/platform";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { useProvidersSnapshot } from "@/hooks/use-providers-snapshot";
import { SettingsSection } from "@/screens/settings/settings-section";
import { settingsStyles } from "@/styles/settings";
import { confirmDialog } from "@/utils/confirm-dialog";
import { useUserVisibleErrorReporter } from "@/hooks/use-user-visible-error";
import {
  buildDeleteCustomModelPatch,
  buildSaveCustomModelPatch,
  collectCustomModels,
  getSelectableCustomModelProviders,
  type CustomModelEntry,
  type SelectableCustomModelProvider,
} from "@/screens/settings/custom-models";
import type { AgentProvider } from "@chisacode/protocol/agent-types";

const ThemedPencil = withUnistyles(Pencil);
const ThemedTrash2 = withUnistyles(Trash2);
const ThemedPlus = withUnistyles(Plus);

const foregroundMutedColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});
const destructiveColorMapping = (theme: Theme) => ({
  color: theme.colors.destructive,
});

interface CustomModelsSectionProps {
  serverId: string;
}

interface EditingModelState {
  mode: "add" | "edit";
  model: CustomModelEntry | null;
}

const EDITOR_SNAP_POINTS = ["78%", "92%"];

function toggleProviderId(providerIds: string[], providerId: string, selected: boolean): string[] {
  const next = new Set(providerIds);
  if (selected) {
    next.add(providerId);
  } else {
    next.delete(providerId);
  }
  return Array.from(next).sort();
}

function CustomModelRow({
  model,
  deleting,
  onEdit,
  onDelete,
}: {
  model: CustomModelEntry;
  deleting: boolean;
  onEdit: (model: CustomModelEntry) => void;
  onDelete: (model: CustomModelEntry) => void;
}) {
  const { t } = useTranslation();
  const handleEdit = useCallback(() => onEdit(model), [model, onEdit]);
  const handleDelete = useCallback(() => onDelete(model), [model, onDelete]);
  const buttonStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.iconButton,
      (Boolean(hovered) || pressed) && styles.iconButtonHovered,
      deleting ? styles.disabled : null,
    ],
    [deleting],
  );

  return (
    <View style={styles.modelRow} testID={`custom-model-row-${model.id}`}>
      <View style={styles.modelTextColumn}>
        <Text style={settingsStyles.rowTitle} numberOfLines={1}>
          {model.label}
        </Text>
        <Text style={styles.modelIdText} numberOfLines={1} selectable>
          {model.id}
        </Text>
        <Text style={settingsStyles.rowHint} numberOfLines={2}>
          {model.providers.map((provider) => provider.label).join(", ")}
        </Text>
      </View>
      <View style={styles.rowActions}>
        <Pressable
          onPress={handleEdit}
          hitSlop={8}
          style={buttonStyle}
          accessibilityRole="button"
          accessibilityLabel={t("customModels.editModel", { model: model.label })}
          testID={`edit-custom-model-${model.id}`}
        >
          <ThemedPencil size={ICON_SIZE.sm} uniProps={foregroundMutedColorMapping} />
        </Pressable>
        <Pressable
          onPress={handleDelete}
          disabled={deleting}
          hitSlop={8}
          style={buttonStyle}
          accessibilityRole="button"
          accessibilityLabel={t("customModels.deleteModel", { model: model.label })}
          testID={`delete-custom-model-${model.id}`}
        >
          <ThemedTrash2 size={ICON_SIZE.sm} uniProps={destructiveColorMapping} />
        </Pressable>
      </View>
    </View>
  );
}

function ProviderToggleRow({
  provider,
  selected,
  onToggle,
}: {
  provider: SelectableCustomModelProvider;
  selected: boolean;
  onToggle: (providerId: string, selected: boolean) => void;
}) {
  const { t } = useTranslation();
  const handleChange = useCallback(
    (next: boolean) => onToggle(provider.id, next),
    [onToggle, provider.id],
  );

  return (
    <View style={styles.providerToggleRow}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle} numberOfLines={1}>
          {provider.label}
        </Text>
        <Text style={settingsStyles.rowHint} numberOfLines={1}>
          {provider.id}
        </Text>
      </View>
      <Switch
        value={selected}
        onValueChange={handleChange}
        accessibilityLabel={t("customModels.providerToggleLabel", { provider: provider.label })}
        testID={`custom-model-provider-${provider.id}`}
      />
    </View>
  );
}

function CustomModelEditorSheet({
  state,
  providers,
  onClose,
  onSave,
}: {
  state: EditingModelState | null;
  providers: SelectableCustomModelProvider[];
  onClose: () => void;
  onSave: (input: {
    previousId: string | null;
    id: string;
    label: string;
    providerIds: string[];
  }) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [modelId, setModelId] = useState("");
  const [label, setLabel] = useState("");
  const [providerIds, setProviderIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const visible = state !== null;
  const editingModel = state?.model ?? null;
  const previousId = editingModel?.id ?? null;

  const providerOptions = useMemo(() => {
    const byId = new Map(providers.map((provider) => [provider.id, provider]));
    for (const provider of editingModel?.providers ?? []) {
      if (!byId.has(provider.id)) {
        byId.set(provider.id, provider);
      }
    }
    return Array.from(byId.values()).sort((a, b) => a.label.localeCompare(b.label));
  }, [editingModel, providers]);

  useEffect(() => {
    if (!state) {
      setModelId("");
      setLabel("");
      setProviderIds([]);
      setSaving(false);
      return;
    }
    setModelId(state.model?.id ?? "");
    setLabel(state.model?.label ?? "");
    setProviderIds(state.model?.providerIds ?? []);
  }, [state]);

  const handleToggleProvider = useCallback((providerId: string, selected: boolean) => {
    setProviderIds((current) => toggleProviderId(current, providerId, selected));
  }, []);

  const handleSave = useCallback(() => {
    if (saving) return;
    setSaving(true);
    void onSave({
      previousId,
      id: modelId,
      label,
      providerIds,
    }).finally(() => setSaving(false));
  }, [label, modelId, onSave, previousId, providerIds, saving]);

  const header = useMemo<SheetHeader>(
    () => ({
      title:
        state?.mode === "edit"
          ? t("customModels.editCustomModel")
          : t("customModels.addCustomModel"),
    }),
    [state?.mode, t],
  );

  const canSave = modelId.trim().length > 0 && providerIds.length > 0 && !saving;

  return (
    <AdaptiveModalSheet
      header={header}
      visible={visible}
      onClose={onClose}
      desktopMaxWidth={460}
      snapPoints={EDITOR_SNAP_POINTS}
      testID="custom-model-editor-sheet"
    >
      <View style={styles.formGroup}>
        <View style={styles.fieldGroup}>
          <Text style={styles.formLabel}>{t("customModels.modelId")}</Text>
          <AdaptiveTextInput
            initialValue={modelId}
            resetKey={`custom-model-id-${state?.mode ?? "closed"}-${previousId ?? "new"}`}
            onChangeText={setModelId}
            placeholder="e.g. openai/gpt-5"
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="next"
            testID="custom-model-id-input"
            // @ts-expect-error - outlineStyle is web-only
            style={FORM_INPUT_STYLE}
          />
        </View>
        <View style={styles.fieldGroup}>
          <Text style={styles.formLabel}>{t("customModels.modelLabel")}</Text>
          <AdaptiveTextInput
            initialValue={label}
            resetKey={`custom-model-label-${state?.mode ?? "closed"}-${previousId ?? "new"}`}
            onChangeText={setLabel}
            placeholder={t("customModels.modelLabelPlaceholder")}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="done"
            testID="custom-model-label-input"
            // @ts-expect-error - outlineStyle is web-only
            style={FORM_INPUT_STYLE}
          />
        </View>
        <View style={styles.fieldGroup}>
          <Text style={styles.formLabel}>{t("customModels.supportedAgents")}</Text>
          <View style={settingsStyles.card}>
            {providerOptions.length > 0 ? (
              providerOptions.map((provider, index) => (
                <View
                  key={provider.id}
                  style={index === 0 ? undefined : styles.providerToggleBorder}
                >
                  <ProviderToggleRow
                    provider={provider}
                    selected={providerIds.includes(provider.id)}
                    onToggle={handleToggleProvider}
                  />
                </View>
              ))
            ) : (
              <View style={styles.emptyCard}>
                <Text style={settingsStyles.rowHint}>{t("customModels.noProviders")}</Text>
              </View>
            )}
          </View>
        </View>
        <View style={styles.formActions}>
          <Button variant="secondary" size="sm" onPress={onClose} disabled={saving}>
            {t("common.cancel")}
          </Button>
          <Button variant="default" size="sm" onPress={handleSave} disabled={!canSave}>
            {saving ? t("customModels.saving") : t("common.save")}
          </Button>
        </View>
      </View>
    </AdaptiveModalSheet>
  );
}

export function CustomModelsSection({ serverId }: CustomModelsSectionProps) {
  const { t } = useTranslation();
  const reportError = useUserVisibleErrorReporter();
  const { config, patchConfig } = useDaemonConfig(serverId);
  const { entries, refresh } = useProvidersSnapshot(serverId);
  const [editorState, setEditorState] = useState<EditingModelState | null>(null);
  const [deletingModelId, setDeletingModelId] = useState<string | null>(null);

  const customModels = useMemo(
    () => collectCustomModels({ providers: config?.providers, snapshotEntries: entries }),
    [config?.providers, entries],
  );
  const selectableProviders = useMemo(() => getSelectableCustomModelProviders(entries), [entries]);

  const handleOpenAdd = useCallback(() => {
    setEditorState({ mode: "add", model: null });
  }, []);
  const handleOpenEdit = useCallback((model: CustomModelEntry) => {
    setEditorState({ mode: "edit", model });
  }, []);
  const handleCloseEditor = useCallback(() => setEditorState(null), []);

  const handleSave = useCallback(
    async (input: {
      previousId: string | null;
      id: string;
      label: string;
      providerIds: string[];
    }) => {
      try {
        const patch = buildSaveCustomModelPatch({
          currentProviders: config?.providers,
          previousId: input.previousId,
          id: input.id,
          label: input.label,
          providerIds: input.providerIds,
        });
        await patchConfig(patch);
        const changedProviderIds = Object.keys(patch.providers ?? {});
        if (changedProviderIds.length > 0) {
          await refresh(changedProviderIds as AgentProvider[]);
        }
        setEditorState(null);
      } catch (error) {
        reportError({
          error,
          logLabel: "[CustomModels] Failed to save custom model",
          fallbackMessage: t("customModels.saveFailed"),
        });
      }
    },
    [config?.providers, patchConfig, refresh, reportError, t],
  );

  const handleDelete = useCallback(
    (model: CustomModelEntry) => {
      void (async () => {
        const confirmed = await confirmDialog({
          title: t("customModels.deleteConfirmTitle"),
          message: t("customModels.deleteConfirmMessage", { model: model.label }),
          confirmLabel: t("common.delete"),
          cancelLabel: t("common.cancel"),
          destructive: true,
        });
        if (!confirmed) {
          return;
        }

        setDeletingModelId(model.id);
        const patch = buildDeleteCustomModelPatch({
          currentProviders: config?.providers,
          id: model.id,
        });

        try {
          await patchConfig(patch);
          const changedProviderIds = Object.keys(patch.providers ?? {});
          if (changedProviderIds.length > 0) {
            await refresh(changedProviderIds as AgentProvider[]);
          }
        } catch (error) {
          reportError({
            error,
            logLabel: `[CustomModels] Failed to delete custom model ${model.id}`,
            fallbackMessage: t("customModels.deleteFailed"),
          });
        } finally {
          setDeletingModelId((current) => (current === model.id ? null : current));
        }
      })();
    },
    [config?.providers, patchConfig, refresh, reportError, t],
  );

  const headerActions = useMemo(
    () => (
      <Pressable
        onPress={handleOpenAdd}
        hitSlop={8}
        style={settingsStyles.sectionHeaderLink}
        accessibilityRole="button"
        accessibilityLabel={t("customModels.addCustomModel")}
        testID="add-custom-model-button"
      >
        <ThemedPlus size={ICON_SIZE.sm} uniProps={foregroundMutedColorMapping} />
        <Text style={settingsStyles.sectionHeaderLinkText}>{t("customModels.add")}</Text>
      </Pressable>
    ),
    [handleOpenAdd, t],
  );

  return (
    <>
      <SettingsSection
        title={t("customModels.title")}
        trailing={headerActions}
        testID="host-page-custom-models-card"
        style={styles.sectionSpacing}
      >
        {customModels.length > 0 ? (
          <View style={settingsStyles.card}>
            {customModels.map((model, index) => (
              <View key={model.id} style={index === 0 ? undefined : styles.modelRowBorder}>
                <CustomModelRow
                  model={model}
                  deleting={deletingModelId === model.id}
                  onEdit={handleOpenEdit}
                  onDelete={handleDelete}
                />
              </View>
            ))}
          </View>
        ) : (
          <View style={EMPTY_CARD_STYLE}>
            <Text style={styles.emptyText}>{t("customModels.empty")}</Text>
          </View>
        )}
      </SettingsSection>
      <CustomModelEditorSheet
        state={editorState}
        providers={selectableProviders}
        onClose={handleCloseEditor}
        onSave={handleSave}
      />
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  sectionSpacing: {
    marginBottom: theme.spacing[4],
  },
  emptyCard: {
    padding: theme.spacing[4],
  },
  emptyText: {
    color: theme.colors.foregroundMuted,
    fontSize: 12.5,
    lineHeight: 16,
  },
  modelRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[3],
    paddingVertical: theme.spacing[4],
    paddingHorizontal: theme.spacing[4],
  },
  modelRowBorder: {
    borderTopWidth: 1,
    // Soft quiet list divider (--border-soft).
    borderTopColor: theme.colors.secondary,
  },
  modelTextColumn: {
    flex: 1,
    minWidth: 0,
  },
  modelIdText: {
    color: theme.colors.foregroundMuted,
    fontSize: 12.5,
    lineHeight: 16,
    marginTop: theme.spacing[1],
  },
  rowActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  iconButton: {
    width: 30,
    height: 30,
    borderRadius: theme.borderRadius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  iconButtonHovered: {
    backgroundColor: theme.colors.surface1,
  },
  disabled: {
    opacity: theme.opacity[50],
  },
  formGroup: {
    gap: theme.spacing[4],
  },
  fieldGroup: {
    gap: theme.spacing[2],
  },
  formLabel: {
    color: theme.colors.foreground,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: theme.fontWeight.medium,
  },
  formInput: {
    backgroundColor: theme.colors.surface0,
    borderRadius: 12,
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
    color: theme.colors.foreground,
    borderWidth: 1,
    borderColor: theme.colors.border,
    fontSize: 13,
    lineHeight: 18,
  },
  providerToggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[3],
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
  },
  providerToggleBorder: {
    borderTopWidth: 1,
    // Soft quiet list divider (--border-soft).
    borderTopColor: theme.colors.secondary,
  },
  formActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: theme.spacing[2],
  },
}));

const EMPTY_CARD_STYLE = [settingsStyles.card, styles.emptyCard];
const FORM_INPUT_STYLE = [styles.formInput, isWeb && { outlineStyle: "none" }];
