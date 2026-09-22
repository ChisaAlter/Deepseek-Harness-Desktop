/**
 * ProviderHandler — extracted from Session.
 *
 * Handles provider list/snapshot/diagnostic/tooling RPC requests.
 */

import { CLIENT_CAPS } from "@chisacode/protocol/client-capabilities";

import { getErrorMessage } from "@chisacode/protocol/error-utils";
import { runSyntheticModelTest, runModelGatewayTest } from "../model-gateway/model-gateway.js";
import { createDaemonDiagnosticReport } from "../diagnostics-report.js";
import type { SessionInboundMessage } from "../messages.js";
import type {
  AgentProvider,
  AgentSessionConfig,
  ProviderSnapshotEntry,
} from "../agent/agent-sdk-types.js";
import { resolveSnapshotCwd as resolveManagerSnapshotCwd } from "../agent/provider-snapshot-manager.js";
import type { ProviderHandlerContext, DisposableHandler } from "./session-context.js";

const LEGACY_MODE_ICONS = new Set<string>([
  "ShieldCheck",
  "ShieldAlert",
  "ShieldOff",
  "ShieldQuestionMark",
]);

function resolveSnapshotCwd(cwd: string | undefined): string {
  return resolveManagerSnapshotCwd(cwd);
}

/** Handles provider list/snapshot/diagnostic, mode/feature/command discovery, presets, and model gateway test RPC operations. */
export class ProviderHandler implements DisposableHandler {
  private readonly context: ProviderHandlerContext;
  private unsubscribeProviderSnapshotEvents: (() => void) | null = null;

  constructor(context: ProviderHandlerContext) {
    this.context = context;
  }

  start(): void {
    if (this.unsubscribeProviderSnapshotEvents) {
      return;
    }

    const handleProviderSnapshotChange = (entries: ProviderSnapshotEntry[], cwd: string) => {
      try {
        // COMPAT(providersSnapshot): keep provider visibility gating for older clients.
        const visibleEntries = entries.filter((entry) =>
          this.isProviderVisibleToClient(entry.provider),
        );
        const snapshotCwd = cwd === resolveSnapshotCwd(undefined) ? undefined : cwd;
        this.context.emit({
          type: "providers_snapshot_update",
          payload: {
            ...(snapshotCwd ? { cwd: snapshotCwd } : {}),
            entries: this.downgradeEntryModesForClient(visibleEntries),
            generatedAt: new Date().toISOString(),
          },
        });
      } catch (error) {
        this.context.sessionLogger.warn(
          { err: error, cwd },
          "Failed to publish provider snapshot update",
        );
      }
    };

    this.context.providerSnapshotManager.on("change", handleProviderSnapshotChange);
    this.unsubscribeProviderSnapshotEvents = () => {
      this.context.providerSnapshotManager.off("change", handleProviderSnapshotChange);
    };
  }

  dispose(): void {
    const unsubscribe = this.unsubscribeProviderSnapshotEvents;
    this.unsubscribeProviderSnapshotEvents = null;
    unsubscribe?.();
  }

  // --- Provider visibility & client downgrade helpers ---

  private isProviderVisibleToClient(provider: string): boolean {
    return this.context.isProviderVisibleToClient(provider);
  }

  private downgradeModeIconsForClient<T extends { icon?: string }>(modes: T[]): T[] {
    if (this.context.supports(CLIENT_CAPS.customModeIcons)) return modes;
    return modes.map((mode) =>
      mode.icon && !LEGACY_MODE_ICONS.has(mode.icon) ? { ...mode, icon: "ShieldCheck" } : mode,
    );
  }

  private downgradeEntryModesForClient<T extends { modes?: { icon?: string }[] }>(
    entries: T[],
  ): T[] {
    if (this.context.supports(CLIENT_CAPS.customModeIcons)) return entries;
    return entries.map((entry) =>
      entry.modes ? { ...entry, modes: this.downgradeModeIconsForClient(entry.modes) } : entry,
    );
  }

  // --- Provider snapshot helpers ---

  private async getProviderSnapshotEntryForRead(
    cwd: string,
    provider: AgentProvider,
  ): Promise<ProviderSnapshotEntry | undefined> {
    const manager = this.context.providerSnapshotManager;
    const findEntry = () =>
      manager.getSnapshot(cwd).find((candidate) => candidate.provider === provider);
    let entry = findEntry();
    if (entry && !entry.enabled) {
      return entry;
    }
    if (!entry || entry.status === "loading") {
      await manager.warmUpSnapshotForCwd({ cwd, providers: [provider] });
      entry = findEntry();
    }
    return entry;
  }

