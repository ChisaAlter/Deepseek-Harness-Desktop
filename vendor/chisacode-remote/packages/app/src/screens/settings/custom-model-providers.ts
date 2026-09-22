import type {
  ModelGatewayProtocolPreset,
  ModelGatewaySupplyScope,
  ProviderProfileModel,
} from "@chisacode/protocol/provider-config";
import type { MutableDaemonConfig, MutableDaemonConfigPatch } from "@chisacode/protocol/messages";

type ProviderConfig = MutableDaemonConfig["providers"][string];
type ModelGatewayConfig = NonNullable<MutableDaemonConfig["modelGateways"]>[string];
type ModelGatewayPatch = NonNullable<MutableDaemonConfigPatch["modelGateways"]>[string];

export type CustomOpenAIWireApi = "responses" | "chat";

/** User-facing protocol preset when adding a custom model (excludes legacy "all"). */
export type CustomModelProtocolPreset = "claude" | "codex" | "openai";

/**
 * Thinking intensity presets for custom models.
 * - off: no thinkingOptions
 * - single: one toggle option (mapped to medium effort for Codex)
 * - levels: low/medium/high multi-level (Codex/Claude friendly)
 */
export type CustomModelThinkingMode = "off" | "single" | "levels";
export type CustomModelThinkingLevel = "low" | "medium" | "high" | "very-high" | "max";

export interface CustomModelThinkingOption {
  id: CustomModelThinkingLevel;
  label: string;
  isDefault?: boolean;
}

export const CUSTOM_MODEL_THINKING_OPTIONS: readonly CustomModelThinkingOption[] = [
  { id: "low", label: "Low" },
  { id: "medium", label: "Medium", isDefault: true },
  { id: "high", label: "High" },
  { id: "very-high", label: "Very High" },
  { id: "max", label: "Max" },
];

export interface CustomModelProviderEndpoint {
  enabled: boolean;
  baseUrl: string;
  apiKey: string;
}

export interface CustomModelProviderOpenAIEndpoint extends CustomModelProviderEndpoint {
  wireApi: CustomOpenAIWireApi;
}

export interface CustomModelProviderModelInput {
  id: string;
  label?: string;
  contextWindowMaxTokens?: number;
  supportsImages?: boolean;
  supportsTools?: boolean;
  supportsThinking?: boolean;
  /** Explicit thinking options; when set, overrides supportsThinking boolean. */
  thinkingOptions?: Array<{ id: string; label: string; isDefault?: boolean }>;
  thinkingMode?: CustomModelThinkingMode;
  thinkingLevels?: CustomModelThinkingLevel[];
}

export interface CollectedSavedModel {
  key: string;
  gatewayId: string;
  gatewayLabel: string;
  modelId: string;
  label: string;
  contextWindowMaxTokens?: number;
  supportsImages?: boolean;
  supportsTools?: boolean;
  supportsThinking?: boolean;
  thinkingMode?: CustomModelThinkingMode;
  thinkingLevels?: CustomModelThinkingLevel[];
  thinkingOptions?: Array<{ id: string; label: string; isDefault?: boolean }>;
  protocolPreset?: CustomModelProtocolPreset | "all";
  /** Effective supply scope after read-path normalization; mirrors the server closed set. */
  supplyScope?: ModelGatewaySupplyScope;
  attachToAllAgents?: boolean;
  providerIds: string[];
  baseUrl?: string;
}

export interface SaveOpenAiCompatibleModelInput {
  currentGateways: MutableDaemonConfig["modelGateways"] | undefined;
  /** Existing gateway id when editing; omitted when creating a new gateway. */
  gatewayId?: string | null;
  /** Previous model id when renaming a model inside a gateway. */
  previousModelId?: string | null;
  modelId: string;
  label?: string | null;
  baseUrl: string;
  apiKey: string;
  contextWindowMaxTokens?: number;
  supportsImages?: boolean;
  supportsTools?: boolean;
  /** @deprecated Prefer thinkingMode */
  supportsThinking?: boolean;
  thinkingMode?: CustomModelThinkingMode;
  thinkingLevels?: CustomModelThinkingLevel[];
  /** Primary protocol preset. Defaults to openai when omitted. */
  protocolPreset?: CustomModelProtocolPreset;
  /**
   * Supply scope when the daemon supports `supplyScope` persistence
   * (`server_info.features.modelGatewaySupplyScope`). When omitted on a
   * supporting daemon, the save path derives the scope from
   * `attachToAllAgents` / `protocolPreset`.
   */
  supplyScope?: ModelGatewaySupplyScope;
  /**
   * Whether the connected daemon persists `supplyScope`
   * (`server_info.features.modelGatewaySupplyScope === true`). When false the
   * save path falls back to legacy `attachToAllAgents` writes so old daemons
   * keep rejecting nothing and the scope keeps working.
   */
  supplyScopeSupported?: boolean;
  /**
   * @deprecated Prefer `supplyScope` on daemons that support it. Kept for
   * legacy daemons without the `modelGatewaySupplyScope` feature gate, where
   * `attachToAllAgents === true` is the only way to express "all agents".
   */
  attachToAllAgents?: boolean;
  /** When true, use the advanced multi-endpoint fields below instead of simple single-protocol. */
  customProtocol?: boolean;
  anthropic?: CustomModelProviderEndpoint;
  openai?: CustomModelProviderOpenAIEndpoint;
  responses?: CustomModelProviderEndpoint;
}

