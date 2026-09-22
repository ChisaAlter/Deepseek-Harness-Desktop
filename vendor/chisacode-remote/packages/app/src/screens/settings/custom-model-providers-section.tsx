import { Brain, Pencil, Plus, Trash2, Zap } from "lucide-react-native";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
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
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import { useUserVisibleErrorReporter } from "@/hooks/use-user-visible-error";
import { SettingsSection } from "@/screens/settings/settings-section";
import {
  buildDeleteSavedModelPatch,
  buildModelGatewayProviderIdList,
  buildSaveOpenAiCompatibleModelPatch,
  collectSavedModels,
  type CollectedSavedModel,
  type CustomModelProtocolPreset,
  type CustomModelProviderEndpoint,
  type CustomModelThinkingLevel,
  type CustomModelThinkingMode,
  type CustomOpenAIWireApi,
} from "@/screens/settings/custom-model-providers";
import { settingsStyles } from "@/styles/settings";
import { reportPresentedError, type ErrorLogger } from "@/utils/user-visible-error";
import type { AgentProvider } from "@chisacode/protocol/agent-types";
import type { MutableDaemonConfig } from "@chisacode/protocol/messages";

const ThemedPencil = withUnistyles(Pencil);
const ThemedTrash2 = withUnistyles(Trash2);
const ThemedPlus = withUnistyles(Plus);
const ThemedBrain = withUnistyles(Brain);
const ThemedZap = withUnistyles(Zap);

const foregroundMutedColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});
const destructiveColorMapping = (theme: Theme) => ({
  color: theme.colors.destructive,
});

const FLEX_1_STYLE = { flex: 1 };
const NOOP = () => undefined;

function DeleteModelSheetHeader(t: (key: string) => string): SheetHeader {
  return { title: t("customModelProviders.deleteConfirmTitle") };
}

function resolveTestTargetFormat(
  protocolPreset: CollectedSavedModel["protocolPreset"],
): "anthropic" | "chatCompletions" | "responses" | undefined {
  if (protocolPreset === "claude") {
    return "anthropic";
  }
  if (protocolPreset === "codex") {
    return "responses";
  }
  if (protocolPreset === "openai") {
    return "chatCompletions";
  }
  return undefined;
}

interface CustomModelProvidersSectionProps {
  serverId: string;
  errorLogger?: ErrorLogger;
}

interface EditingModelState {
  mode: "add" | "edit";
  model: CollectedSavedModel | null;
}

interface ModelEditorValues {
  baseUrl: string;
  apiKey: string;
  modelId: string;
  supportsTools: boolean;
  supportsImages: boolean;
  thinkingMode: CustomModelThinkingMode;
  thinkingLevels: CustomModelThinkingLevel[];
  protocolPreset: CustomModelProtocolPreset;
  attachToAllAgents: boolean;
  customProtocol: boolean;
  contextWindowText: string;
  anthropicEnabled: boolean;
  anthropicBaseUrl: string;
  anthropicApiKey: string;
  openaiEnabled: boolean;
  openaiBaseUrl: string;
  openaiApiKey: string;
  responsesEnabled: boolean;
  responsesBaseUrl: string;
  responsesApiKey: string;
}

const EDITOR_SNAP_POINTS = ["78%", "92%"];
const EDITOR_DESKTOP_MAX_WIDTH = 720;

function parseContextWindowText(value: string): number | undefined {
  const normalized = value.trim().replace(/[,，_\s]/gu, "");
  if (!normalized) {
    return undefined;
  }
  const numberValue = Number(normalized);
  if (!Number.isFinite(numberValue) || numberValue <= 0) {
    return undefined;
  }
  return Math.trunc(numberValue);
}

function createEmptyEditorValues(): ModelEditorValues {
  return {
    baseUrl: "",
    apiKey: "",
    modelId: "",
    supportsTools: true,
    supportsImages: false,
    thinkingMode: "off",
    thinkingLevels: [],
    protocolPreset: "openai",
    attachToAllAgents: true,
    customProtocol: false,
    contextWindowText: "",
    anthropicEnabled: false,
    anthropicBaseUrl: "",
    anthropicApiKey: "",
    openaiEnabled: true,
    openaiBaseUrl: "",
    openaiApiKey: "",
    responsesEnabled: false,
    responsesBaseUrl: "",
    responsesApiKey: "",
  };
}

function resolveProtocolSubtitle(values: ModelEditorValues, t: (key: string) => string): string {
  if (values.attachToAllAgents) {
    return t("customModelProviders.attachToAllAgentsSubtitle");
  }
  if (values.protocolPreset === "claude") {
    return t("customModelProviders.protocolClaudeHint");
  }
  if (values.protocolPreset === "codex") {
    return t("customModelProviders.protocolCodexHint");
  }
  return t("customModelProviders.protocolOpenaiHint");
}

function resolveProtocolPresetForEditor(
  model: CollectedSavedModel,
  flags: {
    anthropicEnabled: boolean;
    chatEnabled: boolean;
    responsesEnabled: boolean;
  },
): CustomModelProtocolPreset {
  const stored = model.protocolPreset;
  if (stored === "claude" || stored === "codex" || stored === "openai") {
    return stored;
  }
  if (flags.responsesEnabled && !flags.chatEnabled && !flags.anthropicEnabled) {
    return "codex";
  }
  if (flags.anthropicEnabled && !flags.chatEnabled && !flags.responsesEnabled) {
    return "claude";
  }
  return "openai";
}

function readGatewayApiKey(
  config: MutableDaemonConfig | null,
  gatewayId: string,
  upstream: "anthropic" | "chatCompletions" | "responses",
): string {
  const value = config?.modelGateways?.[gatewayId]?.upstreams?.[upstream]?.apiKey;
  return typeof value === "string" ? value : "";
}

function firstNonEmpty(...values: string[]): string {
  for (const value of values) {
    if (value) {
      return value;
    }
  }
  return "";
}

