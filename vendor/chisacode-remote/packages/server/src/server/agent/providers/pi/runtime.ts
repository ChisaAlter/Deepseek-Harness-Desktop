import type {
  PiAgentMessage,
  PiModel,
  PiRpcSlashCommand,
  PiRuntimeEvent,
  PiSessionState,
  PiSessionStats,
} from "./rpc-types.js";
import type { ProviderRuntimeSettings } from "../../provider-launch-config.js";
import { preparePiGatewayEnv } from "./gateway-env.js";

export interface PiRuntimeLaunch {
  cwd: string;
  argv: string[];
  env?: Record<string, string>;
  model?: string;
  thinkingOptionId?: string;
  session?: string;
  systemPrompt?: string;
  mcpConfigPath?: string;
  extensionPaths?: string[];
}

export interface PiStartSessionInput {
  cwd: string;
  env?: Record<string, string>;
  model?: string;
  thinkingOptionId?: string;
  session?: string;
  systemPrompt?: string;
  mcpConfigPath?: string;
  extensionPaths?: string[];
}

export type PiPromptStreamingBehavior = "steer" | "followUp";

export interface PiPromptOptions {
  images?: Array<{ type: "image"; data: string; mimeType: string }>;
  /**
   * Queueing policy when Pi is already streaming.
   * Idle prompts ignore this field; during streaming Pi requires it.
   */
  streamingBehavior?: PiPromptStreamingBehavior;
}

export interface PiRuntimeSession {
  onEvent(callback: (event: PiRuntimeEvent) => void): () => void;
  prompt(message: string, options?: PiPromptOptions): Promise<void>;
  abort(): Promise<void>;
  getState(): Promise<PiSessionState>;
  getMessages(): Promise<PiAgentMessage[]>;
  getAvailableModels(): Promise<PiModel[]>;
  setModel(provider: string, modelId: string): Promise<PiModel>;
  setThinkingLevel(level: string): Promise<void>;
  getSessionStats(): Promise<PiSessionStats>;
  getCommands(): Promise<PiRpcSlashCommand[]>;
  respondToExtensionUiRequest(
    id: string,
    response: { value?: string; confirmed?: boolean; cancelled?: boolean },
  ): void;
  cancelExtensionUiRequest(id: string): void;
  close(): Promise<void>;
}

export interface PiRuntime {
  startSession(input: PiStartSessionInput): Promise<PiRuntimeSession>;
}

export function buildPiLaunch(input: {
  command: [string, ...string[]];
  runtimeSettings?: ProviderRuntimeSettings;
  session: PiStartSessionInput;
}): PiRuntimeLaunch {
  const command =
    input.runtimeSettings?.command?.mode === "replace" && input.runtimeSettings.command.argv[0]
      ? input.runtimeSettings.command.argv
      : input.command;
  const argv = [...command];

  if (!hasModeRpc(argv)) {
    argv.push("--mode", "rpc");
  }
  if (input.session.model) {
    argv.push("--model", input.session.model);
  }
  if (input.session.thinkingOptionId) {
    argv.push("--thinking", input.session.thinkingOptionId);
  }
  if (input.session.session) {
    argv.push("--session", input.session.session);
  }
  if (input.session.mcpConfigPath) {
    argv.push("--mcp-config", input.session.mcpConfigPath);
  }
  // Put --extension before --append-system-prompt. On Windows, spawning bare
  // `pi` uses shell:true; a multiline prompt value ends the cmd line early and
  // silently drops any trailing flags (including --extension).
  for (const extensionPath of input.session.extensionPaths ?? []) {
    argv.push("--extension", extensionPath);
  }
  const systemPrompt = input.session.systemPrompt?.trim();
  if (systemPrompt) {
    // Prefer a file path (written by session-lifecycle). Pi loads the path when
    // it exists; keep inline text only for short single-line prompts.
    argv.push("--append-system-prompt", systemPrompt);
  }

  // Gateway faces put OPENAI_API_KEY / OPENAI_BASE_URL on runtimeSettings.env;
  // launchContext may only carry CHISACODE_AGENT_ID. Merge first, then isolate
  // Pi's models.json so personal ~/.pi baseUrls cannot override the gateway.
  const mergedEnv =
    input.runtimeSettings?.env || input.session.env
      ? {
          ...input.runtimeSettings?.env,
          ...input.session.env,
        }
      : undefined;

  return {
    cwd: input.session.cwd,
    argv,
    env: preparePiGatewayEnv(mergedEnv),
    model: input.session.model,
    thinkingOptionId: input.session.thinkingOptionId,
    session: input.session.session,
    systemPrompt,
    mcpConfigPath: input.session.mcpConfigPath,
    extensionPaths: input.session.extensionPaths,
  };
}

function hasModeRpc(argv: string[]): boolean {
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--mode" && argv[i + 1] === "rpc") {
      return true;
    }
    if (argv[i] === "--mode=rpc") {
      return true;
    }
  }
  return false;
}
