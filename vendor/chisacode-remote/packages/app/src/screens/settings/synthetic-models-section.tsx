/* eslint-disable react-hooks/exhaustive-deps */
import type { ModelGatewayMoaTestResponseMessage } from "@chisacode/protocol/messages";
import type { AgentProvider } from "@chisacode/protocol/agent-types";
import type {
  SyntheticModelConfig,
  SyntheticModelMoa,
  SyntheticModelParameters,
} from "@chisacode/protocol/provider-config";
import { Brain, FlaskConical, Pencil, Play, Plus, Trash2 } from "lucide-react-native";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, Text, TextInput, View, type PressableStateCallbackType } from "react-native";
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
import { buildModelGatewayProviderIdList } from "@/screens/settings/custom-model-providers";
import { SettingsSection } from "@/screens/settings/settings-section";
import {
  buildDeleteSyntheticModelPatch,
  buildSaveSyntheticModelPatch,
  collectSyntheticModelGateways,
  collectSyntheticModels,
  type SelectableSyntheticGateway,
  type SyntheticModelEntry,
} from "@/screens/settings/synthetic-models";
import { settingsStyles } from "@/styles/settings";
import { confirmDialog } from "@/utils/confirm-dialog";
import { useUserVisibleErrorReporter } from "@/hooks/use-user-visible-error";
import { reportPresentedError } from "@/utils/user-visible-error";

const ThemedPencil = withUnistyles(Pencil);
const ThemedTrash2 = withUnistyles(Trash2);
const ThemedPlus = withUnistyles(Plus);
const ThemedBrain = withUnistyles(Brain);
const ThemedFlaskConical = withUnistyles(FlaskConical);
const ThemedTextInput = withUnistyles(TextInput);

const foregroundMutedColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});
const destructiveColorMapping = (theme: Theme) => ({
  color: theme.colors.destructive,
});
const placeholderTextColorMapping = (theme: Theme) => ({
  placeholderTextColor: theme.colors.foregroundMuted,
});

interface SyntheticModelsSectionProps {
  serverId: string;
}

interface EditingSyntheticModelState {
  mode: "add" | "edit";
  model: SyntheticModelEntry | null;
}

interface SyntheticModelEditorValues {
  gatewayId: string;
  id: string;
  label: string;
  description: string;
  defaults: MoaParameterTextValues;
  layers: MoaTestLayerValues[];
  aggregatorModel: string;
  aggregator: MoaParameterTextValues;
}

interface PreviousSyntheticModelRef {
  gatewayId: string;
  id: string;
}

interface MoaParameterTextValues {
  temperatureText: string;
  maxTokensText: string;
  systemPrompt: string;
}

interface MoaTestLayerValues {
  id: string;
  serializedId?: string;
  label?: string;
  selectedModels: string[];
  nodeOverrides: Record<string, MoaParameterTextValues>;
}

interface MoaTesterValues {
  gatewayId: string;
  modelId: string;
  label: string;
  defaults: MoaParameterTextValues;
  layers: MoaTestLayerValues[];
  aggregatorModel: string;
  aggregator: MoaParameterTextValues;
  prompt: string;
}

type MoaTestPayload = ModelGatewayMoaTestResponseMessage["payload"];
type MoaTestResult = NonNullable<MoaTestPayload["result"]>;
type MoaTestNode = MoaTestResult["layers"][number]["nodes"][number];

const EDITOR_SNAP_POINTS = ["82%", "94%"];
const MOA_TESTER_SNAP_POINTS = ["88%", "96%"];
const EMPTY_PROVIDER_MODELS: SelectableSyntheticGateway["models"] = [];
const EMPTY_PARAMETER_VALUES: MoaParameterTextValues = {
  temperatureText: "",
  maxTokensText: "",
  systemPrompt: "",
};
const EMPTY_DRAFT_LAYER: MoaTestLayerValues = {
  id: "draft",
  selectedModels: [],
  nodeOverrides: {},
};
const EMPTY_REVIEW_LAYER: MoaTestLayerValues = {
  id: "review",
  selectedModels: [],
  nodeOverrides: {},
};

function createDefaultMoaLayers(
  models: SelectableSyntheticGateway["models"],
): MoaTestLayerValues[] {
  const defaultLayerModels = models.slice(0, 2).map((model) => model.id);
  return [
    {
      id: "draft",
      selectedModels: defaultLayerModels,
      nodeOverrides: {},
    },
    {
      id: "review",
      selectedModels: defaultLayerModels,
      nodeOverrides: {},
    },
  ];
}

function createDefaultValues(gateways: SelectableSyntheticGateway[]): SyntheticModelEditorValues {
  const firstGateway = gateways[0];
  const firstModels = firstGateway?.models ?? [];
  return {
    gatewayId: firstGateway?.id ?? "",
    id: "",
    label: "",
    description: "",
    defaults: { ...EMPTY_PARAMETER_VALUES },
    layers: createDefaultMoaLayers(firstModels),
    aggregatorModel: firstModels[0]?.id ?? "",
    aggregator: { ...EMPTY_PARAMETER_VALUES },
  };
}

function createDefaultMoaTesterValues(gateways: SelectableSyntheticGateway[]): MoaTesterValues {
  const firstGateway = gateways[0];
  const firstModels = firstGateway?.models ?? [];
  return {
    gatewayId: firstGateway?.id ?? "",
    modelId: "moa-test",
    label: "MoA Test",
    defaults: { ...EMPTY_PARAMETER_VALUES },
    layers: createDefaultMoaLayers(firstModels),
    aggregatorModel: firstModels[0]?.id ?? "",
    aggregator: { ...EMPTY_PARAMETER_VALUES },
    prompt: "",
  };
}

