import type { OpencodeClient } from "@opencode-ai/sdk/v2/client";

import type {
  AgentFeature,
  AgentMode,
  AgentPersistenceHandle,
  AgentRuntimeInfo,
  AgentSlashCommand,
} from "../../agent-sdk-types.js";
import {
  applyRuntimeModelPrefix,
  isSelectableOpenCodeAgent,
  listOpenCodeCommandsFromSdk,
  mapOpenCodeAgentToMode,
  mergeOpenCodeModes,
  normalizeOpenCodeModeId,
  parseOpenCodeModelLookupKey,
  resolveOpenCodeRuntimeAgentId,
  type OpenCodeAgentConfig,
} from "./catalog.js";
import {
  OPENCODE_AUTO_ACCEPT_FEATURE_ID,
  OPENCODE_BUILD_MODE_ID,
  OPENCODE_LEGACY_FULL_ACCESS_MODE_ID,
} from "./constants.js";
import { buildOpenCodeAutoAcceptFeature } from "./helpers.js";

interface OpenCodeSessionRuntimeOptions {
  config: OpenCodeAgentConfig;
  client: Pick<OpencodeClient, "app" | "command">;
  sessionId: string;
  modelContextWindowsByModelKey: ReadonlyMap<string, number>;
  modelPrefix?: string;
  setAutoAcceptEnabled: (enabled: boolean) => void;
}

export interface OpenCodeTurnRuntimeConfig {
  model: { providerID: string; modelID: string } | undefined;
  configuredModel: string | undefined;
  effectiveMode: string;
  effectiveVariant: string | undefined;
}

/** Owns mutable OpenCode mode/model/feature state and provider catalog caching. */
export class OpenCodeSessionRuntime {
  private currentMode: string;
  private availableModesCache: AgentMode[] | null = null;
  private selectedModelContextWindowMaxTokens: number | undefined;

  constructor(private readonly options: OpenCodeSessionRuntimeOptions) {
    this.currentMode = normalizeOpenCodeModeId(options.config.modeId);
    this.selectedModelContextWindowMaxTokens = this.resolveConfiguredModelContextWindowMaxTokens(
      options.config.model,
    );
  }

  getFeatures(): AgentFeature[] {
    return [buildOpenCodeAutoAcceptFeature(this.options.config)];
  }

  getRuntimeInfo(): AgentRuntimeInfo {
    return {
      provider: "opencode",
      sessionId: this.options.sessionId,
      model: this.options.config.model ?? null,
      modeId: this.currentMode,
    };
  }

  async setModel(modelId: string | null): Promise<void> {
    const normalized = typeof modelId === "string" && modelId.trim() ? modelId : null;
    this.options.config.model = applyRuntimeModelPrefix(
      normalized ?? undefined,
      this.options.modelPrefix ?? null,
    );
    this.selectedModelContextWindowMaxTokens = this.resolveConfiguredModelContextWindowMaxTokens(
      this.options.config.model,
    );
  }

  async setThinkingOption(thinkingOptionId: string | null): Promise<void> {
    const normalized =
      typeof thinkingOptionId === "string" && thinkingOptionId.trim() ? thinkingOptionId : null;
    this.options.config.thinkingOptionId = normalized ?? undefined;
  }

  getTurnConfig(): OpenCodeTurnRuntimeConfig {
    return {
      model: this.parseModel(this.options.config.model),
      configuredModel: this.options.config.model,
      effectiveMode: resolveOpenCodeRuntimeAgentId(this.currentMode),
      effectiveVariant: this.options.config.thinkingOptionId,
    };
  }

  getModelContextWindowsByModelKey(): ReadonlyMap<string, number> {
    return this.options.modelContextWindowsByModelKey;
  }
  getSelectedModelContextWindowMaxTokens(): number | undefined {
    return this.selectedModelContextWindowMaxTokens;
  }

  onAssistantModelContextWindowResolved(contextWindowMaxTokens: number): void {
    if (!this.options.config.model) {
      this.selectedModelContextWindowMaxTokens = contextWindowMaxTokens;
    }
  }

  async getAvailableModes(): Promise<AgentMode[]> {
    if (this.availableModesCache) {
      return this.availableModesCache;
    }
    const response = await this.options.client.app.agents({
      directory: this.options.config.cwd,
    });
    const agents = response.error || !response.data ? [] : response.data;
    const discovered = agents.filter(isSelectableOpenCodeAgent).map(mapOpenCodeAgentToMode);
    this.availableModesCache = mergeOpenCodeModes(discovered);
    return this.availableModesCache;
  }

  getCurrentMode(): string {
    return this.currentMode;
  }

  async listCommands(): Promise<AgentSlashCommand[]> {
    return await listOpenCodeCommandsFromSdk(this.options.client, this.options.config.cwd);
  }

  async setMode(modeId: string): Promise<void> {
    const normalized = normalizeOpenCodeModeId(modeId);
    if (normalized === OPENCODE_LEGACY_FULL_ACCESS_MODE_ID) {
      this.currentMode = OPENCODE_BUILD_MODE_ID;
      await this.setFeature(OPENCODE_AUTO_ACCEPT_FEATURE_ID, true);
      return;
    }
    this.currentMode = normalized;
    this.options.config.modeId = normalized;
  }

  async setFeature(featureId: string, value: unknown): Promise<void> {
    if (featureId !== OPENCODE_AUTO_ACCEPT_FEATURE_ID) {
      throw new Error(`Unsupported OpenCode feature '${featureId}'`);
    }
    const enabled = value === true;
    this.options.setAutoAcceptEnabled(enabled);
    this.options.config.featureValues = {
      ...this.options.config.featureValues,
      [OPENCODE_AUTO_ACCEPT_FEATURE_ID]: enabled,
    };
  }

  describePersistence(): AgentPersistenceHandle {
    const config = this.options.config;
    return {
      provider: "opencode",
      sessionId: this.options.sessionId,
      nativeHandle: this.options.sessionId,
      metadata: {
        cwd: config.cwd,
        ...(config.modeId ? { modeId: config.modeId } : {}),
        ...(config.model ? { model: config.model } : {}),
      },
    };
  }

  private parseModel(model?: string): { providerID: string; modelID: string } | undefined {
    if (!model) {
      return undefined;
    }
    const parts = model.split("/");
    if (parts.length >= 2) {
      return { providerID: parts[0], modelID: parts.slice(1).join("/") };
    }
    return { providerID: this.options.modelPrefix ?? "opencode", modelID: model };
  }

  private resolveConfiguredModelContextWindowMaxTokens(
    modelId: string | undefined,
  ): number | undefined {
    const modelLookupKey = parseOpenCodeModelLookupKey(modelId);
    return modelLookupKey
      ? this.options.modelContextWindowsByModelKey.get(modelLookupKey)
      : undefined;
  }
}