  private emitProviderDisabledResponse(
    kind: "models" | "modes",
    provider: AgentProvider,
    requestId: string,
    fetchedAt: string,
  ): void {
    const payload = {
      provider,
      error: `Provider ${provider} is disabled`,
      fetchedAt,
      requestId,
    };
    if (kind === "models") {
      this.context.emit({ type: "list_provider_models_response", payload });
    } else {
      this.context.emit({ type: "list_provider_modes_response", payload });
    }
  }

  private buildDraftAgentSessionConfig(draftConfig: {
    provider: AgentProvider;
    cwd: string;
    modeId?: string;
    model?: string;
    thinkingOptionId?: string;
    featureValues?: Record<string, unknown>;
  }): AgentSessionConfig {
    return {
      provider: draftConfig.provider,
      cwd: resolveSnapshotCwd(draftConfig.cwd),
      ...(draftConfig.modeId ? { modeId: draftConfig.modeId } : {}),
      ...(draftConfig.model ? { model: draftConfig.model } : {}),
      ...(draftConfig.thinkingOptionId ? { thinkingOptionId: draftConfig.thinkingOptionId } : {}),
      ...(draftConfig.featureValues ? { featureValues: draftConfig.featureValues } : {}),
    };
  }

  // --- Provider handlers ---

  /** Handle listing models available for a provider. */
  async handleListProviderModelsRequest(
    msg: Extract<SessionInboundMessage, { type: "list_provider_models_request" }>,
  ): Promise<void> {
    const cwd = resolveSnapshotCwd(msg.cwd);
    const fetchedAt = new Date().toISOString();
    const entry = await this.getProviderSnapshotEntryForRead(cwd, msg.provider);
    if (!entry) {
      this.context.emit({
        type: "list_provider_models_response",
        payload: {
          provider: msg.provider,
          error: `Unknown provider: ${msg.provider}`,
          fetchedAt,
          requestId: msg.requestId,
        },
      });
      return;
    }
    if (!entry.enabled) {
      this.emitProviderDisabledResponse("models", msg.provider, msg.requestId, fetchedAt);
      return;
    }
    if (entry.status === "ready") {
      this.context.emit({
        type: "list_provider_models_response",
        payload: {
          provider: msg.provider,
          models: entry.models ?? [],
          error: null,
          fetchedAt: entry.fetchedAt ?? fetchedAt,
          requestId: msg.requestId,
        },
      });
      return;
    }
    const errorMessage =
      entry.status === "error"
        ? (entry.error ?? `Failed to list models for ${msg.provider}`)
        : `Provider ${msg.provider} is not available`;
    this.context.emit({
      type: "list_provider_models_response",
      payload: { provider: msg.provider, error: errorMessage, fetchedAt, requestId: msg.requestId },
    });
  }

  /** Handle listing modes available for a provider. */
  async handleListProviderModesRequest(
    msg: Extract<SessionInboundMessage, { type: "list_provider_modes_request" }>,
  ): Promise<void> {
    const fetchedAt = new Date().toISOString();
    const cwd = resolveSnapshotCwd(msg.cwd);
    const entry = await this.getProviderSnapshotEntryForRead(cwd, msg.provider);
    if (!entry) {
      this.context.emit({
        type: "list_provider_modes_response",
        payload: {
          provider: msg.provider,
          error: `Unknown provider: ${msg.provider}`,
          fetchedAt,
          requestId: msg.requestId,
        },
      });
      return;
    }
    if (!entry.enabled) {
      this.emitProviderDisabledResponse("modes", msg.provider, msg.requestId, fetchedAt);
      return;
    }
    if (entry.status === "ready") {
      this.context.emit({
        type: "list_provider_modes_response",
        payload: {
          provider: msg.provider,
          modes: this.downgradeModeIconsForClient(entry.modes ?? []),
          error: null,
          fetchedAt: entry.fetchedAt ?? fetchedAt,
          requestId: msg.requestId,
        },
      });
      return;
    }
    const errorMessage =
      entry.status === "error"
        ? (entry.error ?? `Failed to list modes for ${msg.provider}`)
        : `Provider ${msg.provider} is not available`;
    this.context.emit({
      type: "list_provider_modes_response",
      payload: { provider: msg.provider, error: errorMessage, fetchedAt, requestId: msg.requestId },
    });
  }