function createParameterTextValues(
  parameters: SyntheticModelParameters | undefined,
): MoaParameterTextValues {
  return {
    temperatureText:
      typeof parameters?.temperature === "number" ? String(parameters.temperature) : "",
    maxTokensText: typeof parameters?.maxTokens === "number" ? String(parameters.maxTokens) : "",
    systemPrompt: parameters?.systemPrompt ?? "",
  };
}

function createLayerValuesFromMoaLayer(
  id: string,
  fallbackModels: SelectableSyntheticGateway["models"],
  layer: SyntheticModelMoa["layers"][number] | undefined,
): MoaTestLayerValues {
  if (!layer) {
    let fallbackIndex = 0;
    if (id === "review") {
      fallbackIndex = 1;
    }
    let emptyFallback = EMPTY_DRAFT_LAYER;
    if (fallbackIndex === 1) {
      emptyFallback = EMPTY_REVIEW_LAYER;
    }
    return createDefaultMoaLayers(fallbackModels)[fallbackIndex] ?? emptyFallback;
  }
  return {
    id,
    serializedId: layer.id,
    label: layer.label,
    selectedModels: layer.nodes.map((node) => node.model),
    nodeOverrides: Object.fromEntries(
      layer.nodes
        .filter((node) => node.parameters)
        .map((node) => [node.model, createParameterTextValues(node.parameters)]),
    ),
  };
}

function createLegacyMoaFromModel(model: SyntheticModelEntry): SyntheticModelMoa {
  const rounds = parseRounds(String(model.rounds ?? 1));
  const nodes = model.references.map((reference) => ({ model: reference.model }));
  return {
    layers: Array.from({ length: rounds }, (_, index) => ({
      id: `layer-${index + 1}`,
      label: `Layer ${index + 1}`,
      nodes,
    })),
    aggregator: { model: model.aggregatorModel },
  };
}

function getLayerEditorId(index: number): string {
  if (index === 0) {
    return "draft";
  }
  if (index === 1) {
    return "review";
  }
  return `extra-${index + 1}`;
}

function createValuesFromModel(
  model: SyntheticModelEntry,
  gateways: SelectableSyntheticGateway[],
): SyntheticModelEditorValues {
  const gatewayModels = getSelectedGatewayModels(gateways, model.gatewayId);
  const moa = model.moa ?? createLegacyMoaFromModel(model);
  return {
    gatewayId: model.gatewayId,
    id: model.id,
    label: model.label,
    description: model.description ?? "",
    defaults: createParameterTextValues(moa.defaults),
    layers: moa.layers.map((layer, index) =>
      createLayerValuesFromMoaLayer(getLayerEditorId(index), gatewayModels, layer),
    ),
    aggregatorModel: moa.aggregator.model,
    aggregator: createParameterTextValues(moa.aggregator.parameters),
  };
}

function createValuesForState(
  state: EditingSyntheticModelState,
  gateways: SelectableSyntheticGateway[],
): SyntheticModelEditorValues {
  if (state.model) {
    return createValuesFromModel(state.model, gateways);
  }
  return createDefaultValues(gateways);
}

function getPreviousSyntheticModelRef(
  model: SyntheticModelEntry | null | undefined,
): PreviousSyntheticModelRef | null {
  if (!model) {
    return null;
  }
  return { gatewayId: model.gatewayId, id: model.id };
}

function getEditorTitleKey(mode: EditingSyntheticModelState["mode"] | undefined): string {
  return mode === "edit"
    ? "syntheticModels.editSyntheticModel"
    : "syntheticModels.addSyntheticModel";
}

function canSaveSyntheticModel(values: SyntheticModelEditorValues, saving: boolean): boolean {
  return (
    values.id.trim().length > 0 &&
    values.aggregatorModel.trim().length > 0 &&
    values.layers.length > 0 &&
    !saving
  );
}

function getSelectedGatewayModels(
  gateways: SelectableSyntheticGateway[],
  gatewayId: string,
): SelectableSyntheticGateway["models"] {
  return gateways.find((gateway) => gateway.id === gatewayId)?.models ?? EMPTY_PROVIDER_MODELS;
}

function toggleReference(references: string[], modelId: string, selected: boolean): string[] {
  const next = new Set(references);
  if (selected) {
    next.add(modelId);
  } else {
    next.delete(modelId);
  }
  return Array.from(next).sort();
}

function parseRounds(value: string): number {
  const parsed = Number(value.trim());
  if (!Number.isFinite(parsed)) {
    return 1;
  }
  return Math.max(1, Math.min(4, Math.trunc(parsed)));
}

function parseOptionalNumber(
  value: string,
  input: { min: number; max?: number; integer?: boolean },
): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }
  const rounded = input.integer ? Math.trunc(parsed) : parsed;
  const max = input.max ?? rounded;
  return Math.max(input.min, Math.min(max, rounded));
}

function buildMoaParameters(values: MoaParameterTextValues): SyntheticModelParameters | undefined {
  const temperature = parseOptionalNumber(values.temperatureText, { min: 0, max: 2 });
  const maxTokens = parseOptionalNumber(values.maxTokensText, { min: 1, integer: true });
  const systemPrompt = values.systemPrompt.trim();
  const parameters: SyntheticModelParameters = {
    ...(temperature !== undefined ? { temperature } : {}),
    ...(maxTokens !== undefined ? { maxTokens } : {}),
    ...(systemPrompt ? { systemPrompt } : {}),
  };
  return Object.keys(parameters).length > 0 ? parameters : undefined;
}

function getMoaReferenceModels(values: {
  layers: MoaTestLayerValues[];
  aggregatorModel: string;
}): string[] {
  return Array.from(
    new Set(
      [...values.layers.flatMap((layer) => layer.selectedModels), values.aggregatorModel].filter(
        Boolean,
      ),
    ),
  );
}