function resolvePrimaryUpstreamValue(
  chatEnabled: boolean,
  responsesEnabled: boolean,
  anthropicEnabled: boolean,
  chatValue: string,
  responsesValue: string,
  anthropicValue: string,
): string {
  return (
    firstNonEmpty(
      chatEnabled ? chatValue : "",
      responsesEnabled ? responsesValue : "",
      anthropicEnabled ? anthropicValue : "",
    ) || firstNonEmpty(chatValue, responsesValue, anthropicValue)
  );
}

function readUpstreamFlags(gateway: MutableDaemonConfig["modelGateways"][string] | undefined) {
  const anthropic = gateway?.upstreams?.anthropic;
  const chat = gateway?.upstreams?.chatCompletions;
  const responses = gateway?.upstreams?.responses;
  return {
    anthropicEnabled: anthropic?.enabled === true,
    chatEnabled: chat?.enabled === true,
    responsesEnabled: responses?.enabled === true,
    openaiEnabled: chat?.enabled !== false,
    chatBase: chat?.baseUrl ?? "",
    responsesBase: responses?.baseUrl ?? "",
    anthropicBase: anthropic?.baseUrl ?? "",
  };
}

function createEditorValuesFromSavedModel(
  model: CollectedSavedModel,
  config: MutableDaemonConfig | null,
): ModelEditorValues {
  const gateway = config?.modelGateways?.[model.gatewayId];
  const flags = readUpstreamFlags(gateway);
  const chatKey = readGatewayApiKey(config, model.gatewayId, "chatCompletions");
  const responsesKey = readGatewayApiKey(config, model.gatewayId, "responses");
  const anthropicKey = readGatewayApiKey(config, model.gatewayId, "anthropic");
  const primaryBaseUrl = resolvePrimaryUpstreamValue(
    flags.chatEnabled,
    flags.responsesEnabled,
    flags.anthropicEnabled,
    flags.chatBase,
    flags.responsesBase,
    flags.anthropicBase,
  );
  const primaryApiKey = resolvePrimaryUpstreamValue(
    flags.chatEnabled,
    flags.responsesEnabled,
    flags.anthropicEnabled,
    chatKey,
    responsesKey,
    anthropicKey,
  );
  const multiProtocol =
    Number(flags.anthropicEnabled) + Number(flags.chatEnabled) + Number(flags.responsesEnabled) > 1;

  return {
    baseUrl: primaryBaseUrl,
    apiKey: primaryApiKey,
    modelId: model.modelId,
    supportsTools: model.supportsTools === true,
    supportsImages: model.supportsImages === true,
    thinkingMode: model.thinkingMode ?? (model.supportsThinking === true ? "single" : "off"),
    thinkingLevels: (() => {
      const levels = (
        gateway?.models?.find((entry) => entry.id === model.modelId)?.thinkingOptions ?? []
      )
        .map((option) => option.id)
        .filter(
          (id): id is CustomModelThinkingLevel =>
            id === "low" || id === "medium" || id === "high" || id === "very-high" || id === "max",
        );
      return levels.length > 0 || model.supportsThinking !== true ? levels : ["medium"];
    })(),
    protocolPreset: resolveProtocolPresetForEditor(model, flags),
    attachToAllAgents: model.attachToAllAgents === true || multiProtocol,
    customProtocol: multiProtocol,
    contextWindowText:
      model.contextWindowMaxTokens === undefined ? "" : String(model.contextWindowMaxTokens),
    anthropicEnabled: flags.anthropicEnabled,
    anthropicBaseUrl: flags.anthropicBase,
    anthropicApiKey: anthropicKey,
    openaiEnabled: flags.openaiEnabled,
    openaiBaseUrl: flags.chatBase || primaryBaseUrl,
    openaiApiKey: chatKey || primaryApiKey,
    responsesEnabled: flags.responsesEnabled,
    responsesBaseUrl: flags.responsesBase,
    responsesApiKey: responsesKey,
  };
}