  /** Handle listing features available for a provider with a draft config. */
  async handleListProviderFeaturesRequest(
    msg: Extract<SessionInboundMessage, { type: "list_provider_features_request" }>,
  ): Promise<void> {
    const fetchedAt = new Date().toISOString();
    try {
      const sessionConfig = this.buildDraftAgentSessionConfig(msg.draftConfig);
      const features = await this.context.agentManager.listDraftFeatures(sessionConfig);
      this.context.emit({
        type: "list_provider_features_response",
        payload: {
          provider: msg.draftConfig.provider,
          features,
          error: null,
          fetchedAt,
          requestId: msg.requestId,
        },
      });
    } catch (error) {
      this.context.sessionLogger.error(
        { err: error, provider: msg.draftConfig.provider, draftConfig: msg.draftConfig },
        `Failed to list features for ${msg.draftConfig.provider}`,
      );
      this.context.emit({
        type: "list_provider_features_response",
        payload: {
          provider: msg.draftConfig.provider,
          error: getErrorMessage(error),
          fetchedAt,
          requestId: msg.requestId,
        },
      });
    }
  }

  /** Handle listing all available providers with their availability status. */
  async handleListAvailableProvidersRequest(
    msg: Extract<SessionInboundMessage, { type: "list_available_providers_request" }>,
  ): Promise<void> {
    const fetchedAt = new Date().toISOString();
    try {
      const providers = (await this.context.agentManager.listProviderAvailability()).filter(
        (provider) => this.isProviderVisibleToClient(provider.provider),
      );
      this.context.emit({
        type: "list_available_providers_response",
        payload: { providers, error: null, fetchedAt, requestId: msg.requestId },
      });
    } catch (error) {
      this.context.sessionLogger.error({ err: error }, "Failed to list provider availability");
      this.context.emit({
        type: "list_available_providers_response",
        payload: {
          providers: [],
          error: getErrorMessage(error),
          fetchedAt,
          requestId: msg.requestId,
        },
      });
    }
  }

  /** Handle getting the current providers snapshot (models, modes, status per provider). */
  async handleGetProvidersSnapshotRequest(
    msg: Extract<SessionInboundMessage, { type: "get_providers_snapshot_request" }>,
  ): Promise<void> {
    const requestedCwd = msg.cwd?.trim() ? resolveSnapshotCwd(msg.cwd) : undefined;
    const entries = this.context.providerSnapshotManager
      .getSnapshot(requestedCwd)
      .filter((entry) => this.isProviderVisibleToClient(entry.provider));
    this.context.emit({
      type: "get_providers_snapshot_response",
      payload: {
        cwd: requestedCwd,
        entries: this.downgradeEntryModesForClient(entries),
        generatedAt: new Date().toISOString(),
        requestId: msg.requestId,
      },
    });
  }

  /** Handle refreshing the providers snapshot for a cwd or global settings. */
  async handleRefreshProvidersSnapshotRequest(
    msg: Extract<SessionInboundMessage, { type: "refresh_providers_snapshot_request" }>,
  ): Promise<void> {
    if (msg.cwd) {
      await this.context.providerSnapshotManager.refreshSnapshotForCwd({
        cwd: resolveSnapshotCwd(msg.cwd),
        providers: msg.providers,
      });
    } else {
      await this.context.providerSnapshotManager.refreshSettingsSnapshot({
        providers: msg.providers,
      });
    }
    this.context.emit({
      type: "refresh_providers_snapshot_response",
      payload: { acknowledged: true, requestId: msg.requestId },
    });
  }

  /** Handle provider diagnostic request — detailed health check for a specific provider. */
  async handleProviderDiagnosticRequest(
    msg: Extract<SessionInboundMessage, { type: "provider_diagnostic_request" }>,
  ): Promise<void> {
    try {
      const { diagnostic, details } =
        await this.context.providerSnapshotManager.getProviderDiagnostic(msg.provider);
      this.context.emit({
        type: "provider_diagnostic_response",
        payload: { provider: msg.provider, diagnostic, details, requestId: msg.requestId },
      });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.context.sessionLogger.error(
        { err, provider: msg.provider },
        `Failed to get provider diagnostic for ${msg.provider}`,
      );
      this.context.emit({
        type: "rpc_error",
        payload: {
          requestId: msg.requestId,
          requestType: msg.type,
          error: `Failed to get provider diagnostic: ${err.message}`,
          code: "provider_diagnostic_failed",
        },
      });
    }
  }

  /** Handle generation of a bounded daemon-wide troubleshooting report. */
  async handleDiagnosticsRequest(
    msg: Extract<SessionInboundMessage, { type: "diagnostics.request" }>,
  ): Promise<void> {
    try {
      const diagnostic = await createDaemonDiagnosticReport(
        {
          chisacodeHome: this.context.chisacodeHome,
          daemonVersion: this.context.daemonVersion,
          daemonRuntimeConfig: this.context.daemonRuntimeConfig,
          daemonConfigStore: this.context.daemonConfigStore,
          agentManager: this.context.agentManager,
          providerSnapshotManager: this.context.providerSnapshotManager,
        },
        {
          includeLogs: msg.includeLogs,
          maxLogLines: msg.maxLogLines,
        },
      );
      this.context.emit({
        type: "diagnostics.response",
        payload: { requestId: msg.requestId, diagnostic },
      });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.context.sessionLogger.error({ err }, "Failed to generate daemon diagnostics");
      this.context.emit({
        type: "rpc_error",
        payload: {
          requestId: msg.requestId,
          requestType: msg.type,
          error: `Failed to generate diagnostics: ${err.message}`,
          code: "diagnostics_failed",
        },
      });
    }
  }

