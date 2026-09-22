import type { AgentProvider, AgentSessionConfig } from "@chisacode/protocol/agent-types";
import type { SyntheticModelConfig } from "@chisacode/protocol/provider-config";
import type {
  DaemonCommandResponsePayload,
  DaemonCommandTransport,
} from "./daemon-client-command-transport.js";

// Covers the server npm command, provider refresh, tooling metadata, and response delivery.
const PROVIDER_TOOLING_RPC_TIMEOUT_MS = 198_000;

type ListCommandsDraftConfig = Pick<
  AgentSessionConfig,
  "provider" | "cwd" | "modeId" | "model" | "thinkingOptionId" | "featureValues"
>;

/** Implements provider discovery, diagnostics, presets, and model-gateway RPC commands. */
export class ProviderCommandClient {
  constructor(private readonly transport: DaemonCommandTransport) {}

  listProviderModels(
    provider: AgentProvider,
    options?: { cwd?: string; requestId?: string },
  ): Promise<DaemonCommandResponsePayload<"list_provider_models_response">> {
    return this.transport.request({
      requestId: options?.requestId,
      message: { type: "list_provider_models_request", provider, cwd: options?.cwd },
      responseType: "list_provider_models_response",
      timeout: 45000,
    });
  }

  listProviderModes(
    provider: AgentProvider,
    options?: { cwd?: string; requestId?: string },
  ): Promise<DaemonCommandResponsePayload<"list_provider_modes_response">> {
    return this.transport.request({
      requestId: options?.requestId,
      message: { type: "list_provider_modes_request", provider, cwd: options?.cwd },
      responseType: "list_provider_modes_response",
      timeout: 45000,
    });
  }

  listProviderFeatures(
    draftConfig: ListCommandsDraftConfig,
    options?: { requestId?: string },
  ): Promise<DaemonCommandResponsePayload<"list_provider_features_response">> {
    return this.transport.request({
      requestId: options?.requestId,
      message: { type: "list_provider_features_request", draftConfig },
      responseType: "list_provider_features_response",
      timeout: 45000,
    });
  }

  listAvailableProviders(options?: {
    requestId?: string;
  }): Promise<DaemonCommandResponsePayload<"list_available_providers_response">> {
    return this.transport.request({
      requestId: options?.requestId,
      message: { type: "list_available_providers_request" },
      responseType: "list_available_providers_response",
      timeout: 30000,
    });
  }

  getProvidersSnapshot(options?: {
    cwd?: string;
    requestId?: string;
  }): Promise<DaemonCommandResponsePayload<"get_providers_snapshot_response">> {
    return this.transport.request({
      requestId: options?.requestId,
      message: { type: "get_providers_snapshot_request", cwd: options?.cwd },
      responseType: "get_providers_snapshot_response",
      timeout: 10000,
    });
  }

  refreshProvidersSnapshot(options?: {
    cwd?: string;
    providers?: AgentProvider[];
    requestId?: string;
  }): Promise<DaemonCommandResponsePayload<"refresh_providers_snapshot_response">> {
    return this.transport.request({
      requestId: options?.requestId,
      message: {
        type: "refresh_providers_snapshot_request",
        cwd: options?.cwd,
        providers: options?.providers,
      },
      responseType: "refresh_providers_snapshot_response",
      timeout: 60000,
    });
  }

  getProviderDiagnostic(
    provider: AgentProvider,
    options?: { requestId?: string },
  ): Promise<DaemonCommandResponsePayload<"provider_diagnostic_response">> {
    return this.transport.request({
      requestId: options?.requestId,
      message: { type: "provider_diagnostic_request", provider },
      responseType: "provider_diagnostic_response",
      timeout: 30000,
    });
  }

  getDiagnostics(options?: {
    includeLogs?: boolean;
    maxLogLines?: number;
    requestId?: string;
  }): Promise<DaemonCommandResponsePayload<"diagnostics.response">> {
    return this.transport.request({
      requestId: options?.requestId,
      message: {
        type: "diagnostics.request",
        includeLogs: options?.includeLogs,
        maxLogLines: options?.maxLogLines,
      },
      responseType: "diagnostics.response",
      timeout: 30000,
    });
  }

  runProviderToolingAction(
    provider: AgentProvider,
    action: "install" | "update" | "reinstall",
    options?: { requestId?: string },
  ): Promise<DaemonCommandResponsePayload<"provider.tooling.run.response">> {
    return this.transport.request({
      requestId: options?.requestId,
      message: { type: "provider.tooling.run.request", provider, action },
      responseType: "provider.tooling.run.response",
      timeout: PROVIDER_TOOLING_RPC_TIMEOUT_MS,
    });
  }

  listAgentPresets(options?: {
    requestId?: string;
  }): Promise<DaemonCommandResponsePayload<"agent.presets.list.response">> {
    return this.transport.request({
      requestId: options?.requestId,
      message: { type: "agent.presets.list.request" },
      responseType: "agent.presets.list.response",
      timeout: 30000,
    });
  }

  runModelGatewayMoaTest(input: {
    gatewayId: string;
    syntheticModel: SyntheticModelConfig;
    prompt: string;
    requestId?: string;
  }): Promise<DaemonCommandResponsePayload<"model_gateway.moa.test.response">> {
    return this.transport.request({
      requestId: input.requestId,
      message: {
        type: "model_gateway.moa.test.request",
        gatewayId: input.gatewayId,
        syntheticModel: input.syntheticModel,
        prompt: input.prompt,
      },
      responseType: "model_gateway.moa.test.response",
      timeout: 120000,
    });
  }

  runModelGatewayTest(input: {
    gatewayId: string;
    modelId: string;
    targetFormat?: "anthropic" | "chatCompletions" | "responses";
    requestId?: string;
  }): Promise<DaemonCommandResponsePayload<"model_gateway.test.response">> {
    return this.transport.request({
      requestId: input.requestId,
      message: {
        type: "model_gateway.test.request",
        gatewayId: input.gatewayId,
        modelId: input.modelId,
        ...(input.targetFormat ? { targetFormat: input.targetFormat } : {}),
      },
      responseType: "model_gateway.test.response",
      timeout: 30000,
    });
  }
}