function SavedModelRow({
  model,
  deleting,
  onEdit,
  onDelete,
  onTest,
  testing,
  testResult,
}: {
  model: CollectedSavedModel;
  deleting: boolean;
  onEdit: (model: CollectedSavedModel) => void;
  onDelete: (model: CollectedSavedModel) => void;
  onTest: (model: CollectedSavedModel) => void;
  testing: boolean;
  testResult: { ok: boolean; durationMs: number; error: string | null } | null;
}) {
  const { t } = useTranslation();
  const handleEdit = useCallback(() => onEdit(model), [model, onEdit]);
  const handleDelete = useCallback(() => onDelete(model), [model, onDelete]);
  const handleTest = useCallback(() => onTest(model), [model, onTest]);
  const buttonStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.iconButton,
      (Boolean(hovered) || pressed) && styles.iconButtonHovered,
      deleting ? styles.disabled : null,
    ],
    [deleting],
  );

  let protocolLabel = t("customModelProviders.customBadge");
  if (model.protocolPreset === "claude") {
    protocolLabel = t("customModelProviders.protocolClaude");
  } else if (model.protocolPreset === "codex") {
    protocolLabel = t("customModelProviders.protocolCodex");
  } else if (model.protocolPreset === "openai") {
    protocolLabel = t("customModelProviders.protocolOpenai");
  }
  const supplyBadge =
    model.supplyScope === "all" || model.protocolPreset === "all"
      ? t("customModelProviders.allAgentsBadge")
      : t("customModelProviders.matchedAgentsBadge");

  return (
    <View style={styles.modelRow} testID={`saved-model-row-${model.gatewayId}-${model.modelId}`}>
      <View style={styles.modelLeading}>
        <View style={styles.modelBadgeIcon}>
          <ThemedPlus size={ICON_SIZE.sm} uniProps={foregroundMutedColorMapping} />
        </View>
        <View style={styles.modelTextColumn}>
          <Text style={settingsStyles.rowTitle} numberOfLines={1}>
            {model.label}
          </Text>
          <Text style={styles.modelSubtitle} numberOfLines={1}>
            {protocolLabel} · {supplyBadge}
            {model.gatewayLabel && model.gatewayLabel !== model.label
              ? ` · ${model.gatewayLabel}`
              : ""}
          </Text>
          <View style={styles.badgeRow}>
            {model.supportsTools ? (
              <Text style={styles.capabilityBadge}>
                {t("customModelProviders.supportsToolsBadge")}
              </Text>
            ) : null}
            {model.supportsImages ? (
              <Text style={styles.capabilityBadge}>
                {t("customModelProviders.supportsImagesBadge")}
              </Text>
            ) : null}
            {model.supportsThinking ? (
              <Text style={styles.capabilityBadge}>
                {t("customModelProviders.supportsThinkingBadge")}
              </Text>
            ) : null}
          </View>
        </View>
      </View>
      <View style={styles.rowActions}>
        <Pressable
          onPress={handleTest}
          disabled={testing || deleting}
          hitSlop={8}
          style={buttonStyle}
          accessibilityRole="button"
          accessibilityLabel={t("customModelProviders.testModel", { model: model.label })}
          testID={`test-saved-model-${model.gatewayId}-${model.modelId}`}
        >
          <ThemedZap size={ICON_SIZE.sm} uniProps={foregroundMutedColorMapping} />
        </Pressable>
        {testResult ? (
          <Text style={testResult.ok ? styles.testResultOk : styles.testResultError}>
            {testResult.ok
              ? t("customModelProviders.testLatency", { latency: testResult.durationMs })
              : t("customModelProviders.testUnavailable")}
          </Text>
        ) : null}
        <Pressable
          onPress={handleEdit}
          hitSlop={8}
          style={buttonStyle}
          accessibilityRole="button"
          accessibilityLabel={t("customModelProviders.editModel", { model: model.label })}
          testID={`edit-saved-model-${model.gatewayId}-${model.modelId}`}
        >
          <ThemedPencil size={ICON_SIZE.sm} uniProps={foregroundMutedColorMapping} />
        </Pressable>
        <Pressable
          onPress={handleDelete}
          disabled={deleting}
          hitSlop={8}
          style={buttonStyle}
          accessibilityRole="button"
          accessibilityLabel={t("customModelProviders.deleteModel", { model: model.label })}
          testID={`delete-saved-model-${model.gatewayId}-${model.modelId}`}
        >
          <ThemedTrash2 size={ICON_SIZE.sm} uniProps={destructiveColorMapping} />
        </Pressable>
      </View>
    </View>
  );
}

const ACCESSIBILITY_CHECKED = { checked: true } as const;
const ACCESSIBILITY_UNCHECKED = { checked: false } as const;

function CapabilityToggle({
  label,
  value,
  onChange,
  testID,
}: {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
  testID?: string;
}) {
  const handlePress = useCallback(() => {
    onChange(!value);
  }, [onChange, value]);
  const accessibilityState = value ? ACCESSIBILITY_CHECKED : ACCESSIBILITY_UNCHECKED;
  const checkboxStyle = value ? CHECKBOX_STYLE_CHECKED : CHECKBOX_STYLE_UNCHECKED;

  return (
    <Pressable
      onPress={handlePress}
      style={styles.capabilityChip}
      accessibilityRole="checkbox"
      accessibilityState={accessibilityState}
      testID={testID}
    >
      <View style={checkboxStyle}>{value ? <Text style={styles.checkboxMark}>✓</Text> : null}</View>
      <Text style={styles.capabilityLabel}>{label}</Text>
    </Pressable>
  );
}

function ChoiceChip({
  label,
  selected,
  onPress,
  testID,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  testID?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={selected ? styles.presetChipSelected : styles.presetChip}
      accessibilityRole="radio"
      accessibilityState={selected ? ACCESSIBILITY_CHECKED : ACCESSIBILITY_UNCHECKED}
      testID={testID}
    >
      <Text style={selected ? styles.presetChipTextSelected : styles.presetChipText}>{label}</Text>
    </Pressable>
  );
}

function ThinkingLevelToggle({
  option,
  selected,
  onToggle,
}: {
  option: { id: CustomModelThinkingLevel; label: string; english: string };
  selected: boolean;
  onToggle: (level: CustomModelThinkingLevel) => void;
}) {
  const handleChange = useCallback(() => onToggle(option.id), [onToggle, option.id]);
  return (
    <CapabilityToggle
      label={`${option.label} (${option.english})`}
      value={selected}
      onChange={handleChange}
      testID={`thinking-level-${option.id}`}
    />
  );
}

function ThinkingLevelsField({
  selected,
  onToggle,
}: {
  selected: CustomModelThinkingLevel[];
  onToggle: (level: CustomModelThinkingLevel) => void;
}) {
  const { t } = useTranslation();
  const options: Array<{ id: CustomModelThinkingLevel; label: string; english: string }> = [
    { id: "low", label: t("customModelProviders.thinkingLow"), english: "Low" },
    { id: "medium", label: t("customModelProviders.thinkingMedium"), english: "Medium" },
    { id: "high", label: t("customModelProviders.thinkingHigh"), english: "High" },
    { id: "very-high", label: t("customModelProviders.thinkingVeryHigh"), english: "Very High" },
    { id: "max", label: t("customModelProviders.thinkingMax"), english: "Max" },
  ];
  const selectedSet = new Set(selected);
  return (
    <View style={styles.fieldGroup}>
      <Text style={styles.formLabel}>{t("customModelProviders.thinkingMode")}</Text>
      <Text style={styles.fieldHint}>{t("customModelProviders.thinkingModeHint")}</Text>
      <View style={styles.thinkingLevelsGrid}>
        {options.map((option) => (
          <ThinkingLevelToggle
            key={option.id}
            option={option}
            selected={selectedSet.has(option.id)}
            onToggle={onToggle}
          />
        ))}
      </View>
    </View>
  );
}

