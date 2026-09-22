import type {
  AgentFeature,
  AgentMode,
  AgentRuntimeInfo,
  AgentSessionConfig,
} from "../../agent-sdk-types.js";
import { buildCodexFeatures, codexModelSupportsFastMode } from "../codex-feature-definitions.js";
import { CODEX_PROVIDER } from "./client.js";
import type { ResolvedCodexCollaborationMode } from "./session-metadata.js";
import {
  CODEX_MODES,
  DEFAULT_CODEX_MODE_ID,
  normalizeCodexThinkingOptionId,
  validateCodexMode,
} from "./turn-config.js";

interface CodexSessionRuntimeOptions {
  config: AgentSessionConfig;
  autoReviewEnabled: boolean;
  getThreadId: () => string | null;
  isConnected: () => boolean;
  connect: () => Promise<void>;
  ensureThread: () => Promise<void>;
  getResolvedCollaborationMode: () => ResolvedCodexCollaborationMode | null;
  hasPlanCollaborationMode: () => boolean;
  refreshResolvedCollaborationMode: (planModeEnabled: boolean) => void;
}

/** Owns mutable Codex runtime configuration, feature state, and persistence metadata. */
export class CodexSessionRuntime {
  private readonly config: AgentSessionConfig;
  private currentMode: string;
  private cachedRuntimeInfo: AgentRuntimeInfo | null = null;
  private serviceTier: "fast" | null = null;
  private planModeEnabled = false;

  constructor(private readonly options: CodexSessionRuntimeOptions) {
    const modeId = options.config.modeId ?? DEFAULT_CODEX_MODE_ID;
    validateCodexMode(modeId);
    this.currentMode = modeId;
    this.config = { ...options.config, modeId };
    this.config.thinkingOptionId = normalizeCodexThinkingOptionId(this.config.thinkingOptionId);
    if (this.config.featureValues?.fast_mode && codexModelSupportsFastMode(this.config.model)) {
      this.serviceTier = "fast";
    }
    if (this.config.featureValues?.plan_mode) {
      this.planModeEnabled = true;
    }
  }

  getConfig(): AgentSessionConfig {
    return this.config;
  }

  getMode(): string {
    return this.currentMode;
  }

  setModeFromBootstrap(modeId: string): void {
    this.currentMode = modeId;
  }

  getServiceTier(): "fast" | null {
    return this.serviceTier;
  }

  isPlanModeEnabled(): boolean {
    return this.planModeEnabled;
  }

  getFeatures(): AgentFeature[] {
    return buildCodexFeatures({
      modelId: this.config.model,
      fastModeEnabled: this.serviceTier === "fast",
      planModeEnabled: this.planModeEnabled,
      planModeAvailable: this.options.hasPlanCollaborationMode(),
    });
  }

  async getRuntimeInfo(): Promise<AgentRuntimeInfo> {
    if (this.cachedRuntimeInfo) return { ...this.cachedRuntimeInfo };
    // Prefer a lightweight snapshot when the app-server is not connected yet so
    // registration/refresh does not force a cold spawn. startTurn still connects.
    if (!this.options.isConnected()) {
      return {
        provider: CODEX_PROVIDER,
        sessionId: this.options.getThreadId(),
        model: this.config.model ?? null,
        thinkingOptionId: normalizeCodexThinkingOptionId(this.config.thinkingOptionId) ?? null,
        modeId: this.currentMode,
      };
    }
    if (!this.options.getThreadId()) {
      await this.options.ensureThread();
    }
    const collaborationMode = this.options.getResolvedCollaborationMode();
    const info: AgentRuntimeInfo = {
      provider: CODEX_PROVIDER,
      sessionId: this.options.getThreadId(),
      model: this.config.model ?? null,
      thinkingOptionId: normalizeCodexThinkingOptionId(this.config.thinkingOptionId) ?? null,
      modeId: this.currentMode,
      extra: collaborationMode ? { collaborationMode: collaborationMode.name } : undefined,
    };
    this.cachedRuntimeInfo = info;
    return { ...info };
  }

  getAvailableModes(): AgentMode[] {
    if (this.options.autoReviewEnabled) {
      return CODEX_MODES;
    }
    return CODEX_MODES.filter((mode) => mode.id !== "auto-review");
  }

  getCurrentMode(): string {
    return this.currentMode;
  }

  setMode(modeId: string): void {
    validateCodexMode(modeId);
    this.currentMode = modeId;
    this.invalidateRuntimeInfo();
  }

  setModel(modelId: string | null): void {
    this.config.model = modelId ?? undefined;
    if (!codexModelSupportsFastMode(this.config.model)) {
      this.serviceTier = null;
    }
    this.options.refreshResolvedCollaborationMode(this.planModeEnabled);
    this.invalidateRuntimeInfo();
  }

  setThinkingOption(thinkingOptionId: string | null): void {
    this.config.thinkingOptionId = normalizeCodexThinkingOptionId(thinkingOptionId);
    this.options.refreshResolvedCollaborationMode(this.planModeEnabled);
    this.invalidateRuntimeInfo();
  }

  setFeature(featureId: string, value: unknown): void {
    if (featureId === "fast_mode") {
      if (Boolean(value) && !codexModelSupportsFastMode(this.config.model)) {
        throw new Error(
          `Codex fast mode is not available for model '${this.config.model ?? "default"}'`,
        );
      }
      this.applyFeatureValue("fast_mode", Boolean(value));
      return;
    }
    if (featureId === "plan_mode") {
      this.applyFeatureValue("plan_mode", Boolean(value));
      return;
    }
    throw new Error(`Unknown Codex feature: ${featureId}`);
  }

  applyFeatureValue(featureId: "fast_mode" | "plan_mode", value: boolean): void {
    this.config.featureValues = {
      ...this.config.featureValues,
      [featureId]: value,
    };

    if (featureId === "fast_mode") {
      this.serviceTier = value ? "fast" : null;
      this.invalidateRuntimeInfo();
      return;
    }

    this.planModeEnabled = value;
    this.options.refreshResolvedCollaborationMode(this.planModeEnabled);
    this.invalidateRuntimeInfo();
  }

  describePersistence(): {
    provider: typeof CODEX_PROVIDER;
    sessionId: string;
    nativeHandle: string;
    metadata: Record<string, unknown>;
  } | null {
    const threadId = this.options.getThreadId();
    if (!threadId) return null;
    const thinkingOptionId = normalizeCodexThinkingOptionId(this.config.thinkingOptionId) ?? null;
    return {
      provider: CODEX_PROVIDER,
      sessionId: threadId,
      nativeHandle: threadId,
      metadata: {
        provider: CODEX_PROVIDER,
        cwd: this.config.cwd,
        title: this.config.title ?? null,
        threadId,
        modeId: this.currentMode,
        model: this.config.model ?? null,
        thinkingOptionId,
        extra: this.config.extra,
        systemPrompt: this.config.systemPrompt,
        mcpServers: this.config.mcpServers,
      },
    };
  }

  invalidateRuntimeInfo(): void {
    this.cachedRuntimeInfo = null;
  }
}