export interface DeleteSavedModelInput {
  currentGateways: MutableDaemonConfig["modelGateways"] | undefined;
  gatewayId: string;
  modelId: string;
  /** Whether the daemon persists `supplyScope` (feature gate). */
  supplyScopeSupported?: boolean;
}

export interface SaveCustomModelProviderInput {
  currentGateways: MutableDaemonConfig["modelGateways"] | undefined;
  previousId?: string | null;
  id: string;
  label: string;
  models: Array<string | CustomModelProviderModelInput>;
  anthropic: CustomModelProviderEndpoint;
  openai: CustomModelProviderOpenAIEndpoint;
  responses: CustomModelProviderEndpoint;
  protocolPreset?: ModelGatewayProtocolPreset;
  /** Explicit supply scope; on supporting daemons the patch always writes it. */
  supplyScope?: ModelGatewaySupplyScope;
  /** Whether the daemon persists `supplyScope` (feature gate). */
  supplyScopeSupported?: boolean;
  /** @deprecated Legacy daemon fallback; prefer `supplyScope`. */
  attachToAllAgents?: boolean;
}

export interface CollectedCustomModelProvider {
  id: string;
  label: string;
  providerIds: string[];
  models: ProviderProfileModel[];
  anthropic: {
    providerId: string;
    enabled: boolean;
    baseUrl: string;
    hasApiKey: boolean;
  } | null;
  openai: {
    providerId: string;
    enabled: boolean;
    baseUrl: string;
    hasApiKey: boolean;
    wireApi: CustomOpenAIWireApi;
  } | null;
  responses: {
    providerId: string;
    enabled: boolean;
    baseUrl: string;
    hasApiKey: boolean;
  } | null;
}

const PROVIDER_ID_PATTERN = /^[a-z][a-z0-9-]*$/;