function SupplyScopeField({
  attachToAllAgents,
  onSelectAll,
  onSelectMatched,
  scopeSupported,
  locked,
}: {
  attachToAllAgents: boolean;
  onSelectAll: () => void;
  onSelectMatched: () => void;
  scopeSupported: boolean;
  locked?: boolean;
}) {
  const { t } = useTranslation();
  if (!scopeSupported || locked) {
    return (
      <View style={styles.fieldGroup}>
        <Text style={styles.formLabel}>{t("customModelProviders.supplyScope")}</Text>
        <Text style={styles.fieldHint}>{t("customModelProviders.legacySupplyScopeHint")}</Text>
        <ChoiceChip
          label={t("customModelProviders.supplyAll")}
          selected
          onPress={NOOP}
          testID="supply-scope-legacy-all"
        />
      </View>
    );
  }
  return (
    <View style={styles.fieldGroup}>
      <Text style={styles.formLabel}>{t("customModelProviders.supplyScope")}</Text>
      <Text style={styles.fieldHint}>{t("customModelProviders.supplyScopeHint")}</Text>
      <View style={styles.presetRow}>
        <ChoiceChip
          label={t("customModelProviders.supplyAll")}
          selected={attachToAllAgents}
          onPress={onSelectAll}
          testID="supply-scope-all"
        />
        <ChoiceChip
          label={t("customModelProviders.supplyMatched")}
          selected={!attachToAllAgents}
          onPress={onSelectMatched}
          testID="supply-scope-matched"
        />
      </View>
      {attachToAllAgents ? (
        <Text style={styles.fieldHint}>{t("customModelProviders.attachToAllAgentsHint")}</Text>
      ) : null}
    </View>
  );
}

function EndpointFields({
  title,
  enabled,
  baseUrl,
  apiKey,
  resetPrefix,
  baseUrlPlaceholder,
  apiKeyPlaceholder,
  onEnabledChange,
  onBaseUrlChange,
  onApiKeyChange,
}: {
  title: string;
  enabled: boolean;
  baseUrl: string;
  apiKey: string;
  resetPrefix: string;
  baseUrlPlaceholder: string;
  apiKeyPlaceholder: string;
  onEnabledChange: (value: boolean) => void;
  onBaseUrlChange: (value: string) => void;
  onApiKeyChange: (value: string) => void;
}) {
  return (
    <View style={styles.endpointCard}>
      <View style={styles.endpointHeader}>
        <Text style={settingsStyles.rowTitle}>{title}</Text>
        <Switch value={enabled} onValueChange={onEnabledChange} />
      </View>
      {enabled ? (
        <>
          <AdaptiveTextInput
            initialValue={baseUrl}
            resetKey={`${resetPrefix}-base`}
            onChangeText={onBaseUrlChange}
            placeholder={baseUrlPlaceholder}
            autoCapitalize="none"
            // @ts-expect-error - outlineStyle is web-only
            style={FORM_INPUT_STYLE}
          />
          <AdaptiveTextInput
            initialValue={apiKey}
            resetKey={`${resetPrefix}-key`}
            onChangeText={onApiKeyChange}
            placeholder={apiKeyPlaceholder}
            secureTextEntry
            autoCapitalize="none"
            // @ts-expect-error - outlineStyle is web-only
            style={FORM_INPUT_STYLE}
          />
        </>
      ) : null}
    </View>
  );
}