function buildMoaConfig(values: {
  defaults: MoaParameterTextValues;
  layers: MoaTestLayerValues[];
  aggregatorModel: string;
  aggregator: MoaParameterTextValues;
}): SyntheticModelMoa {
  return {
    ...(buildMoaParameters(values.defaults)
      ? { defaults: buildMoaParameters(values.defaults) }
      : {}),
    layers: values.layers.map((layer, index) => ({
      id: layer.serializedId ?? `layer-${index + 1}`,
      label: layer.label ?? `Layer ${index + 1}`,
      nodes: layer.selectedModels.map((model) => ({
        id: `${layer.serializedId ?? layer.id}:${model}`,
        model,
        ...(buildMoaParameters(layer.nodeOverrides[model] ?? EMPTY_PARAMETER_VALUES)
          ? {
              parameters: buildMoaParameters(layer.nodeOverrides[model] ?? EMPTY_PARAMETER_VALUES),
            }
          : {}),
      })),
    })),
    aggregator: {
      model: values.aggregatorModel,
      ...(buildMoaParameters(values.aggregator)
        ? { parameters: buildMoaParameters(values.aggregator) }
        : {}),
    },
  };
}

function buildMoaTestSyntheticModel(values: MoaTesterValues): SyntheticModelConfig {
  const references = getMoaReferenceModels(values);
  return {
    id: values.modelId.trim() || "moa-test",
    label: values.label.trim() || values.modelId.trim() || "MoA Test",
    references: references.map((model) => ({ model })),
    aggregatorModel: values.aggregatorModel,
    rounds: values.layers.length,
    moa: buildMoaConfig(values),
  };
}

function canRunMoaTest(
  values: MoaTesterValues,
  gateways: SelectableSyntheticGateway[],
  running: boolean,
  clientAvailable: boolean,
): boolean {
  const selectedModels = getSelectedGatewayModels(gateways, values.gatewayId);
  return (
    clientAvailable &&
    !running &&
    values.prompt.trim().length > 0 &&
    selectedModels.length > 0 &&
    values.aggregatorModel.trim().length > 0 &&
    values.layers.length > 0
  );
}

function SyntheticModelRow({
  model,
  onEdit,
  onDelete,
}: {
  model: SyntheticModelEntry;
  onEdit: (model: SyntheticModelEntry) => void;
  onDelete: (model: SyntheticModelEntry) => void;
}) {
  const { t } = useTranslation();
  const handleEdit = useCallback(() => onEdit(model), [model, onEdit]);
  const handleDelete = useCallback(() => onDelete(model), [model, onDelete]);
  const buttonStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.iconButton,
      (Boolean(hovered) || pressed) && styles.iconButtonHovered,
    ],
    [],
  );

  return (
    <View style={styles.modelRow} testID={`synthetic-model-row-${model.id}`}>
      <View style={styles.modelTextColumn}>
        <Text style={settingsStyles.rowTitle} numberOfLines={1}>
          {model.label}
        </Text>
        <Text style={styles.modelIdText} numberOfLines={1} selectable>
          {model.id} · {model.gatewayLabel}
        </Text>
        <Text style={settingsStyles.rowHint} numberOfLines={2}>
          {t("syntheticModels.referencesSummary", {
            count: model.references.length,
            aggregator: model.aggregatorModel,
          })}
        </Text>
      </View>
      <View style={styles.rowActions}>
        <Pressable
          onPress={handleEdit}
          hitSlop={8}
          style={buttonStyle}
          accessibilityRole="button"
          accessibilityLabel={t("syntheticModels.editModel", { model: model.label })}
        >
          <ThemedPencil size={ICON_SIZE.sm} uniProps={foregroundMutedColorMapping} />
        </Pressable>
        <Pressable
          onPress={handleDelete}
          hitSlop={8}
          style={buttonStyle}
          accessibilityRole="button"
          accessibilityLabel={t("syntheticModels.deleteModel", { model: model.label })}
        >
          <ThemedTrash2 size={ICON_SIZE.sm} uniProps={destructiveColorMapping} />
        </Pressable>
      </View>
    </View>
  );
}

function MoaStageModelRow({
  model,
  selected,
  bordered,
  onToggleModel,
}: {
  model: SelectableSyntheticGateway["models"][number];
  selected: boolean;
  bordered: boolean;
  onToggleModel: (modelId: string, selected: boolean) => void;
}) {
  const rowStyle = useMemo(
    () => [styles.optionRow, bordered && settingsStyles.rowBorder],
    [bordered],
  );
  const handleToggle = useCallback(
    (nextSelected: boolean) => onToggleModel(model.id, nextSelected),
    [model.id, onToggleModel],
  );

  return (
    <View style={rowStyle}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle} numberOfLines={1}>
          {model.label}
        </Text>
        <Text style={settingsStyles.rowHint} numberOfLines={1}>
          {model.id}
        </Text>
      </View>
      <Switch value={selected} onValueChange={handleToggle} />
    </View>
  );
}