  /** Handle provider tooling action request — run provider-specific tooling like setup or auth. */
  async handleProviderToolingActionRequest(
    msg: Extract<SessionInboundMessage, { type: "provider.tooling.run.request" }>,
  ): Promise<void> {
    try {
      const result = await this.context.providerSnapshotManager.runProviderToolingAction(
        msg.provider,
        msg.action,
      );
      this.context.emit({
        type: "provider.tooling.run.response",
        payload: { ...result, requestId: msg.requestId },
      });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.context.sessionLogger.error(
        { err, provider: msg.provider, action: msg.action },
        `Failed to run provider tooling action for ${msg.provider}`,
      );
      this.context.emit({
        type: "rpc_error",
        payload: {
          requestId: msg.requestId,
          requestType: msg.type,
          error: `Failed to ${msg.action} provider: ${err.message}`,
          code: "provider_tooling_action_failed",
        },
      });
    }
  }

  /** Handle listing agent presets. */
  async handleAgentPresetsListRequest(
    msg: Extract<SessionInboundMessage, { type: "agent.presets.list.request" }>,
  ): Promise<void> {
    try {
      const presets = await this.context.agentPresetStore.list();
      this.context.emit({
        type: "agent.presets.list.response",
        payload: { presets, requestId: msg.requestId },
      });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.context.sessionLogger.error({ err }, "Failed to list agent presets");
      this.context.emit({
        type: "rpc_error",
        payload: {
          requestId: msg.requestId,
          requestType: msg.type,
          error: `Failed to list agent presets: ${err.message}`,
          code: "agent_presets_list_failed",
        },
      });
    }
  }

  /** Handle model gateway connectivity and latency test request. */
  async handleModelGatewayTestRequest(
    msg: Extract<SessionInboundMessage, { type: "model_gateway.test.request" }>,
  ): Promise<void> {
    const gateway = this.context.daemonConfigStore.get().modelGateways[msg.gatewayId];
    if (!gateway || gateway.enabled === false) {
      this.context.emit({
        type: "model_gateway.test.response",
        payload: {
          requestId: msg.requestId,
          gatewayId: msg.gatewayId,
          modelId: msg.modelId,
          result: null,
          error: "Unknown model gateway",
        },
      });
      return;
    }
    try {
      const result = await runModelGatewayTest({
        gateway,
        modelId: msg.modelId,
        targetFormat: msg.targetFormat,
      });
      this.context.emit({
        type: "model_gateway.test.response",
        payload: {
          requestId: msg.requestId,
          gatewayId: msg.gatewayId,
          modelId: msg.modelId,
          result,
          error: null,
        },
      });
    } catch (error) {
      this.context.emit({
        type: "model_gateway.test.response",
        payload: {
          requestId: msg.requestId,
          gatewayId: msg.gatewayId,
          modelId: msg.modelId,
          result: null,
          error: getErrorMessage(error),
        },
      });
    }
  }

  /** Handle model gateway MoA test request — run a synthetic model test against a gateway. */
  async handleModelGatewayMoaTestRequest(
    msg: Extract<SessionInboundMessage, { type: "model_gateway.moa.test.request" }>,
  ): Promise<void> {
    const gateway = this.context.daemonConfigStore.get().modelGateways[msg.gatewayId];
    if (!gateway || gateway.enabled === false) {
      this.context.emit({
        type: "model_gateway.moa.test.response",
        payload: {
          requestId: msg.requestId,
          gatewayId: msg.gatewayId,
          result: null,
          error: "Unknown model gateway",
        },
      });
      return;
    }
    try {
      const result = await runSyntheticModelTest({
        gateway,
        syntheticModel: msg.syntheticModel,
        prompt: msg.prompt,
      });
      this.context.emit({
        type: "model_gateway.moa.test.response",
        payload: { requestId: msg.requestId, gatewayId: msg.gatewayId, result, error: null },
      });
    } catch (error) {
      this.context.emit({
        type: "model_gateway.moa.test.response",
        payload: {
          requestId: msg.requestId,
          gatewayId: msg.gatewayId,
          result: null,
          error: getErrorMessage(error),
        },
      });
    }
  }
}