function ModelEditorSheet({
  state,
  config,
  onClose,
  onSave,
  errorLogger,
  scopeSupported,
}: {
  state: EditingModelState | null;
  config: MutableDaemonConfig | null;
  onClose: () => void;
  onSave: (values: ModelEditorValues, previous: CollectedSavedModel | null) => Promise<void>;
  errorLogger?: ErrorLogger;
  scopeSupported: boolean;
}) {
  const { t } = useTranslation();
  const [values, setValues] = useState<ModelEditorValues>(createEmptyEditorValues);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const visible = state !== null;
  const previous = state?.model ?? null;
  const resetSeed = `${previous?.gatewayId ?? "new"}-${previous?.modelId ?? "new"}-${state?.mode ?? "closed"}`;

  useEffect(() => {
    if (!state) {
      return;
    }
    setValues(
      state.model
        ? createEditorValuesFromSavedModel(state.model, config)
        : createEmptyEditorValues(),
    );
    setFormError(null);
    setSaving(false);
  }, [config, state]);

  const setField = useCallback(
    <K extends keyof ModelEditorValues>(key: K, value: ModelEditorValues[K]) => {
      setValues((current) => ({ ...current, [key]: value }));
    },
    [],
  );

  const handleBaseUrlChange = useCallback(
    (value: string) => setField("baseUrl", value),
    [setField],
  );
  const handleApiKeyChange = useCallback((value: string) => setField("apiKey", value), [setField]);
  const handleModelIdChange = useCallback(
    (value: string) => setField("modelId", value),
    [setField],
  );
  const handleContextWindowChange = useCallback(
    (value: string) => setField("contextWindowText", value),
    [setField],
  );
  const handleSupportsToolsChange = useCallback(
    (value: boolean) => setField("supportsTools", value),
    [setField],
  );
  const handleSupportsImagesChange = useCallback(
    (value: boolean) => setField("supportsImages", value),
    [setField],
  );
  const handleSelectProtocolOpenai = useCallback(() => {
    setValues((current) => ({
      ...current,
      protocolPreset: "openai",
      customProtocol: false,
    }));
  }, []);
  const handleSelectProtocolCodex = useCallback(() => {
    setValues((current) => ({
      ...current,
      protocolPreset: "codex",
      customProtocol: false,
    }));
  }, []);
  const handleSelectProtocolClaude = useCallback(() => {
    setValues((current) => ({
      ...current,
      protocolPreset: "claude",
      customProtocol: false,
    }));
  }, []);
  const handleSelectSupplyAll = useCallback(() => setField("attachToAllAgents", true), [setField]);
  const handleSelectSupplyMatched = useCallback(
    () => setField("attachToAllAgents", false),
    [setField],
  );
  const handleCustomProtocolChange = useCallback(
    (value: boolean) => setField("customProtocol", value),
    [setField],
  );
  const handleToggleThinkingLevel = useCallback(
    (level: CustomModelThinkingLevel) => {
      setField(
        "thinkingLevels",
        values.thinkingLevels.includes(level)
          ? values.thinkingLevels.filter((current) => current !== level)
          : [...values.thinkingLevels, level],
      );
    },
    [setField, values.thinkingLevels],
  );

  const handleAnthropicEnabledChange = useCallback(
    (value: boolean) => setField("anthropicEnabled", value),
    [setField],
  );
  const handleAnthropicBaseUrlChange = useCallback(
    (value: string) => setField("anthropicBaseUrl", value),
    [setField],
  );
  const handleAnthropicApiKeyChange = useCallback(
    (value: string) => setField("anthropicApiKey", value),
    [setField],
  );
  const handleOpenaiEnabledChange = useCallback(
    (value: boolean) => setField("openaiEnabled", value),
    [setField],
  );
  const handleOpenaiBaseUrlChange = useCallback(
    (value: string) => setField("openaiBaseUrl", value),
    [setField],
  );
  const handleOpenaiApiKeyChange = useCallback(
    (value: string) => setField("openaiApiKey", value),
    [setField],
  );
  const handleResponsesEnabledChange = useCallback(
    (value: boolean) => setField("responsesEnabled", value),
    [setField],
  );
  const handleResponsesBaseUrlChange = useCallback(
    (value: string) => setField("responsesBaseUrl", value),
    [setField],
  );
  const handleResponsesApiKeyChange = useCallback(
    (value: string) => setField("responsesApiKey", value),
    [setField],
  );

  const handleSave = useCallback(() => {
    if (saving) {
      return;
    }
    setFormError(null);
    setSaving(true);
    void onSave(values, previous)
      .catch((error) => {
        reportPresentedError({
          error,
          logLabel: "[CustomModelProviders] Failed to save custom model",
          fallbackMessage: t("customModelProviders.saveFailed"),
          present: setFormError,
          logger: errorLogger,
        });
      })
      .finally(() => setSaving(false));
  }, [errorLogger, onSave, previous, saving, t, values]);

  const protocolSubtitle = resolveProtocolSubtitle(values, t);

  const header = useMemo<SheetHeader>(
    () => ({
      title:
        state?.mode === "edit"
          ? t("customModelProviders.editCustomModel")
          : t("customModelProviders.addCustomModel"),
      subtitle: values.customProtocol ? t("customModelProviders.openaiOnlyHint") : protocolSubtitle,
    }),
    [protocolSubtitle, state?.mode, t, values.customProtocol],
  );

  const canSave = values.modelId.trim().length > 0 && !saving;
  const baseUrlPlaceholder = "https://api.example.com/v1";

  return (
    <AdaptiveModalSheet
      header={header}
      visible={visible}
      onClose={onClose}
      desktopMaxWidth={EDITOR_DESKTOP_MAX_WIDTH}
      snapPoints={EDITOR_SNAP_POINTS}
      testID="custom-model-editor-sheet"
    >
      <View style={styles.formGroup}>
        <View style={styles.fieldGroup}>
          <Text style={styles.formLabel}>{t("customModelProviders.protocolPreset")}</Text>
          <Text style={styles.fieldHint}>{t("customModelProviders.protocolPresetHint")}</Text>
          <View style={styles.presetRow}>
            <ChoiceChip
              label={t("customModelProviders.protocolOpenai")}
              selected={values.protocolPreset === "openai" && !values.customProtocol}
              onPress={handleSelectProtocolOpenai}
              testID="protocol-preset-openai"
            />
            <ChoiceChip
              label={t("customModelProviders.protocolCodex")}
              selected={values.protocolPreset === "codex" && !values.customProtocol}
              onPress={handleSelectProtocolCodex}
              testID="protocol-preset-codex"
            />
            <ChoiceChip
              label={t("customModelProviders.protocolClaude")}
              selected={values.protocolPreset === "claude" && !values.customProtocol}
              onPress={handleSelectProtocolClaude}
              testID="protocol-preset-claude"
            />
          </View>
        </View>

        {!values.customProtocol ? (
          <SupplyScopeField
            attachToAllAgents={values.attachToAllAgents}
            onSelectAll={handleSelectSupplyAll}
            onSelectMatched={handleSelectSupplyMatched}
            scopeSupported={scopeSupported}
            locked={false}
          />
        ) : (
          <SupplyScopeField
            attachToAllAgents
            onSelectAll={NOOP}
            onSelectMatched={NOOP}
            scopeSupported={scopeSupported}
            locked
          />
        )}

        {!values.customProtocol ? (
          <View style={styles.fieldRow}>
            <View style={styles.fieldGroupGrow}>
              <Text style={styles.formLabel}>{t("customModelProviders.baseUrl")}</Text>
              <AdaptiveTextInput
                initialValue={values.baseUrl}
                resetKey={`base-url-${resetSeed}`}
                onChangeText={handleBaseUrlChange}
                placeholder={baseUrlPlaceholder}
                autoCapitalize="none"
                autoCorrect={false}
                testID="custom-model-base-url-input"
                // @ts-expect-error - outlineStyle is web-only
                style={FORM_INPUT_STYLE}
              />
            </View>
            <View style={styles.fieldGroupGrow}>
              <Text style={styles.formLabel}>{t("customModelProviders.apiKey")}</Text>
              <AdaptiveTextInput
                initialValue={values.apiKey}
                resetKey={`api-key-${resetSeed}`}
                onChangeText={handleApiKeyChange}
                placeholder={t("customModelProviders.apiKeyPlaceholder")}
                secureTextEntry
                autoCapitalize="none"
                testID="custom-model-api-key-input"
                // @ts-expect-error - outlineStyle is web-only
                style={FORM_INPUT_STYLE}
              />
            </View>
          </View>
        ) : null}

        <View style={styles.fieldRow}>
          <View style={styles.fieldGroupGrow}>
            <Text style={styles.formLabel}>{t("customModelProviders.modelName")}</Text>
            <AdaptiveTextInput
              initialValue={values.modelId}
              resetKey={`model-id-${resetSeed}`}
              onChangeText={handleModelIdChange}
              placeholder={t("customModelProviders.modelNamePlaceholder")}
              autoCapitalize="none"
              autoCorrect={false}
              testID="custom-model-id-input"
              // @ts-expect-error - outlineStyle is web-only
              style={FORM_INPUT_STYLE}
            />
          </View>
          <View style={styles.fieldGroupGrow}>
            <Text style={styles.formLabel}>{t("customModelProviders.inputContext")}</Text>
            <AdaptiveTextInput
              initialValue={values.contextWindowText}
              resetKey={`context-window-${resetSeed}`}
              onChangeText={handleContextWindowChange}
              placeholder={t("customModelProviders.contextPlaceholder")}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="number-pad"
              testID="custom-model-context-input"
              // @ts-expect-error - outlineStyle is web-only
              style={FORM_INPUT_STYLE}
            />
          </View>
        </View>

        <ThinkingLevelsField
          selected={values.thinkingLevels}
          onToggle={handleToggleThinkingLevel}
        />

        <View style={styles.fieldGroup}>
          <Text style={styles.formLabel}>{t("customModelProviders.advanced")}</Text>
          <View style={styles.capabilityGrid}>
            <CapabilityToggle
              label={t("customModelProviders.supportsTools")}
              value={values.supportsTools}
              onChange={handleSupportsToolsChange}
              testID="capability-tools"
            />
            <CapabilityToggle
              label={t("customModelProviders.supportsImages")}
              value={values.supportsImages}
              onChange={handleSupportsImagesChange}
              testID="capability-images"
            />
            <CapabilityToggle
              label={t("customModelProviders.customProtocol")}
              value={values.customProtocol}
              onChange={handleCustomProtocolChange}
              testID="capability-custom-protocol"
            />
          </View>
        </View>

        {values.customProtocol ? (
          <View style={styles.protocolStack}>
            <EndpointFields
              title={t("customModelProviders.anthropicEndpoint")}
              enabled={values.anthropicEnabled}
              baseUrl={values.anthropicBaseUrl}
              apiKey={values.anthropicApiKey}
              resetPrefix={`anthropic-${resetSeed}`}
              baseUrlPlaceholder="https://api.example.com/anthropic"
              apiKeyPlaceholder={t("customModelProviders.apiKey")}
              onEnabledChange={handleAnthropicEnabledChange}
              onBaseUrlChange={handleAnthropicBaseUrlChange}
              onApiKeyChange={handleAnthropicApiKeyChange}
            />
            <EndpointFields
              title={t("customModelProviders.openaiEndpoint")}
              enabled={values.openaiEnabled}
              baseUrl={values.openaiBaseUrl}
              apiKey={values.openaiApiKey}
              resetPrefix={`openai-${resetSeed}`}
              baseUrlPlaceholder="https://api.example.com/v1"
              apiKeyPlaceholder={t("customModelProviders.apiKey")}
              onEnabledChange={handleOpenaiEnabledChange}
              onBaseUrlChange={handleOpenaiBaseUrlChange}
              onApiKeyChange={handleOpenaiApiKeyChange}
            />
            <EndpointFields
              title={t("customModelProviders.responsesEndpoint")}
              enabled={values.responsesEnabled}
              baseUrl={values.responsesBaseUrl}
              apiKey={values.responsesApiKey}
              resetPrefix={`responses-${resetSeed}`}
              baseUrlPlaceholder="https://api.example.com/v1"
              apiKeyPlaceholder={t("customModelProviders.apiKey")}
              onEnabledChange={handleResponsesEnabledChange}
              onBaseUrlChange={handleResponsesBaseUrlChange}
              onApiKeyChange={handleResponsesApiKeyChange}
            />
          </View>
        ) : null}

        {formError ? <Text style={styles.formError}>{formError}</Text> : null}

        <View style={styles.formActions}>
          <Button variant="secondary" size="sm" onPress={onClose} disabled={saving}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="default"
            size="sm"
            onPress={handleSave}
            disabled={!canSave}
            loading={saving}
            testID="custom-model-save-button"
          >
            {saving ? t("customModelProviders.saving") : t("common.save")}
          </Button>
        </View>
      </View>
    </AdaptiveModalSheet>
  );
}