function trim(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeSupplierId(value: string): string {
  return trim(value).toLowerCase();
}

function claudeProviderId(id: string): string {
  return `${id}-claude`;
}

function codexProviderId(id: string): string {
  return `${id}-codex`;
}

function opencodeProviderId(id: string): string {
  return `${id}-opencode`;
}

function piProviderId(id: string): string {
  return `${id}-pi`;
}

function kimiProviderId(id: string): string {
  return `${id}-kimi`;
}

function grokbuildProviderId(id: string): string {
  return `${id}-grokbuild`;
}

function dshProviderId(id: string): string {
  return `${id}-dsh`;
}

function anthropicProviderId(id: string): string {
  return `${id}-anthropic`;
}

function openaiProviderId(id: string): string {
  return `${id}-openai`;
}

export function buildModelGatewayProviderIds(id: string): {
  claudeProviderId: string;
  codexProviderId: string;
  opencodeProviderId: string;
  piProviderId: string;
  kimiProviderId: string;
  grokbuildProviderId: string;
  dshProviderId: string;
} {
  const normalizedId = normalizeSupplierId(id);
  return {
    claudeProviderId: claudeProviderId(normalizedId),
    codexProviderId: codexProviderId(normalizedId),
    opencodeProviderId: opencodeProviderId(normalizedId),
    piProviderId: piProviderId(normalizedId),
    kimiProviderId: kimiProviderId(normalizedId),
    grokbuildProviderId: grokbuildProviderId(normalizedId),
    dshProviderId: dshProviderId(normalizedId),
  };
}

function resolveProviderIdsForPreset(
  ids: ReturnType<typeof buildModelGatewayProviderIds>,
  protocolPreset: ModelGatewayProtocolPreset | CustomModelProtocolPreset | null | undefined,
): string[] | null {
  if (protocolPreset === "claude") {
    return [ids.claudeProviderId];
  }
  if (protocolPreset === "codex") {
    return [ids.codexProviderId];
  }
  if (protocolPreset === "openai") {
    return [
      ids.opencodeProviderId,
      ids.piProviderId,
      ids.kimiProviderId,
      ids.grokbuildProviderId,
      ids.dshProviderId,
    ];
  }
  return null;
}

export function buildModelGatewayProviderIdList(
  id: string,
  options?: {
    protocolPreset?: ModelGatewayProtocolPreset | CustomModelProtocolPreset | null;
    supplyScope?: ModelGatewaySupplyScope | null;
    attachToAllAgents?: boolean;
  },
): string[] {
  const ids = buildModelGatewayProviderIds(id);
  const all = [
    ids.claudeProviderId,
    ids.codexProviderId,
    ids.opencodeProviderId,
    ids.piProviderId,
    ids.kimiProviderId,
    ids.grokbuildProviderId,
    ids.dshProviderId,
  ];
  const presetIds = resolveProviderIdsForPreset(ids, options?.protocolPreset);
  if (options?.supplyScope === "all" || options?.protocolPreset === "all") {
    return all;
  }
  if (options?.supplyScope === "matched") {
    return presetIds ?? all;
  }
  if (options?.attachToAllAgents === true) {
    return all;
  }
  return presetIds ?? all;
}

/** Thinking options shown by the model editor. */
export const CUSTOM_MODEL_THINKING_LEVELS = CUSTOM_MODEL_THINKING_OPTIONS.slice(0, 3);

/** Single on/off thinking option that survives Codex normalize (maps to medium effort). */
export const CUSTOM_MODEL_THINKING_SINGLE = [
  { id: "medium", label: "Thinking", isDefault: true },
] as const;

/**
 * Infers protocol preset from enabled upstreams when not stored on the gateway.
 */
export function inferProtocolPresetFromUpstreams(upstreams: {
  anthropic?: { enabled?: boolean };
  chatCompletions?: { enabled?: boolean };
  responses?: { enabled?: boolean };
}): ModelGatewayProtocolPreset {
  const anthropic = upstreams.anthropic?.enabled === true;
  const chat = upstreams.chatCompletions?.enabled === true;
  const responses = upstreams.responses?.enabled === true;
  const count = Number(anthropic) + Number(chat) + Number(responses);
  if (count === 1) {
    if (anthropic) return "claude";
    if (responses) return "codex";
    if (chat) return "openai";
  }
  if (count > 1) return "all";
  return "openai";
}

/**
 * Resolves the effective supply scope for badge display and face materialization.
 * Mirrors the server branch order in `resolveGatewayAgentFaces`: stored
 * `supplyScope` wins, legacy `attachToAllAgents === true` maps to "all", then
 * the stored preset (all → "all", single protocol → "matched"), then upstream
 * inference (multi-upstream → "all").
 */
export function resolveEffectiveSupplyScope(input: {
  supplyScope?: ModelGatewaySupplyScope | null;
  attachToAllAgents?: boolean;
  protocolPreset?: ModelGatewayProtocolPreset | null;
  upstreams?: {
    anthropic?: { enabled?: boolean };
    chatCompletions?: { enabled?: boolean };
    responses?: { enabled?: boolean };
  };
}): ModelGatewaySupplyScope {
  if (input.supplyScope === "all" || input.supplyScope === "matched") {
    return input.supplyScope;
  }
  if (input.attachToAllAgents === true) {
    return "all";
  }
  if (input.protocolPreset) {
    return input.protocolPreset === "all" ? "all" : "matched";
  }
  return inferProtocolPresetFromUpstreams(input.upstreams ?? {}) === "all" ? "all" : "matched";
}

export function resolveThinkingModeFromModel(
  model: ProviderProfileModel | undefined,
): CustomModelThinkingMode {
  const options = model?.thinkingOptions ?? [];
  if (options.length === 0) {
    return "off";
  }
  const ids = new Set(options.map((option) => option.id));
  if (options.length >= 3 && ids.has("low") && ids.has("medium") && ids.has("high")) {
    return "levels";
  }
  return "single";
}

export function buildThinkingOptionsForMode(
  mode: CustomModelThinkingMode | undefined,
  supportsThinking?: boolean,
): Array<{ id: string; label: string; isDefault?: boolean }> | undefined {
  const resolved: CustomModelThinkingMode = mode ?? (supportsThinking === true ? "single" : "off");
  if (resolved === "off") {
    return undefined;
  }
  if (resolved === "levels") {
    return CUSTOM_MODEL_THINKING_OPTIONS.map((option) => ({ ...option }));
  }
  return CUSTOM_MODEL_THINKING_SINGLE.slice();
}

export function buildThinkingOptionsForLevels(
  levels: CustomModelThinkingLevel[],
): Array<{ id: string; label: string; isDefault?: boolean }> | undefined {
  const selected = new Set(levels);
  if (selected.size === 0) {
    return undefined;
  }
  return CUSTOM_MODEL_THINKING_OPTIONS.filter((option) => selected.has(option.id)).map((option) =>
    Object.assign({}, option, {
      isDefault: option.id === "medium" || (!selected.has("medium") && option.id === levels[0]),
    }),
  );
}

export function buildCustomModelProviderIds(id: string): {
  anthropicProviderId: string;
  openaiProviderId: string;
} {
  const normalizedId = normalizeSupplierId(id);
  return {
    anthropicProviderId: anthropicProviderId(normalizedId),
    openaiProviderId: openaiProviderId(normalizedId),
  };
}

function stripLegacyFormatSuffix(providerId: string): string | null {
  if (providerId.endsWith("-anthropic")) {
    return providerId.slice(0, -"anthropic".length - 1);
  }
  if (providerId.endsWith("-openai")) {
    return providerId.slice(0, -"openai".length - 1);
  }
  return null;
}

function normalizeLabel(label: string, id: string): string {
  return trim(label) || id;
}

function stripGeneratedLabelSuffix(label: string): string {
  return label.replace(/\s+(Anthropic|OpenAI|Claude|Codex|OpenCode)$/u, "").trim();
}

function normalizePositiveInteger(value: number | undefined): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  const normalized = Math.trunc(value);
  return normalized > 0 ? normalized : undefined;
}

function normalizeModelInput(
  model: string | CustomModelProviderModelInput,
): CustomModelProviderModelInput {
  return typeof model === "string" ? { id: model } : model;
}

function resolveThinkingOptions(
  input: CustomModelProviderModelInput,
): Array<{ id: string; label: string; isDefault?: boolean }> | undefined {
  if (input.thinkingOptions && input.thinkingOptions.length > 0) {
    return input.thinkingOptions;
  }
  if (input.thinkingLevels && input.thinkingLevels.length > 0) {
    return buildThinkingOptionsForLevels(input.thinkingLevels);
  }
  return buildThinkingOptionsForMode(input.thinkingMode, input.supportsThinking);
}