function MoaModelStageCard({
  layer,
  title,
  hint,
  models,
  onToggleModel,
}: {
  layer: MoaTestLayerValues;
  title: string;
  hint: string;
  models: SelectableSyntheticGateway["models"];
  onToggleModel: (layerId: string, modelId: string, selected: boolean) => void;
}) {
  const { t } = useTranslation();
  const handleToggle = useCallback(
    (modelId: string, selected: boolean) => onToggleModel(layer.id, modelId, selected),
    [layer.id, onToggleModel],
  );

  return (
    <View style={styles.stagePanel}>
      <View style={styles.stageHeader}>
        <View style={styles.stageTextColumn}>
          <Text style={settingsStyles.rowTitle} numberOfLines={1}>
            {title}
          </Text>
          <Text style={settingsStyles.rowHint} numberOfLines={2}>
            {hint}
          </Text>
        </View>
        <Text style={styles.stageCount}>
          {t("syntheticModels.layerModelCount", { count: layer.selectedModels.length })}
        </Text>
      </View>
      <View style={styles.layerModelList}>
        {models.map((model, index) => (
          <MoaStageModelRow
            key={model.id}
            model={model}
            selected={layer.selectedModels.includes(model.id)}
            bordered={index > 0}
            onToggleModel={handleToggle}
          />
        ))}
      </View>
    </View>
  );
}

function MoaAggregatorStageCard({
  title,
  hint,
  models,
  selectedModel,
  onSelectModel,
}: {
  title: string;
  hint: string;
  models: SelectableSyntheticGateway["models"];
  selectedModel: string;
  onSelectModel: (modelId: string) => void;
}) {
  const { t } = useTranslation();

  return (
    <View style={styles.stagePanel}>
      <View style={styles.stageHeader}>
        <View style={styles.stageTextColumn}>
          <Text style={settingsStyles.rowTitle} numberOfLines={1}>
            {title}
          </Text>
          <Text style={settingsStyles.rowHint} numberOfLines={2}>
            {hint}
          </Text>
        </View>
        <Text style={styles.stageCount}>
          {t("syntheticModels.layerModelCount", { count: selectedModel ? 1 : 0 })}
        </Text>
      </View>
      <View style={styles.layerModelList}>
        {models.map((model, index) => (
          <GatewayModelRadioRow
            key={model.id}
            model={model}
            selected={selectedModel === model.id}
            bordered={index > 0}
            onSelect={onSelectModel}
          />
        ))}
      </View>
    </View>
  );
}

function ResultNodeRow({ node }: { node: MoaTestNode }) {
  const { t } = useTranslation();
  const success = node.status === "success";
  return (
    <View style={styles.resultNode}>
      <View style={styles.resultNodeHeader}>
        <Text style={settingsStyles.rowTitle} numberOfLines={1}>
          {node.model}
        </Text>
        <Text style={success ? styles.resultSuccessText : styles.resultErrorText}>
          {success ? t("syntheticModels.nodeSuccess") : t("syntheticModels.nodeFailed")} ·{" "}
          {Math.round(node.durationMs)}ms
        </Text>
      </View>
      <Text style={styles.resultOutputText} selectable>
        {node.output ?? node.error ?? ""}
      </Text>
    </View>
  );
}

function MoaTestResults({ payload }: { payload: MoaTestPayload | null }) {
  const { t } = useTranslation();
  const result = payload?.result ?? null;

  if (!payload) {
    return null;
  }
  if (payload.error || !result) {
    return (
      <View style={styles.resultPanel}>
        <Text style={styles.resultErrorText}>
          {payload.error ?? t("syntheticModels.testFailed")}
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.resultPanel}>
      <Text style={styles.formLabel}>{t("syntheticModels.finalAnswer")}</Text>
      <Text style={styles.resultOutputText} selectable>
        {result.finalText}
      </Text>
      <Text style={settingsStyles.rowHint}>
        {t("syntheticModels.totalDuration", { duration: Math.round(result.durationMs) })}
      </Text>
      {result.layers.map((layer, index) => (
        <View key={layer.id} style={styles.resultLayer}>
          <Text style={settingsStyles.rowTitle}>
            {layer.label ?? t("syntheticModels.layerTitle", { index: index + 1 })}
          </Text>
          {layer.nodes.map((node) => (
            <ResultNodeRow key={`${layer.id}:${node.id ?? node.model}`} node={node} />
          ))}
        </View>
      ))}
      <View style={styles.resultLayer}>
        <Text style={settingsStyles.rowTitle}>{t("syntheticModels.aggregatorResult")}</Text>
        <AggregatorResultNode aggregator={result.aggregator} />
      </View>
    </View>
  );
}

function AggregatorResultNode({ aggregator }: { aggregator: MoaTestResult["aggregator"] }) {
  const node = useMemo<MoaTestNode>(
    () => ({
      id: "aggregator",
      model: aggregator.model,
      status: aggregator.status,
      output: aggregator.output,
      error: aggregator.error,
      durationMs: aggregator.durationMs,
    }),
    [
      aggregator.durationMs,
      aggregator.error,
      aggregator.model,
      aggregator.output,
      aggregator.status,
    ],
  );
  return <ResultNodeRow node={node} />;
}

function GatewayOptionRow({
  gateway,
  selected,
  bordered,
  onSelect,
}: {
  gateway: SelectableSyntheticGateway;
  selected: boolean;
  bordered: boolean;
  onSelect: (gateway: SelectableSyntheticGateway) => void;
}) {
  const { t } = useTranslation();
  const rowStyle = useMemo(
    () => [styles.optionRow, bordered && settingsStyles.rowBorder],
    [bordered],
  );
  const accessibilityState = useMemo(() => ({ selected }), [selected]);
  const handleSelect = useCallback(() => onSelect(gateway), [gateway, onSelect]);

  return (
    <Pressable
      onPress={handleSelect}
      style={rowStyle}
      accessibilityRole="button"
      accessibilityState={accessibilityState}
    >
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{gateway.label}</Text>
        <Text style={settingsStyles.rowHint}>
          {t("syntheticModels.modelCount", { count: gateway.models.length })}
        </Text>
      </View>
      <Switch value={selected} onValueChange={handleSelect} />
    </Pressable>
  );
}