export function CustomModelProvidersSection({
  serverId,
  errorLogger,
}: CustomModelProvidersSectionProps) {
  const { t } = useTranslation();
  const reportError = useUserVisibleErrorReporter();
  const { config, patchConfig } = useDaemonConfig(serverId);
  const { refresh } = useProvidersSnapshot(serverId);
  const client = useHostRuntimeClient(serverId);
  const supplyScopeSupported = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.modelGatewaySupplyScope === true,
  );
  const [editorState, setEditorState] = useState<EditingModelState | null>(null);
  const [deletingKey, setDeletingKey] = useState<string | null>(null);
  const [pendingDeleteModel, setPendingDeleteModel] = useState<CollectedSavedModel | null>(null);
  const [testingKey, setTestingKey] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<
    Record<string, { ok: boolean; durationMs: number; error: string | null }>
  >({});

  const savedModels = useMemo(
    () => collectSavedModels(config?.modelGateways),
    [config?.modelGateways],
  );

  const openAdd = useCallback(() => setEditorState({ mode: "add", model: null }), []);
  const openEdit = useCallback(
    (model: CollectedSavedModel) => setEditorState({ mode: "edit", model }),
    [],
  );
  const closeEditor = useCallback(() => setEditorState(null), []);

  const deleteSheetHeader = useMemo(() => DeleteModelSheetHeader(t), [t]);

  const handleSave = useCallback(
    async (values: ModelEditorValues, previous: CollectedSavedModel | null) => {
      const anthropic: CustomModelProviderEndpoint = {
        enabled: values.anthropicEnabled,
        baseUrl: values.anthropicBaseUrl,
        apiKey: values.anthropicApiKey,
      };
      const openai = {
        enabled: values.openaiEnabled,
        baseUrl: values.openaiBaseUrl,
        apiKey: values.openaiApiKey,
        wireApi: "chat" as CustomOpenAIWireApi,
      };
      const responses: CustomModelProviderEndpoint = {
        enabled: values.responsesEnabled,
        baseUrl: values.responsesBaseUrl,
        apiKey: values.responsesApiKey,
      };

      const patch = buildSaveOpenAiCompatibleModelPatch({
        currentGateways: config?.modelGateways,
        gatewayId: previous?.gatewayId,
        previousModelId: previous?.modelId,
        modelId: values.modelId,
        label: values.modelId,
        baseUrl: values.baseUrl,
        apiKey: values.apiKey,
        contextWindowMaxTokens: parseContextWindowText(values.contextWindowText),
        supportsImages: values.supportsImages,
        supportsTools: values.supportsTools,
        thinkingMode: values.thinkingMode,
        thinkingLevels: values.thinkingLevels,
        protocolPreset: values.protocolPreset,
        supplyScope: values.attachToAllAgents ? "all" : "matched",
        supplyScopeSupported,
        attachToAllAgents: values.attachToAllAgents,
        customProtocol: values.customProtocol,
        anthropic,
        openai,
        responses,
      });

      const updatedConfig = await patchConfig(patch);
      if (!updatedConfig) {
        throw new Error(t("customModelProviders.saveUnavailable"));
      }
      setEditorState(null);

      const gatewayIds = Object.keys(patch.modelGateways ?? {});
      const providerIds = gatewayIds.flatMap((gatewayId) =>
        buildModelGatewayProviderIdList(gatewayId, {
          protocolPreset: values.protocolPreset,
          supplyScope: values.attachToAllAgents ? "all" : "matched",
          attachToAllAgents: values.attachToAllAgents,
        }),
      );
      if (providerIds.length > 0) {
        void refresh(providerIds as AgentProvider[]).catch((error) => {
          console.warn("[CustomModelProviders] Failed to refresh providers after save", error);
        });
      }
    },
    [config?.modelGateways, patchConfig, refresh, supplyScopeSupported, t],
  );

  const handleTestModel = useCallback(
    (model: CollectedSavedModel) => {
      if (testingKey || !client) {
        if (!client) {
          setTestResults((current) => ({
            ...current,
            [model.key]: { ok: false, durationMs: 0, error: "Host is not connected" },
          }));
        }
        return;
      }
      const updateResult = (response: Awaited<ReturnType<typeof client.runModelGatewayTest>>) => {
        const result = response.result;
        setTestResults((current) => ({
          ...current,
          [model.key]: result
            ? {
                ok: result.ok,
                durationMs: result.durationMs,
                error: result.error ?? response.error,
              }
            : { ok: false, durationMs: 0, error: response.error ?? "Model gateway test failed" },
        }));
      };
      void client
        .runModelGatewayTest({
          gatewayId: model.gatewayId,
          modelId: model.modelId,
          targetFormat: resolveTestTargetFormat(model.protocolPreset),
        })
        .then(updateResult)
        .catch((error) => {
          setTestResults((current) => ({
            ...current,
            [model.key]: {
              ok: false,
              durationMs: 0,
              error: error instanceof Error ? error.message : String(error),
            },
          }));
        })
        .finally(() => {
          setTestingKey((current) => (current === model.key ? null : current));
        });
    },
    [client, testingKey],
  );

  const handleRequestDelete = useCallback((model: CollectedSavedModel) => {
    setPendingDeleteModel(model);
  }, []);

  const handleCloseDeleteConfirm = useCallback(() => {
    if (deletingKey) {
      return;
    }
    setPendingDeleteModel(null);
  }, [deletingKey]);

  const handleCancelDelete = useCallback(() => {
    if (deletingKey) {
      return;
    }
    setPendingDeleteModel(null);
  }, [deletingKey]);

  const handleConfirmDelete = useCallback(() => {
    if (!pendingDeleteModel || deletingKey) {
      return;
    }
    const model = pendingDeleteModel;
    setDeletingKey(model.key);
    void (async () => {
      try {
        const patch = buildDeleteSavedModelPatch({
          currentGateways: config?.modelGateways,
          gatewayId: model.gatewayId,
          modelId: model.modelId,
          supplyScopeSupported,
        });
        const updatedConfig = await patchConfig(patch);
        if (!updatedConfig) {
          throw new Error(t("customModelProviders.deleteFailed"));
        }
        setPendingDeleteModel(null);
        void refresh(model.providerIds as AgentProvider[]).catch((error) => {
          console.warn("[CustomModelProviders] Failed to refresh providers after delete", error);
        });
      } catch (error) {
        reportError({
          error,
          logLabel: `[CustomModelProviders] Failed to delete model ${model.modelId}`,
          fallbackMessage: t("customModelProviders.deleteFailed"),
        });
      } finally {
        setDeletingKey((current) => (current === model.key ? null : current));
      }
    })();
  }, [
    config?.modelGateways,
    deletingKey,
    patchConfig,
    pendingDeleteModel,
    refresh,
    reportError,
    supplyScopeSupported,
    t,
  ]);

  const headerActions = useMemo(
    () => (
      <Pressable
        onPress={openAdd}
        hitSlop={8}
        style={settingsStyles.sectionHeaderLink}
        accessibilityRole="button"
        accessibilityLabel={t("customModelProviders.addCustomModel")}
        testID="add-custom-model-button"
      >
        <ThemedPlus size={ICON_SIZE.sm} uniProps={foregroundMutedColorMapping} />
        <Text style={settingsStyles.sectionHeaderLinkText}>
          {t("customModelProviders.addModel")}
        </Text>
      </Pressable>
    ),
    [openAdd, t],
  );

  return (
    <>
      <SettingsSection
        title={t("customModelProviders.title")}
        trailing={headerActions}
        style={styles.sectionSpacing}
        testID="settings-custom-models-section"
      >
        <Text style={settingsStyles.rowHint}>{t("customModelProviders.sectionHint")}</Text>

        <Text style={styles.listHeading}>{t("customModelProviders.savedModels")}</Text>

        {savedModels.length > 0 ? (
          <View style={settingsStyles.card}>
            {savedModels.map((model, index) => (
              <View key={model.key} style={index === 0 ? undefined : styles.modelRowBorder}>
                <SavedModelRow
                  model={model}
                  deleting={deletingKey === model.key}
                  onEdit={openEdit}
                  onDelete={handleRequestDelete}
                  onTest={handleTestModel}
                  testing={testingKey === model.key}
                  testResult={testResults[model.key] ?? null}
                />
              </View>
            ))}
          </View>
        ) : (
          <View style={EMPTY_CARD_STYLE}>
            <ThemedBrain size={ICON_SIZE.md} uniProps={foregroundMutedColorMapping} />
            <Text style={styles.emptyText}>{t("customModelProviders.empty")}</Text>
          </View>
        )}
      </SettingsSection>

      <ModelEditorSheet
        state={editorState}
        config={config}
        onClose={closeEditor}
        onSave={handleSave}
        errorLogger={errorLogger}
        scopeSupported={supplyScopeSupported}
      />

      {pendingDeleteModel ? (
        <AdaptiveModalSheet
          header={deleteSheetHeader}
          visible
          onClose={handleCloseDeleteConfirm}
          testID="delete-saved-model-confirm-modal"
        >
          <Text style={styles.confirmText}>
            {t("customModelProviders.deleteConfirmMessage", {
              model: pendingDeleteModel.label,
            })}
          </Text>
          <View style={styles.confirmActions}>
            <Button
              variant="secondary"
              size="sm"
              style={FLEX_1_STYLE}
              onPress={handleCancelDelete}
              disabled={Boolean(deletingKey)}
            >
              {t("common.cancel")}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              style={FLEX_1_STYLE}
              onPress={handleConfirmDelete}
              disabled={Boolean(deletingKey)}
              loading={Boolean(deletingKey)}
              testID="delete-saved-model-confirm"
            >
              {t("common.delete")}
            </Button>
          </View>
        </AdaptiveModalSheet>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  sectionSpacing: {
    marginBottom: theme.spacing[4],
  },
  listHeading: {
    color: theme.colors.foregroundMuted,
    fontSize: 12.5,
    lineHeight: 16,
    fontWeight: theme.fontWeight.medium,
    marginTop: theme.spacing[3],
    marginBottom: theme.spacing[2],
  },
  fieldHint: {
    color: theme.colors.foregroundMuted,
    fontSize: 12,
    lineHeight: 16,
    marginBottom: theme.spacing[2],
  },
  presetRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[2],
  },
  presetChip: {
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface0,
  },
  presetChipSelected: {
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.colors.primary,
    backgroundColor: theme.colors.surface1,
  },
  presetChipText: {
    color: theme.colors.foregroundMuted,
    fontSize: 12.5,
    lineHeight: 16,
    fontWeight: theme.fontWeight.medium,
  },
  presetChipTextSelected: {
    color: theme.colors.primary,
    fontSize: 12.5,
    lineHeight: 16,
    fontWeight: theme.fontWeight.medium,
  },
  badgeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[1],
    marginTop: theme.spacing[1],
  },
  capabilityBadge: {
    color: theme.colors.foregroundMuted,
    fontSize: 11,
    lineHeight: 14,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.colors.border,
    overflow: "hidden",
  },
  emptyCard: {
    padding: theme.spacing[4],
    gap: theme.spacing[2],
    alignItems: "center",
  },
  emptyText: {
    color: theme.colors.foregroundMuted,
    fontSize: 12.5,
    lineHeight: 16,
  },
  confirmText: {
    color: theme.colors.foregroundMuted,
    fontSize: 13,
    lineHeight: 18,
  },
  confirmActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    marginTop: theme.spacing[4],
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
  modelLeading: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
  },
  modelBadgeIcon: {
    width: 28,
    height: 28,
    borderRadius: theme.borderRadius.full,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  modelTextColumn: {
    flex: 1,
    minWidth: 0,
    gap: theme.spacing[1],
  },
  modelSubtitle: {
    color: theme.colors.foregroundMuted,
    fontSize: 12.5,
    lineHeight: 16,
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
  testResultOk: {
    color: theme.colors.success,
    fontSize: 11,
    lineHeight: 14,
  },
  testResultError: {
    color: theme.colors.destructive,
    fontSize: 11,
    lineHeight: 14,
  },
  formGroup: {
    gap: theme.spacing[4],
  },
  fieldRow: {
    flexDirection: "row",
    gap: theme.spacing[3],
  },
  fieldGroup: {
    gap: theme.spacing[2],
  },
  fieldGroupGrow: {
    flex: 1,
    minWidth: 0,
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
  thinkingLevelsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[2],
  },
  capabilityGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[3],
  },
  capabilityChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[1],
    minWidth: 140,
  },
  checkbox: {
    width: 18,
    height: 18,
    borderRadius: theme.borderRadius.base,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.surface0,
  },
  checkboxChecked: {
    backgroundColor: theme.colors.foreground,
    borderColor: theme.colors.foreground,
  },
  checkboxMark: {
    color: theme.colors.surface0,
    fontSize: 12.5,
    fontWeight: theme.fontWeight.medium,
    lineHeight: 16,
  },
  capabilityLabel: {
    color: theme.colors.foreground,
    fontSize: 13,
    lineHeight: 18,
  },
  protocolStack: {
    gap: theme.spacing[3],
  },
  endpointCard: {
    gap: theme.spacing[3],
    padding: theme.spacing[3],
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface0,
  },
  endpointHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[3],
  },
  formError: {
    color: theme.colors.destructive,
    fontSize: 12.5,
    lineHeight: 16,
  },
  formActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: theme.spacing[2],
  },
}));

const EMPTY_CARD_STYLE = [settingsStyles.card, styles.emptyCard];
const FORM_INPUT_STYLE = [styles.formInput, isWeb && { outlineStyle: "none" }];
const CHECKBOX_STYLE_CHECKED = [styles.checkbox, styles.checkboxChecked];
const CHECKBOX_STYLE_UNCHECKED = [styles.checkbox];