function normalizeModels(
  models: Array<string | CustomModelProviderModelInput>,
): ProviderProfileModel[] {
  const seen = new Set<string>();
  const result: ProviderProfileModel[] = [];
  for (const raw of models) {
    const input = normalizeModelInput(raw);
    const id = trim(input.id);
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    const label = trim(input.label) || id;
    const contextWindowMaxTokens = normalizePositiveInteger(input.contextWindowMaxTokens);
    const thinkingOptions = resolveThinkingOptions(input);
    result.push({
      id,
      label,
      ...(contextWindowMaxTokens !== undefined ? { contextWindowMaxTokens } : {}),
      ...(input.supportsImages === true ? { supportsImages: true } : {}),
      ...(input.supportsTools === true ? { supportsTools: true } : {}),
      ...(thinkingOptions && thinkingOptions.length > 0 ? { thinkingOptions } : {}),
      ...(result.length === 0 ? { isDefault: true } : {}),
    });
  }
  return result;
}

function slugifyGatewayId(value: string): string {
  const normalized = trim(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  if (!normalized) {
    return "custom";
  }
  if (/^[a-z]/.test(normalized)) {
    return normalized;
  }
  return `m-${normalized}`;
}

function allocateGatewayId(
  preferred: string,
  currentGateways: MutableDaemonConfig["modelGateways"] | undefined,
): string {
  const base = slugifyGatewayId(preferred);
  if (!currentGateways?.[base] || currentGateways[base]?.enabled === false) {
    return base;
  }
  let suffix = 2;
  while (
    currentGateways[`${base}-${suffix}`] &&
    currentGateways[`${base}-${suffix}`]?.enabled !== false
  ) {
    suffix += 1;
  }
  return `${base}-${suffix}`;
}

function pickPrimaryBaseUrl(gateway: ModelGatewayConfig | undefined): string {
  if (!gateway?.upstreams) {
    return "";
  }
  const { chatCompletions, responses, anthropic } = gateway.upstreams;
  if (chatCompletions?.enabled && trim(chatCompletions.baseUrl)) {
    return trim(chatCompletions.baseUrl);
  }
  if (responses?.enabled && trim(responses.baseUrl)) {
    return trim(responses.baseUrl);
  }
  if (anthropic?.enabled && trim(anthropic.baseUrl)) {
    return trim(anthropic.baseUrl);
  }
  return (
    trim(chatCompletions?.baseUrl) || trim(responses?.baseUrl) || trim(anthropic?.baseUrl) || ""
  );
}

function modelHasThinking(model: ProviderProfileModel): boolean {
  return Array.isArray(model.thinkingOptions) && model.thinkingOptions.length > 0;
}

/**
 * Flattens enabled model gateways into one list row per model (fig2-style catalog).
 * @param gateways Daemon modelGateways map
 * @returns Sorted saved-model rows
 */
export function collectSavedModels(
  gateways: MutableDaemonConfig["modelGateways"] | undefined,
): CollectedSavedModel[] {
  const rows = Object.values(gateways ?? {})
    .filter(
      (gateway): gateway is ModelGatewayConfig => Boolean(gateway?.id) && gateway.enabled !== false,
    )
    .flatMap(collectGatewaySavedModelRows);
  return rows.sort(compareSavedModels);
}

function collectGatewaySavedModelRows(gateway: ModelGatewayConfig): CollectedSavedModel[] {
  const gatewayLabel = gateway.label ?? gateway.id;
  const protocolPreset =
    gateway.protocolPreset ?? inferProtocolPresetFromUpstreams(gateway.upstreams ?? {});
  const attachToAllAgents = gateway.attachToAllAgents === true;
  const supplyScope = resolveEffectiveSupplyScope({
    supplyScope: gateway.supplyScope,
    attachToAllAgents,
    protocolPreset: gateway.protocolPreset ?? null,
    upstreams: gateway.upstreams,
  });
  const providerIds = buildModelGatewayProviderIdList(gateway.id, {
    protocolPreset,
    supplyScope,
    attachToAllAgents,
  });
  const baseUrl = pickPrimaryBaseUrl(gateway);
  return (gateway.models ?? [])
    .map((model) =>
      buildSavedModelRow({
        gateway,
        gatewayLabel,
        protocolPreset,
        supplyScope,
        attachToAllAgents,
        providerIds,
        baseUrl,
        model,
      }),
    )
    .filter((row): row is CollectedSavedModel => row !== null);
}

function buildSavedModelRow(input: {
  gateway: ModelGatewayConfig;
  gatewayLabel: string;
  protocolPreset: ModelGatewayProtocolPreset;
  supplyScope: ModelGatewaySupplyScope;
  attachToAllAgents: boolean;
  providerIds: string[];
  baseUrl: string;
  model: ProviderProfileModel;
}): CollectedSavedModel | null {
  const modelId = trim(input.model.id);
  if (!modelId) {
    return null;
  }
  const thinkingOptions = input.model.thinkingOptions;
  const thinkingLevels = thinkingOptions
    ?.map((option) => option.id)
    .filter(isCustomModelThinkingLevel);
  return {
    key: `${input.gateway.id}:${modelId}`,
    gatewayId: input.gateway.id,
    gatewayLabel: input.gatewayLabel,
    modelId,
    label: trim(input.model.label) || modelId,
    ...(typeof input.model.contextWindowMaxTokens === "number"
      ? { contextWindowMaxTokens: input.model.contextWindowMaxTokens }
      : {}),
    ...(input.model.supportsImages === true ? { supportsImages: true } : {}),
    ...(input.model.supportsTools === true ? { supportsTools: true } : {}),
    ...(modelHasThinking(input.model) ? { supportsThinking: true } : {}),
    thinkingMode: resolveThinkingModeFromModel(input.model),
    ...(thinkingOptions && thinkingOptions.length > 0
      ? { thinkingOptions: thinkingOptions.map((option) => ({ ...option })) }
      : {}),
    ...(thinkingOptions && thinkingOptions.length > 0 ? { thinkingLevels } : {}),
    protocolPreset: input.protocolPreset,
    supplyScope: input.supplyScope,
    ...(input.attachToAllAgents ? { attachToAllAgents: true } : {}),
    providerIds: input.providerIds,
    ...(input.baseUrl ? { baseUrl: input.baseUrl } : {}),
  };
}

function isCustomModelThinkingLevel(id: string): id is CustomModelThinkingLevel {
  return id === "low" || id === "medium" || id === "high" || id === "very-high" || id === "max";
}

function compareSavedModels(a: CollectedSavedModel, b: CollectedSavedModel): number {
  const labelCompare = a.label.localeCompare(b.label);
  if (labelCompare !== 0) {
    return labelCompare;
  }
  const gatewayCompare = a.gatewayLabel.localeCompare(b.gatewayLabel);
  if (gatewayCompare !== 0) {
    return gatewayCompare;
  }
  return a.modelId.localeCompare(b.modelId);
}

function emptyEndpoint(): CustomModelProviderEndpoint {
  return { enabled: false, baseUrl: "", apiKey: "" };
}

function emptyOpenAiEndpoint(): CustomModelProviderOpenAIEndpoint {
  return { enabled: false, baseUrl: "", apiKey: "", wireApi: "chat" };
}

function toModelInput(model: ProviderProfileModel): CustomModelProviderModelInput {
  const thinkingMode = resolveThinkingModeFromModel(model);
  return {
    id: model.id,
    label: model.label,
    contextWindowMaxTokens: model.contextWindowMaxTokens,
    supportsImages: model.supportsImages,
    supportsTools: model.supportsTools,
    supportsThinking: modelHasThinking(model),
    thinkingMode,
    ...(model.thinkingOptions && model.thinkingOptions.length > 0
      ? { thinkingOptions: model.thinkingOptions.map((option) => ({ ...option })) }
      : {}),
  };
}

function resolveSimpleOpenAiEndpoints(input: SaveOpenAiCompatibleModelInput): {
  anthropic: CustomModelProviderEndpoint;
  openai: CustomModelProviderOpenAIEndpoint;
  responses: CustomModelProviderEndpoint;
} {
  if (input.customProtocol) {
    return {
      anthropic: input.anthropic ?? emptyEndpoint(),
      openai: input.openai ?? emptyOpenAiEndpoint(),
      responses: input.responses ?? emptyEndpoint(),
    };
  }
  const baseUrl = trim(input.baseUrl);
  const apiKey = trim(input.apiKey);
  if (!baseUrl || !apiKey) {
    throw new Error("Base URL and API key are required");
  }
  const preset: CustomModelProtocolPreset = input.protocolPreset ?? "openai";
  if (preset === "claude") {
    return {
      anthropic: { enabled: true, baseUrl, apiKey },
      openai: emptyOpenAiEndpoint(),
      responses: emptyEndpoint(),
    };
  }
  if (preset === "codex") {
    return {
      anthropic: emptyEndpoint(),
      openai: emptyOpenAiEndpoint(),
      responses: { enabled: true, baseUrl, apiKey },
    };
  }
  return {
    anthropic: emptyEndpoint(),
    responses: emptyEndpoint(),
    openai: {
      enabled: true,
      baseUrl,
      apiKey,
      wireApi: "chat",
    },
  };
}

function resolveThinkingMode(input: SaveOpenAiCompatibleModelInput): CustomModelThinkingMode {
  if (input.thinkingMode) {
    return input.thinkingMode;
  }
  if (input.thinkingLevels && input.thinkingLevels.length > 0) {
    return "levels";
  }
  return input.supportsThinking === true ? "single" : "off";
}

function buildNextModelInput(
  input: SaveOpenAiCompatibleModelInput,
  modelId: string,
  modelLabel: string,
): CustomModelProviderModelInput {
  const thinkingMode = resolveThinkingMode(input);
  const thinkingOptions = input.thinkingLevels
    ? buildThinkingOptionsForLevels(input.thinkingLevels)
    : buildThinkingOptionsForMode(thinkingMode);
  return {
    id: modelId,
    label: modelLabel,
    ...(input.contextWindowMaxTokens !== undefined
      ? { contextWindowMaxTokens: input.contextWindowMaxTokens }
      : {}),
    ...(input.supportsImages ? { supportsImages: true } : {}),
    ...(input.supportsTools ? { supportsTools: true } : {}),
    thinkingMode,
    ...(input.thinkingLevels ? { thinkingLevels: input.thinkingLevels } : {}),
    ...(thinkingOptions ? { thinkingOptions, supportsThinking: true } : {}),
  };
}

function endpointFromUpstream(
  upstream: { enabled?: boolean; baseUrl?: string; apiKey?: string } | undefined,
): CustomModelProviderEndpoint {
  return {
    enabled: upstream?.enabled === true,
    baseUrl: upstream?.baseUrl ?? "",
    apiKey: upstream?.apiKey ?? "",
  };
}

function resolveSaveGatewayIdentity(input: {
  modelId: string;
  modelLabel: string;
  previousModelId: string;
  gatewayId?: string | null;
  currentGateways: NonNullable<MutableDaemonConfig["modelGateways"]>;
}): {
  gatewayId: string;
  gatewayLabel: string;
  existingGatewayId: string;
  existingGateway: ModelGatewayConfig | undefined;
  previousId: string | null;
} {
  const existingGatewayId = normalizeSupplierId(input.gatewayId ?? "");
  const existingGateway = existingGatewayId ? input.currentGateways[existingGatewayId] : undefined;
  const gatewayId =
    existingGatewayId && existingGateway
      ? existingGatewayId
      : allocateGatewayId(input.modelLabel || input.modelId, input.currentGateways);

  if (!PROVIDER_ID_PATTERN.test(gatewayId)) {
    throw new Error(
      "Provider ID must start with a letter and use lowercase letters, numbers, or hyphens",
    );
  }

  const gatewayLabel =
    existingGateway?.label && existingGateway.models && existingGateway.models.length > 1
      ? existingGateway.label
      : input.modelLabel;

  return {
    gatewayId,
    gatewayLabel,
    existingGatewayId,
    existingGateway,
    previousId: existingGatewayId && existingGatewayId !== gatewayId ? existingGatewayId : null,
  };
}

function mergeSavedGatewayModels(
  existingModels: ProviderProfileModel[] | undefined,
  previousModelId: string,
  nextModelInput: CustomModelProviderModelInput,
): CustomModelProviderModelInput[] {
  const withoutPrevious = (existingModels ?? [])
    .filter((model) => model.id !== previousModelId && model.id !== nextModelInput.id)
    .map(toModelInput);
  return [...withoutPrevious, nextModelInput];
}

/**
 * Builds a modelGateways patch for the simple OpenAI-compatible add/edit form.
 * Creates a new gateway when gatewayId is omitted; merges into an existing gateway when editing.
 * @param input Save payload from the fig3-style editor
 * @returns Daemon config patch
 */
export function buildSaveOpenAiCompatibleModelPatch(
  input: SaveOpenAiCompatibleModelInput,
): MutableDaemonConfigPatch {
  const modelId = trim(input.modelId);
  if (!modelId) {
    throw new Error("Model ID is required");
  }
  const modelLabel = trim(input.label) || modelId;
  const previousModelId = trim(input.previousModelId) || modelId;
  const currentGateways = input.currentGateways ?? {};
  const identity = resolveSaveGatewayIdentity({
    modelId,
    modelLabel,
    previousModelId,
    gatewayId: input.gatewayId,
    currentGateways,
  });

  const { anthropic, openai, responses } = resolveSimpleOpenAiEndpoints(input);
  const nextModelInput = buildNextModelInput(input, modelId, modelLabel);
  const mergedModels = mergeSavedGatewayModels(
    identity.existingGateway?.models,
    previousModelId,
    nextModelInput,
  );

  const protocolPreset: ModelGatewayProtocolPreset = input.customProtocol
    ? inferProtocolPresetFromUpstreams({
        anthropic,
        chatCompletions: openai,
        responses,
      })
    : (input.protocolPreset ?? "openai");

  return buildSaveCustomModelProviderPatch({
    currentGateways,
    previousId: identity.previousId,
    id: identity.gatewayId,
    label: identity.gatewayLabel,
    models: mergedModels,
    anthropic,
    openai,
    responses,
    protocolPreset,
    supplyScope: input.supplyScope,
    supplyScopeSupported: input.supplyScopeSupported,
    attachToAllAgents: input.attachToAllAgents === true,
  });
}

/**
 * Removes one model from a gateway; disables the gateway when no models remain.
 * @param input Delete payload
 * @returns Daemon config patch
 */
export function buildDeleteSavedModelPatch(input: DeleteSavedModelInput): MutableDaemonConfigPatch {
  const gatewayId = normalizeSupplierId(input.gatewayId);
  const modelId = trim(input.modelId);
  if (!gatewayId || !modelId) {
    throw new Error("Gateway ID and model ID are required");
  }
  const gateway = input.currentGateways?.[gatewayId];
  if (!gateway) {
    return buildDisableCustomModelProviderPatch(gatewayId);
  }
  const remaining = (gateway.models ?? []).filter((model) => model.id !== modelId);
  if (remaining.length === 0) {
    return buildDisableCustomModelProviderPatch(gatewayId);
  }

  return buildSaveCustomModelProviderPatch({
    currentGateways: input.currentGateways,
    previousId: gatewayId,
    id: gatewayId,
    label: gateway.label ?? gatewayId,
    models: remaining.map(toModelInput),
    anthropic: endpointFromUpstream(gateway.upstreams?.anthropic),
    openai: {
      ...endpointFromUpstream(gateway.upstreams?.chatCompletions),
      wireApi: "chat",
    },
    responses: endpointFromUpstream(gateway.upstreams?.responses),
    protocolPreset: gateway.protocolPreset,
    // Normalize legacy configs on supporting daemons so the re-save always
    // carries an explicit supplyScope (no deepMerge short-circuit).
    supplyScope: resolveEffectiveSupplyScope({
      supplyScope: gateway.supplyScope,
      attachToAllAgents: gateway.attachToAllAgents === true,
      protocolPreset: gateway.protocolPreset ?? null,
      upstreams: gateway.upstreams,
    }),
    supplyScopeSupported: input.supplyScopeSupported,
    attachToAllAgents: gateway.attachToAllAgents === true,
  });
}

function normalizeOpenCodeModels(models: ProviderProfileModel[]): ProviderProfileModel[] {
  return models.map((model) =>
    Object.assign({}, model, {
      id: model.id.startsWith("openai/") ? model.id : `openai/${model.id}`,
    }),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readModelArray(value: unknown): ProviderProfileModel[] {
  return Array.isArray(value) ? (value as ProviderProfileModel[]) : [];
}

function readModels(provider: ProviderConfig | undefined): ProviderProfileModel[] {
  return readModelArray(provider?.models).length > 0
    ? readModelArray(provider?.models)
    : readModelArray(provider?.additionalModels);
}

function readEnv(provider: ProviderConfig | undefined, key: string): string {
  const env = isRecord(provider?.env) ? provider.env : null;
  const value = env?.[key];
  return typeof value === "string" ? value : "";
}

function hasApiKey(provider: ProviderConfig | undefined, key: string): boolean {
  return readEnv(provider, key).trim().length > 0;
}

function resolveWireApi(provider: ProviderConfig | undefined): CustomOpenAIWireApi {
  return readEnv(provider, "OPENAI_WIRE_API") === "chat" ? "chat" : "responses";
}

function normalizeGatewayEndpoint(endpoint: CustomModelProviderEndpoint): {
  enabled: boolean;
  baseUrl: string;
  apiKey: string;
} {
  return {
    enabled: endpoint.enabled,
    baseUrl: trim(endpoint.baseUrl),
    apiKey: trim(endpoint.apiKey),
  };
}

function requireConfiguredEndpoint(name: string, endpoint: CustomModelProviderEndpoint): void {
  if (!endpoint.enabled) {
    return;
  }
  if (!trim(endpoint.baseUrl) || !trim(endpoint.apiKey)) {
    throw new Error(`${name} interface requires base URL and API key`);
  }
}

export function buildDisableCustomModelProviderPatch(id: string): MutableDaemonConfigPatch {
  const normalizedId = normalizeSupplierId(id);
  if (!PROVIDER_ID_PATTERN.test(normalizedId)) {
    throw new Error(
      "Provider ID must start with a letter and use lowercase letters, numbers, or hyphens",
    );
  }
  return {
    modelGateways: {
      [normalizedId]: { enabled: false },
    },
  };
}

function buildSupplyScopePatch(
  supported: boolean,
  scope: ModelGatewaySupplyScope | undefined,
  attachToAllAgents: boolean,
): { supplyScope: ModelGatewaySupplyScope } | { attachToAllAgents: true } | Record<string, never> {
  if (supported && scope) {
    return { supplyScope: scope };
  }
  if (attachToAllAgents) {
    return { attachToAllAgents: true };
  }
  return {};
}

export function buildSaveCustomModelProviderPatch(
  input: SaveCustomModelProviderInput,
): MutableDaemonConfigPatch {
  const id = normalizeSupplierId(input.id);
  if (!PROVIDER_ID_PATTERN.test(id)) {
    throw new Error(
      "Provider ID must start with a letter and use lowercase letters, numbers, or hyphens",
    );
  }
  const label = normalizeLabel(input.label, id);
  const models = normalizeModels(input.models);
  if (models.length === 0) {
    throw new Error("Add at least one model");
  }
  if (!input.anthropic.enabled && !input.openai.enabled && !input.responses.enabled) {
    throw new Error("Enable at least one interface format");
  }

  requireConfiguredEndpoint("Anthropic", input.anthropic);
  requireConfiguredEndpoint("Chat Completions", input.openai);
  requireConfiguredEndpoint("Responses", input.responses);

  const gatewayPatches: NonNullable<MutableDaemonConfigPatch["modelGateways"]> = {};
  const previousId = normalizeSupplierId(input.previousId ?? "");
  if (previousId && previousId !== id) {
    gatewayPatches[previousId] = { enabled: false } satisfies ModelGatewayPatch;
  }

  const ids = buildModelGatewayProviderIds(id);
  const protocolPreset: ModelGatewayProtocolPreset =
    input.protocolPreset ??
    inferProtocolPresetFromUpstreams({
      anthropic: input.anthropic,
      chatCompletions: input.openai,
      responses: input.responses,
    });
  const supplyScopeSupported = input.supplyScopeSupported === true;
  const attachToAllAgents = input.attachToAllAgents === true;
  // On supporting daemons always write an explicit supplyScope so a later edit
  // that flips the scope can never be short-circuited by the config-store
  // deepMerge (missing key → old value survives). Legacy daemons cannot parse
  // the new key (strict schema), so keep the old attachToAllAgents write path.
  const effectiveSupplyScope: ModelGatewaySupplyScope | undefined = supplyScopeSupported
    ? (input.supplyScope ??
      resolveEffectiveSupplyScope({
        supplyScope: null,
        attachToAllAgents,
        protocolPreset,
        upstreams: {
          anthropic: input.anthropic,
          chatCompletions: input.openai,
          responses: input.responses,
        },
      }))
    : undefined;

  gatewayPatches[id] = {
    id,
    label,
    enabled: true,
    models,
    protocolPreset,
    ...buildSupplyScopePatch(supplyScopeSupported, effectiveSupplyScope, attachToAllAgents),
    upstreams: {
      anthropic: normalizeGatewayEndpoint(input.anthropic),
      chatCompletions: normalizeGatewayEndpoint(input.openai),
      responses: normalizeGatewayEndpoint(input.responses),
    },
    generatedProviderIds: {
      claude: ids.claudeProviderId,
      codex: ids.codexProviderId,
      opencode: ids.opencodeProviderId,
      pi: ids.piProviderId,
      kimi: ids.kimiProviderId,
      grokbuild: ids.grokbuildProviderId,
      dsh: ids.dshProviderId,
    },
    generatedModels: {
      opencode: normalizeOpenCodeModels(models),
      pi: normalizeOpenCodeModels(models),
      kimi: models,
      grokbuild: models,
      dsh: models,
    },
  } satisfies ModelGatewayPatch;

  return { modelGateways: gatewayPatches };
}

function collectGatewayProviders(
  gateways: MutableDaemonConfig["modelGateways"] | undefined,
): CollectedCustomModelProvider[] {
  return Object.values(gateways ?? {})
    .filter((gateway): gateway is ModelGatewayConfig => Boolean(gateway?.id))
    .map(collectGatewayProvider);
}

function collectGatewayEndpoint(
  providerId: string,
  gatewayEnabled: boolean,
  upstream:
    | ModelGatewayConfig["upstreams"]["anthropic"]
    | ModelGatewayConfig["upstreams"]["chatCompletions"]
    | ModelGatewayConfig["upstreams"]["responses"]
    | undefined,
): NonNullable<CollectedCustomModelProvider["anthropic"]> {
  return {
    providerId,
    enabled: gatewayEnabled && upstream?.enabled === true,
    baseUrl: upstream?.baseUrl ?? "",
    hasApiKey: trim(upstream?.apiKey).length > 0,
  };
}

function collectGatewayProvider(gateway: ModelGatewayConfig): CollectedCustomModelProvider {
  const ids = buildModelGatewayProviderIds(gateway.id);
  const enabled = gateway.enabled !== false;
  return {
    id: gateway.id,
    label: gateway.label ?? gateway.id,
    providerIds: buildModelGatewayProviderIdList(gateway.id),
    models: gateway.models ?? [],
    anthropic: collectGatewayEndpoint(ids.claudeProviderId, enabled, gateway.upstreams?.anthropic),
    openai: {
      ...collectGatewayEndpoint(
        ids.opencodeProviderId,
        enabled,
        gateway.upstreams?.chatCompletions,
      ),
      wireApi: "chat",
    },
    responses: collectGatewayEndpoint(ids.codexProviderId, enabled, gateway.upstreams?.responses),
  };
}

function collectLegacyProviders(
  providers: MutableDaemonConfig["providers"] | undefined,
): CollectedCustomModelProvider[] {
  const grouped = new Map<string, CollectedCustomModelProvider>();

  for (const [providerId, rawProvider] of Object.entries(providers ?? {})) {
    const provider = rawProvider as ProviderConfig;
    const supplierId = stripLegacyFormatSuffix(providerId);
    if (!supplierId) {
      continue;
    }
    if (provider.extends !== "claude" && provider.extends !== "codex") {
      continue;
    }

    const existing = grouped.get(supplierId);
    const rawLabel = typeof provider.label === "string" ? provider.label : supplierId;
    const label = stripGeneratedLabelSuffix(rawLabel) || supplierId;
    const entry =
      existing ??
      ({
        id: supplierId,
        label,
        providerIds: [],
        models: readModels(provider),
        anthropic: null,
        openai: null,
        responses: null,
      } satisfies CollectedCustomModelProvider);

    if (!entry.providerIds.includes(providerId)) {
      entry.providerIds.push(providerId);
    }
    if (entry.models.length === 0) {
      entry.models = readModels(provider);
    }

    if (providerId.endsWith("-anthropic")) {
      entry.anthropic = {
        providerId,
        enabled: provider.enabled !== false,
        baseUrl: readEnv(provider, "ANTHROPIC_BASE_URL"),
        hasApiKey: hasApiKey(provider, "ANTHROPIC_AUTH_TOKEN"),
      };
    } else if (providerId.endsWith("-openai")) {
      entry.openai = {
        providerId,
        enabled: provider.enabled !== false,
        baseUrl: readEnv(provider, "OPENAI_BASE_URL"),
        hasApiKey: hasApiKey(provider, "OPENAI_API_KEY"),
        wireApi: resolveWireApi(provider),
      };
    }

    grouped.set(supplierId, entry);
  }

  return Array.from(grouped.values());
}

export function collectCustomModelProviders(
  gateways: MutableDaemonConfig["modelGateways"] | undefined,
  legacyProviders?: MutableDaemonConfig["providers"] | undefined,
): CollectedCustomModelProvider[] {
  const gatewayProviders = collectGatewayProviders(gateways);
  const gatewayIds = new Set(gatewayProviders.map((provider) => provider.id));
  const legacyProvidersOnly = collectLegacyProviders(legacyProviders).filter(
    (provider) => !gatewayIds.has(provider.id),
  );

  return [...gatewayProviders, ...legacyProvidersOnly].sort((a, b) => {
    const labelCompare = a.label.localeCompare(b.label);
    return labelCompare !== 0 ? labelCompare : a.id.localeCompare(b.id);
  });
}