function GatewayPicker({
  gateways,
  selectedGatewayId,
  onSelect,
}: {
  gateways: SelectableSyntheticGateway[];
  selectedGatewayId: string;
  onSelect: (gateway: SelectableSyntheticGateway) => void;
}) {
  const { t } = useTranslation();

  return (
    <View style={styles.fieldGroup}>
      <Text style={styles.formLabel}>{t("syntheticModels.provider")}</Text>
      <View style={settingsStyles.card}>
        {gateways.length > 0 ? (
          gateways.map((gateway, index) => (
            <GatewayOptionRow
              key={gateway.id}
              gateway={gateway}
              selected={gateway.id === selectedGatewayId}
              bordered={index > 0}
              onSelect={onSelect}
            />
          ))
        ) : (
          <View style={styles.emptyCard}>
            <Text style={settingsStyles.rowHint}>{t("syntheticModels.noProviders")}</Text>
          </View>
        )}
      </View>
    </View>
  );
}

function SyntheticModelEditorSheet({
  state,
  gateways,
  onClose,
  onSave,
}: {
  state: EditingSyntheticModelState | null;
  gateways: SelectableSyntheticGateway[];
  onClose: () => void;
  onSave: (
    values: SyntheticModelEditorValues,
    previous: PreviousSyntheticModelRef | null,
  ) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [values, setValues] = useState<SyntheticModelEditorValues>(() =>
    createDefaultValues(gateways),
  );
  const [saving, setSaving] = useState(false);
  const visible = state !== null;
  const previous = useMemo(() => getPreviousSyntheticModelRef(state?.model), [state?.model]);
  const selectedGatewayModels = useMemo(
    () => getSelectedGatewayModels(gateways, values.gatewayId),
    [gateways, values.gatewayId],
  );

  useEffect(() => {
    if (!state) {
      return;
    }
    setValues(createValuesForState(state, gateways));
    setSaving(false);
  }, [gateways, state]);

  const setFieldValue = useCallback(
    <K extends keyof SyntheticModelEditorValues>(key: K, value: SyntheticModelEditorValues[K]) => {
      setValues((current) => ({ ...current, [key]: value }));
    },
    [],
  );

  const handleGatewaySelect = useCallback((gateway: SelectableSyntheticGateway) => {
    setValues((current) => ({
      ...current,
      gatewayId: gateway.id,
      layers: createDefaultMoaLayers(gateway.models),
      aggregatorModel: gateway.models[0]?.id ?? "",
    }));
  }, []);
  const handleIdChange = useCallback(
    (value: string) => setFieldValue("id", value),
    [setFieldValue],
  );
  const handleLabelChange = useCallback(
    (value: string) => setFieldValue("label", value),
    [setFieldValue],
  );
  const handleDescriptionChange = useCallback(
    (value: string) => setFieldValue("description", value),
    [setFieldValue],
  );
  const handleAggregatorSelect = useCallback((modelId: string) => {
    setValues((current) => ({ ...current, aggregatorModel: modelId }));
  }, []);
  const handleToggleLayerModel = useCallback(
    (layerId: string, modelId: string, selected: boolean) => {
      setValues((current) => ({
        ...current,
        layers: current.layers.map((layer) => {
          if (layer.id !== layerId) {
            return layer;
          }
          return {
            ...layer,
            selectedModels: toggleReference(layer.selectedModels, modelId, selected),
          };
        }),
      }));
    },
    [],
  );
  const handleSave = useCallback(() => {
    if (saving) return;
    setSaving(true);
    void onSave(values, previous).finally(() => setSaving(false));
  }, [onSave, previous, saving, values]);
  const header = useMemo<SheetHeader>(
    () => ({
      title: t(getEditorTitleKey(state?.mode)),
    }),
    [state?.mode, t],
  );
  const canSave = canSaveSyntheticModel(values, saving);

  return (
    <AdaptiveModalSheet
      header={header}
      visible={visible}
      onClose={onClose}
      desktopMaxWidth={520}
      snapPoints={EDITOR_SNAP_POINTS}
      testID="synthetic-model-editor-sheet"
    >
      <View style={styles.formGroup}>
        <GatewayPicker
          gateways={gateways}
          selectedGatewayId={values.gatewayId}
          onSelect={handleGatewaySelect}
        />
        <View style={styles.fieldRow}>
          <View style={FIELD_GROUP_ROW_STYLE}>
            <Text style={styles.formLabel}>{t("syntheticModels.modelId")}</Text>
            <AdaptiveTextInput
              initialValue={values.id}
              resetKey={`synthetic-id-${state?.mode ?? "closed"}-${previous?.id ?? "new"}`}
              onChangeText={handleIdChange}
              placeholder="moa-coder"
              autoCapitalize="none"
              autoCorrect={false}
              // @ts-expect-error - outlineStyle is web-only
              style={FORM_INPUT_STYLE}
            />
          </View>
          <View style={FIELD_GROUP_ROW_STYLE}>
            <Text style={styles.formLabel}>{t("syntheticModels.modelLabel")}</Text>
            <AdaptiveTextInput
              initialValue={values.label}
              resetKey={`synthetic-label-${state?.mode ?? "closed"}-${previous?.id ?? "new"}`}
              onChangeText={handleLabelChange}
              placeholder={t("syntheticModels.modelLabelPlaceholder")}
              autoCapitalize="none"
              autoCorrect={false}
              // @ts-expect-error - outlineStyle is web-only
              style={FORM_INPUT_STYLE}
            />
          </View>
        </View>
        <View style={styles.fieldGroup}>
          <Text style={styles.formLabel}>{t("syntheticModels.description")}</Text>
          <AdaptiveTextInput
            initialValue={values.description}
            resetKey={`synthetic-description-${state?.mode ?? "closed"}-${previous?.id ?? "new"}`}
            onChangeText={handleDescriptionChange}
            placeholder={t("syntheticModels.descriptionPlaceholder")}
            // @ts-expect-error - outlineStyle is web-only
            style={FORM_INPUT_STYLE}
          />
        </View>
        <View style={styles.stageStack}>
          <MoaModelStageCard
            layer={values.layers[0] ?? EMPTY_DRAFT_LAYER}
            title={t("syntheticModels.moaStageDraft")}
            hint={t("syntheticModels.moaDraftHint")}
            models={selectedGatewayModels}
            onToggleModel={handleToggleLayerModel}
          />
          <MoaModelStageCard
            layer={values.layers[1] ?? EMPTY_REVIEW_LAYER}
            title={t("syntheticModels.moaStageReview")}
            hint={t("syntheticModels.moaReviewHint")}
            models={selectedGatewayModels}
            onToggleModel={handleToggleLayerModel}
          />
          <MoaAggregatorStageCard
            title={t("syntheticModels.aggregatorModel")}
            hint={t("syntheticModels.moaAggregatorHint")}
            models={selectedGatewayModels}
            selectedModel={values.aggregatorModel}
            onSelectModel={handleAggregatorSelect}
          />
        </View>
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
          >
            {saving ? t("syntheticModels.saving") : t("common.save")}
          </Button>
        </View>
      </View>
    </AdaptiveModalSheet>
  );
}

function MoaTesterSheet({
  visible,
  serverId,
  gateways,
  onClose,
}: {
  visible: boolean;
  serverId: string;
  gateways: SelectableSyntheticGateway[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const client = useHostRuntimeClient(serverId);
  const [values, setValues] = useState<MoaTesterValues>(() =>
    createDefaultMoaTesterValues(gateways),
  );
  const [running, setRunning] = useState(false);
  const [resultPayload, setResultPayload] = useState<MoaTestPayload | null>(null);
  const selectedGatewayModels = useMemo(
    () => getSelectedGatewayModels(gateways, values.gatewayId),
    [gateways, values.gatewayId],
  );
  const header = useMemo<SheetHeader>(
    () => ({
      title: t("syntheticModels.moaTestTitle"),
      subtitle: t("syntheticModels.moaTestSubtitle"),
    }),
    [t],
  );

  useEffect(() => {
    if (!visible) {
      return;
    }
    setValues(createDefaultMoaTesterValues(gateways));
    setRunning(false);
    setResultPayload(null);
  }, [gateways, visible]);

  const handleGatewaySelect = useCallback((gateway: SelectableSyntheticGateway) => {
    setValues((current) => ({
      ...createDefaultMoaTesterValues([gateway]),
      modelId: current.modelId,
      label: current.label,
      prompt: current.prompt,
    }));
    setResultPayload(null);
  }, []);
  const handlePromptChange = useCallback((prompt: string) => {
    setValues((current) => ({ ...current, prompt }));
  }, []);
  const handleAggregatorSelect = useCallback((modelId: string) => {
    setValues((current) => ({ ...current, aggregatorModel: modelId }));
  }, []);
  const handleToggleLayerModel = useCallback(
    (layerId: string, modelId: string, selected: boolean) => {
      setValues((current) => ({
        ...current,
        layers: current.layers.map((layer) => {
          if (layer.id !== layerId) {
            return layer;
          }
          return {
            ...layer,
            selectedModels: toggleReference(layer.selectedModels, modelId, selected),
          };
        }),
      }));
    },
    [],
  );
  const handleRun = useCallback(() => {
    if (!client || running) {
      return;
    }
    const syntheticModel = buildMoaTestSyntheticModel(values);
    setRunning(true);
    setResultPayload(null);
    void client
      .runModelGatewayMoaTest({
        gatewayId: values.gatewayId,
        syntheticModel,
        prompt: values.prompt.trim(),
      })
      .then(setResultPayload)
      .catch((error: unknown) => {
        reportPresentedError({
          error,
          logLabel: "[SyntheticModels] Failed to run MoA test",
          fallbackMessage: t("syntheticModels.testFailed"),
          present: (message) => {
            setResultPayload({
              requestId: "",
              gatewayId: values.gatewayId,
              result: null,
              error: message,
            });
          },
        });
      })
      .finally(() => setRunning(false));
  }, [client, running, t, values]);
  const canRun = canRunMoaTest(values, gateways, running, client !== null);

  return (
    <AdaptiveModalSheet
      header={header}
      visible={visible}
      onClose={onClose}
      desktopMaxWidth={760}
      snapPoints={MOA_TESTER_SNAP_POINTS}
      testID="synthetic-model-moa-tester-sheet"
    >
      <View style={styles.formGroup}>
        <GatewayPicker
          gateways={gateways}
          selectedGatewayId={values.gatewayId}
          onSelect={handleGatewaySelect}
        />
        <View style={styles.stageStack}>
          <MoaModelStageCard
            layer={values.layers[0] ?? EMPTY_DRAFT_LAYER}
            title={t("syntheticModels.moaStageDraft")}
            hint={t("syntheticModels.moaDraftHint")}
            models={selectedGatewayModels}
            onToggleModel={handleToggleLayerModel}
          />
          <MoaModelStageCard
            layer={values.layers[1] ?? EMPTY_REVIEW_LAYER}
            title={t("syntheticModels.moaStageReview")}
            hint={t("syntheticModels.moaReviewHint")}
            models={selectedGatewayModels}
            onToggleModel={handleToggleLayerModel}
          />
          <MoaAggregatorStageCard
            title={t("syntheticModels.aggregatorModel")}
            hint={t("syntheticModels.moaAggregatorHint")}
            models={selectedGatewayModels}
            selectedModel={values.aggregatorModel}
            onSelectModel={handleAggregatorSelect}
          />
        </View>
        <View style={styles.fieldGroup}>
          <Text style={styles.formLabel}>{t("syntheticModels.testPrompt")}</Text>
          <ThemedTextInput
            value={values.prompt}
            onChangeText={handlePromptChange}
            placeholder={t("syntheticModels.testPromptPlaceholder")}
            uniProps={placeholderTextColorMapping}
            multiline
            style={PROMPT_INPUT_STYLE}
            testID="moa-test-prompt-input"
          />
        </View>
        <View style={styles.formActions}>
          <Button variant="secondary" size="sm" onPress={onClose} disabled={running}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="default"
            size="sm"
            leftIcon={Play}
            onPress={handleRun}
            disabled={!canRun}
            loading={running}
            testID="moa-test-run-button"
          >
            {running ? t("syntheticModels.testing") : t("syntheticModels.runTest")}
          </Button>
        </View>
        {!client ? (
          <Text style={styles.resultErrorText}>{t("syntheticModels.hostUnavailable")}</Text>
        ) : null}
        <MoaTestResults payload={resultPayload} />
      </View>
    </AdaptiveModalSheet>
  );
}

function GatewayModelRadioRow({
  model,
  selected,
  bordered,
  onSelect,
}: {
  model: SelectableSyntheticGateway["models"][number];
  selected: boolean;
  bordered: boolean;
  onSelect: (modelId: string) => void;
}) {
  const rowStyle = useMemo(
    () => [styles.optionRow, bordered && settingsStyles.rowBorder],
    [bordered],
  );
  const handleSelect = useCallback(() => onSelect(model.id), [model.id, onSelect]);
  const accessibilityState = useMemo(() => ({ selected }), [selected]);
  return (
    <Pressable
      onPress={handleSelect}
      style={rowStyle}
      accessibilityRole="button"
      accessibilityState={accessibilityState}
    >
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle} numberOfLines={1}>
          {model.label}
        </Text>
        <Text style={settingsStyles.rowHint} numberOfLines={1}>
          {model.id}
        </Text>
      </View>
      <Switch value={selected} onValueChange={handleSelect} />
    </Pressable>
  );
}

export function SyntheticModelsSection({ serverId }: SyntheticModelsSectionProps) {
  const { t } = useTranslation();
  const reportError = useUserVisibleErrorReporter();
  const { config, patchConfig } = useDaemonConfig(serverId);
  const { refresh } = useProvidersSnapshot(serverId);
  const [editorState, setEditorState] = useState<EditingSyntheticModelState | null>(null);
  const [moaTesterOpen, setMoaTesterOpen] = useState(false);
  const gateways = useMemo(
    () => collectSyntheticModelGateways(config?.modelGateways),
    [config?.modelGateways],
  );
  const syntheticModels = useMemo(
    () => collectSyntheticModels(config?.modelGateways),
    [config?.modelGateways],
  );
  const openAdd = useCallback(() => setEditorState({ mode: "add", model: null }), []);
  const openMoaTester = useCallback(() => setMoaTesterOpen(true), []);
  const openEdit = useCallback(
    (model: SyntheticModelEntry) => setEditorState({ mode: "edit", model }),
    [],
  );
  const closeEditor = useCallback(() => setEditorState(null), []);
  const closeMoaTester = useCallback(() => setMoaTesterOpen(false), []);
  const refreshGatewayProviders = useCallback(
    async (gatewayIds: Array<string | null | undefined>) => {
      const providers = Array.from(
        new Set(
          gatewayIds
            .map((gatewayId) => gatewayId?.trim())
            .filter((gatewayId): gatewayId is string => Boolean(gatewayId))
            .flatMap((gatewayId) => buildModelGatewayProviderIdList(gatewayId)),
        ),
      ) as AgentProvider[];
      if (providers.length === 0) {
        return;
      }
      await refresh(providers);
    },
    [refresh],
  );
  const handleSave = useCallback(
    async (values: SyntheticModelEditorValues, previous: PreviousSyntheticModelRef | null) => {
      try {
        const updatedConfig = await patchConfig(
          buildSaveSyntheticModelPatch({
            currentGateways: config?.modelGateways,
            previousGatewayId: previous?.gatewayId,
            previousId: previous?.id,
            gatewayId: values.gatewayId,
            id: values.id,
            label: values.label,
            description: values.description,
            references: getMoaReferenceModels(values),
            aggregatorModel: values.aggregatorModel,
            rounds: values.layers.length,
            moa: buildMoaConfig(values),
          }),
        );
        if (!updatedConfig) {
          throw new Error(t("syntheticModels.saveFailed"));
        }
        setEditorState(null);
        void refreshGatewayProviders([values.gatewayId, previous?.gatewayId]).catch((error) => {
          console.warn("[SyntheticModels] Failed to refresh providers after save", error);
        });
      } catch (error) {
        reportError({
          error,
          logLabel: "[SyntheticModels] Failed to save synthetic model",
          fallbackMessage: t("syntheticModels.saveFailed"),
        });
      }
    },
    [config?.modelGateways, patchConfig, refreshGatewayProviders, reportError, t],
  );
  const handleDelete = useCallback(
    (model: SyntheticModelEntry) => {
      void (async () => {
        const confirmed = await confirmDialog({
          title: t("syntheticModels.deleteConfirmTitle"),
          message: t("syntheticModels.deleteConfirmMessage", { model: model.label }),
          confirmLabel: t("common.delete"),
          cancelLabel: t("common.cancel"),
          destructive: true,
        });
        if (!confirmed) return;
        const updatedConfig = await patchConfig(
          buildDeleteSyntheticModelPatch({
            currentGateways: config?.modelGateways,
            gatewayId: model.gatewayId,
            id: model.id,
          }),
        );
        if (!updatedConfig) {
          throw new Error(t("syntheticModels.deleteFailed"));
        }
        void refreshGatewayProviders([model.gatewayId]).catch((error) => {
          console.warn("[SyntheticModels] Failed to refresh providers after delete", error);
        });
      })().catch((error) => {
        reportError({
          error,
          logLabel: `[SyntheticModels] Failed to delete synthetic model ${model.id}`,
          fallbackMessage: t("syntheticModels.deleteFailed"),
        });
      });
    },
    [config?.modelGateways, patchConfig, refreshGatewayProviders, reportError, t],
  );
  const headerActions = useMemo(
    () => (
      <View style={styles.headerActions}>
        <Pressable
          onPress={openMoaTester}
          hitSlop={8}
          style={settingsStyles.sectionHeaderLink}
          accessibilityRole="button"
          accessibilityLabel={t("syntheticModels.openMoaTest")}
        >
          <ThemedFlaskConical size={ICON_SIZE.sm} uniProps={foregroundMutedColorMapping} />
          <Text style={settingsStyles.sectionHeaderLinkText}>{t("syntheticModels.moaTest")}</Text>
        </Pressable>
        <Pressable
          onPress={openAdd}
          hitSlop={8}
          style={settingsStyles.sectionHeaderLink}
          accessibilityRole="button"
          accessibilityLabel={t("syntheticModels.addSyntheticModel")}
        >
          <ThemedPlus size={ICON_SIZE.sm} uniProps={foregroundMutedColorMapping} />
          <Text style={settingsStyles.sectionHeaderLinkText}>{t("syntheticModels.add")}</Text>
        </Pressable>
      </View>
    ),
    [openAdd, openMoaTester, t],
  );

  return (
    <>
      <SettingsSection
        title={t("syntheticModels.title")}
        trailing={headerActions}
        style={styles.sectionSpacing}
      >
        {syntheticModels.length > 0 ? (
          <View style={settingsStyles.card}>
            {syntheticModels.map((model, index) => (
              <View
                key={`${model.gatewayId}:${model.id}`}
                style={index === 0 ? undefined : styles.modelRowBorder}
              >
                <SyntheticModelRow model={model} onEdit={openEdit} onDelete={handleDelete} />
              </View>
            ))}
          </View>
        ) : (
          <View style={EMPTY_CARD_STYLE}>
            <ThemedBrain size={ICON_SIZE.md} uniProps={foregroundMutedColorMapping} />
            <Text style={styles.emptyText}>{t("syntheticModels.empty")}</Text>
          </View>
        )}
      </SettingsSection>
      <SyntheticModelEditorSheet
        state={editorState}
        gateways={gateways}
        onClose={closeEditor}
        onSave={handleSave}
      />
      <MoaTesterSheet
        visible={moaTesterOpen}
        serverId={serverId}
        gateways={gateways}
        onClose={closeMoaTester}
      />
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  sectionSpacing: {
    marginTop: theme.spacing[2],
    marginBottom: theme.spacing[3],
    opacity: 0.98,
  },
  emptyCard: {
    padding: theme.spacing[3],
    gap: theme.spacing[2],
    alignItems: "center",
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
    paddingVertical: theme.spacing[3],
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
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
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
  disabledButton: {
    opacity: theme.opacity[50],
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
    minWidth: 0,
  },
  fieldGroupInRow: {
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
  promptInput: {
    minHeight: 108,
    textAlignVertical: "top",
  },
  stageStack: {
    gap: theme.spacing[3],
  },
  stagePanel: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 14,
    backgroundColor: theme.colors.surface0,
    overflow: "hidden",
  },
  stageHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[3],
    padding: theme.spacing[4],
    borderBottomWidth: 1,
    // Soft quiet chrome rule (--border-soft).
    borderBottomColor: theme.colors.secondary,
  },
  stageTextColumn: {
    flex: 1,
    minWidth: 0,
  },
  stageCount: {
    color: theme.colors.foregroundMuted,
    fontSize: 12.5,
    lineHeight: 16,
  },
  layerModelList: {
    gap: 0,
  },
  resultPanel: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 14,
    backgroundColor: theme.colors.surface0,
    padding: theme.spacing[4],
    gap: theme.spacing[3],
  },
  resultLayer: {
    gap: theme.spacing[2],
    paddingTop: theme.spacing[3],
    borderTopWidth: 1,
    // Soft quiet list divider (--border-soft).
    borderTopColor: theme.colors.secondary,
  },
  resultNode: {
    gap: theme.spacing[2],
    backgroundColor: theme.colors.surfaceWorkspace,
    borderRadius: 12,
    padding: theme.spacing[3],
  },
  resultNodeHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[3],
  },
  resultOutputText: {
    color: theme.colors.foreground,
    fontSize: 13,
    lineHeight: 18,
  },
  resultSuccessText: {
    color: theme.colors.foregroundMuted,
    fontSize: 12.5,
    lineHeight: 16,
  },
  resultErrorText: {
    color: theme.colors.destructive,
    fontSize: 12.5,
    lineHeight: 16,
  },
  optionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
  },
  formActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: theme.spacing[2],
  },
}));

const EMPTY_CARD_STYLE = [settingsStyles.card, styles.emptyCard];
const FIELD_GROUP_ROW_STYLE = [styles.fieldGroup, styles.fieldGroupInRow];
const FORM_INPUT_STYLE = [styles.formInput, isWeb && { outlineStyle: "none" }];
const PROMPT_INPUT_STYLE = [styles.formInput, styles.promptInput];
