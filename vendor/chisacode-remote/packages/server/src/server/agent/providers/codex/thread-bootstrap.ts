import type { Logger } from "pino";

import type { AgentSessionConfig } from "../../agent-sdk-types.js";
import { composeSystemPromptParts } from "../../system-prompt.js";
import { readCodexConfiguredDefaults, type CodexConfiguredDefaults } from "./models.js";
import {
  buildRuntimeModelIdentityInstructions,
  type CodexCustomProvider,
  toCodexMcpConfig,
} from "./runtime-config.js";
import {
  applyApprovalsReviewerParam,
  DEFAULT_CODEX_MODE_ID,
  MODE_PRESETS,
  normalizeCodexThinkingOptionId,
  shouldPromoteThreadResponseToAutoReview,
} from "./turn-config.js";

interface CodexThreadClient {
  request(method: string, params?: unknown): Promise<unknown>;
}

interface CodexThreadBootstrapOptions {
  logger: Logger;
  getClient: () => CodexThreadClient | null;
  getConfig: () => AgentSessionConfig;
  getThreadId: () => string | null;
  setThreadId: (threadId: string) => void;
  getMode: () => string;
  setMode: (modeId: string) => void;
  invalidateRuntimeInfo: () => void;
  customProvider?: CodexCustomProvider;
  customCodexConfig?: Record<string, unknown> | null;
  ephemeral: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function toObjectRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

export class CodexThreadBootstrap {
  constructor(private readonly options: CodexThreadBootstrapOptions) {}

  async ensureThreadLoaded(): Promise<void> {
    const client = this.options.getClient();
    const threadId = this.options.getThreadId();
    if (!client || !threadId) return;
    try {
      const loaded = toObjectRecord(await client.request("thread/loaded/list", {}));
      const ids = Array.isArray(loaded?.data) ? loaded.data : [];
      if (ids.includes(threadId)) {
        return;
      }
      const config = this.options.getConfig();
      const params: Record<string, unknown> = { threadId };
      const developerInstructions = composeSystemPromptParts(
        config.systemPrompt,
        config.daemonAppendSystemPrompt,
        buildRuntimeModelIdentityInstructions(config, this.options.customProvider),
      );
      if (developerInstructions) {
        params.developerInstructions = developerInstructions;
      }
      const codexConfig = this.buildInnerConfig();
      if (codexConfig) {
        params.config = codexConfig;
      }
      await client.request("thread/resume", params);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.options.logger.warn({ error, threadId }, "Failed to resume persisted Codex thread");
      throw new Error("Failed to resume Codex thread " + threadId + ": " + message, {
        cause: error,
      });
    }
  }

  async ensureThread(): Promise<void> {
    const client = this.options.getClient();
    if (!client || this.options.getThreadId()) return;

    const config = this.options.getConfig();
    const { model, thinkingOptionId } = await this.resolveModelAndThinking(client, config);
    config.model = model;
    config.thinkingOptionId = thinkingOptionId;

    const preset = MODE_PRESETS[this.options.getMode()] ?? MODE_PRESETS[DEFAULT_CODEX_MODE_ID];
    const approvalPolicy = config.approvalPolicy ?? preset.approvalPolicy;
    const sandbox = config.sandboxMode ?? preset.sandbox;
    const innerConfig = this.buildInnerConfig();
    const developerInstructions = composeSystemPromptParts(
      config.systemPrompt,
      config.daemonAppendSystemPrompt,
      buildRuntimeModelIdentityInstructions(config, this.options.customProvider),
    );
    const params: Record<string, unknown> = {
      model,
      cwd: config.cwd ?? null,
      approvalPolicy,
      sandbox,
      ...(developerInstructions ? { developerInstructions } : {}),
      ...(innerConfig ? { config: innerConfig } : {}),
      ...(this.options.ephemeral ? { ephemeral: true } : {}),
    };
    applyApprovalsReviewerParam(params, preset);
    const response = toObjectRecord(await client.request("thread/start", params));
    const threadRecord = toObjectRecord(response?.thread);
    const threadId = typeof threadRecord?.id === "string" ? threadRecord.id : undefined;
    if (!threadId) {
      throw new Error("Codex app-server did not return thread id");
    }
    const responseApprovalsReviewer =
      typeof response?.approvalsReviewer === "string" ? response.approvalsReviewer : undefined;
    if (
      shouldPromoteThreadResponseToAutoReview({
        approvalsReviewer: responseApprovalsReviewer,
        approvalPolicy,
        sandbox,
      })
    ) {
      this.options.setMode("auto-review");
      this.options.invalidateRuntimeInfo();
    }
    this.options.setThreadId(threadId);
  }

  buildInnerConfig(): Record<string, unknown> | null {
    const config = this.options.getConfig();
    const innerConfig: Record<string, unknown> = {};
    if (config.mcpServers) {
      innerConfig.mcp_servers = Object.fromEntries(
        Object.entries(config.mcpServers).map(([name, serverConfig]) => [
          name,
          toCodexMcpConfig(serverConfig),
        ]),
      );
    }
    if (config.extra?.codex) {
      Object.assign(innerConfig, config.extra.codex);
    }
    if (this.options.customCodexConfig) {
      Object.assign(innerConfig, this.options.customCodexConfig);
    }
    return Object.keys(innerConfig).length > 0 ? innerConfig : null;
  }

  private async resolveModelAndThinking(
    client: CodexThreadClient,
    config: AgentSessionConfig,
  ): Promise<{ model: string; thinkingOptionId: string | undefined }> {
    let configuredDefaults: CodexConfiguredDefaults = {};
    let model = config.model;
    let thinkingOptionId = normalizeCodexThinkingOptionId(config.thinkingOptionId);
    if (!model || !thinkingOptionId) {
      configuredDefaults = await readCodexConfiguredDefaults(client, this.options.logger);
    }
    if (!model) {
      model = configuredDefaults.model;
    }
    if (!thinkingOptionId) {
      thinkingOptionId = configuredDefaults.thinkingOptionId;
    }

    if (!model || !thinkingOptionId) {
      const modelResponse = toObjectRecord(await client.request("model/list", {}));
      const modelData = Array.isArray(modelResponse?.data) ? modelResponse.data : [];
      const models = modelData
        .map((entry) => {
          const record = toObjectRecord(entry);
          return {
            id: typeof record?.id === "string" ? record.id : "",
            isDefault: Boolean(record?.isDefault),
            defaultReasoningEffort:
              typeof record?.defaultReasoningEffort === "string"
                ? record.defaultReasoningEffort
                : undefined,
          };
        })
        .filter((entry) => entry.id);
      const defaultModel = models.find((entry) => entry.isDefault) ?? models[0];
      if (!defaultModel) {
        throw new Error("No models available from Codex app-server");
      }
      const selectedModel =
        (model ? models.find((entry) => entry.id === model) : undefined) ?? defaultModel;
      model ??= selectedModel.id;
      thinkingOptionId ??= normalizeCodexThinkingOptionId(selectedModel.defaultReasoningEffort);
    }

    if (!model) {
      throw new Error("Unable to resolve Codex model");
    }
    return { model, thinkingOptionId };
  }
}
