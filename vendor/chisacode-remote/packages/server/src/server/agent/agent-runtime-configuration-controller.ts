import type { AgentProvider, AgentSessionConfig } from "./agent-sdk-types.js";
import type { ManagedAgent } from "./agent-manager.js";
import { AgentProviderController } from "./agent-provider-controller.js";

type ConfigurableAgent = Exclude<ManagedAgent, { lifecycle: "closed" }>;

interface AgentRuntimeConfigurationControllerOptions {
  emitState(agent: ManagedAgent): void;
  providers: AgentProviderController;
  reloadAgentSession(agentId: string, overrides: Partial<AgentSessionConfig>): Promise<void>;
  touchUpdatedAt(agent: ManagedAgent): Date;
}

/** Owns live agent mode, model, thinking, and feature configuration changes. */
export class AgentRuntimeConfigurationController {
  constructor(private readonly options: AgentRuntimeConfigurationControllerOptions) {}

  async setMode(agent: ConfigurableAgent, modeId: string): Promise<void> {
    await agent.session.setMode(modeId);
    const currentMode = (await agent.session.getCurrentMode()) ?? modeId;
    agent.config.modeId = currentMode ?? undefined;
    agent.currentModeId = currentMode;
    if (agent.runtimeInfo) {
      agent.runtimeInfo = { ...agent.runtimeInfo, modeId: currentMode };
    }
    this.commitState(agent);
  }

  async setModel(
    agent: ConfigurableAgent,
    modelId: string | null,
    options?: { runtimeProvider?: AgentProvider | string | null },
  ): Promise<void> {
    const normalizedModelId = preserveNonBlankId(modelId);
    const currentRuntimeProvider =
      agent.runtimeInfo?.provider ?? agent.config.runtimeProvider ?? agent.provider;
    const requestedRuntimeProvider =
      normalizeRuntimeProvider(options?.runtimeProvider) ?? currentRuntimeProvider;

    if (requestedRuntimeProvider !== currentRuntimeProvider) {
      this.options.providers.requireEnabledProvider(requestedRuntimeProvider);
      if (normalizedModelId) {
        await this.requireAvailableModel(normalizedModelId, requestedRuntimeProvider, agent.cwd);
      }
      await this.options.reloadAgentSession(agent.id, {
        model: normalizedModelId ?? undefined,
        runtimeProvider: requestedRuntimeProvider,
      });
      return;
    }

    if (normalizedModelId) {
      await this.requireAvailableModel(normalizedModelId, currentRuntimeProvider, agent.cwd);
    }

    if (agent.session.setModel) {
      await agent.session.setModel(normalizedModelId);
    }

    agent.config.model = normalizedModelId ?? undefined;
    if (agent.runtimeInfo) {
      agent.runtimeInfo = { ...agent.runtimeInfo, model: normalizedModelId };
    }
    this.commitState(agent);
  }

  async setThinkingOption(
    agent: ConfigurableAgent,
    thinkingOptionId: string | null,
  ): Promise<void> {
    const normalizedThinkingOptionId = preserveNonBlankId(thinkingOptionId);

    if (agent.session.setThinkingOption) {
      await agent.session.setThinkingOption(normalizedThinkingOptionId);
    }

    agent.config.thinkingOptionId = normalizedThinkingOptionId ?? undefined;
    if (agent.runtimeInfo) {
      agent.runtimeInfo = {
        ...agent.runtimeInfo,
        thinkingOptionId: normalizedThinkingOptionId,
      };
    }
    this.commitState(agent);
  }

  async setFeature(agent: ConfigurableAgent, featureId: string, value: unknown): Promise<void> {
    if (!agent.session.setFeature) {
      throw new Error("Agent session does not support setting features");
    }

    await agent.session.setFeature(featureId, value);
    agent.config.featureValues = { ...agent.config.featureValues, [featureId]: value };
    this.commitState(agent);
  }

  private async requireAvailableModel(
    modelId: string,
    runtimeProvider: AgentProvider,
    cwd: string,
  ): Promise<void> {
    const client = this.options.providers.requireClient(runtimeProvider);
    const availableModels = await client.listModels({ cwd, force: false });
    if (!availableModels.some((model) => model.id === modelId)) {
      throw new Error(
        `Model '${modelId}' is not available for runtime provider '${runtimeProvider}'`,
      );
    }
  }

  private commitState(agent: ConfigurableAgent): void {
    this.options.touchUpdatedAt(agent);
    this.options.emitState(agent);
  }
}

function preserveNonBlankId(value: string | null | undefined): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function normalizeRuntimeProvider(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}
