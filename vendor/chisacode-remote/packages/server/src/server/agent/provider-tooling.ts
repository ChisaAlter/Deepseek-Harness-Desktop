import { execCommand } from "../../utils/spawn.js";
import type { AgentProvider } from "./agent-sdk-types.js";
import { createProviderEnvSpec } from "./provider-launch-config.js";

export type ProviderVersionStatus = "unknown" | "not-installed" | "current" | "outdated";
export type ProviderToolingAction = "install" | "update" | "reinstall";

export interface ProviderToolingInfo {
  installedVersion: string | null;
  latestVersion: string | null;
  versionStatus: ProviderVersionStatus;
  packageName: string;
  checkedAt: string;
  installAvailable: boolean;
  updateAvailable: boolean;
}

export interface ProviderToolingActionResult {
  provider: AgentProvider;
  action: ProviderToolingAction;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  success: boolean;
}

export interface ProviderToolingDefinition {
  binary: string;
  packageName: string;
  installArgs: string[];
}

const OUTPUT_CAP = 16_000;
const TOOLING_TIMEOUT_MS = 120_000;
const VERSION_TIMEOUT_MS = 8_000;

const PROVIDER_TOOLING: Record<string, ProviderToolingDefinition> = {
  claude: {
    binary: "claude",
    packageName: "@anthropic-ai/claude-code",
    installArgs: ["install", "-g", "@anthropic-ai/claude-code@latest"],
  },
  codex: {
    binary: "codex",
    packageName: "@openai/codex",
    installArgs: ["install", "-g", "@openai/codex@latest"],
  },
  opencode: {
    binary: "opencode",
    packageName: "opencode-ai",
    installArgs: ["install", "-g", "opencode-ai@latest"],
  },
  pi: {
    binary: "pi",
    packageName: "@earendil-works/pi-coding-agent",
    installArgs: ["install", "-g", "--ignore-scripts", "@earendil-works/pi-coding-agent@latest"],
  },
  kimi: {
    binary: "kimi",
    packageName: "@moonshot-ai/kimi-code",
    installArgs: ["install", "-g", "@moonshot-ai/kimi-code@latest"],
  },
  grokbuild: {
    binary: "grok",
    packageName: "@xai-official/grok",
    installArgs: ["install", "-g", "@xai-official/grok@latest"],
  },
  dsh: {
    // Version probing uses `dsh --version`; the ACP transport binary
    // (`dsh-acp-demo`) ships no version flag. Both packages must be installed
    // together, pinned to the rc channel while upstream ships prereleases.
    binary: "dsh",
    packageName: "@deepseek-ai/dsh",
    installArgs: ["install", "-g", "@deepseek-ai/dsh@next", "@deepseek-ai/dsh-acp-demo@next"],
  },
};

export function isProviderToolingSupported(provider: AgentProvider): boolean {
  return Object.prototype.hasOwnProperty.call(PROVIDER_TOOLING, provider);
}

export function getProviderToolingDefinition(
  provider: AgentProvider,
): ProviderToolingDefinition | null {
  return PROVIDER_TOOLING[provider] ?? null;
}

export async function getProviderToolingInfo(
  provider: AgentProvider,
): Promise<ProviderToolingInfo | null> {
  const definition = PROVIDER_TOOLING[provider];
  if (!definition) {
    return null;
  }

  const [installedVersion, latestVersion] = await Promise.all([
    resolveInstalledVersion(definition.binary),
    resolveLatestVersion(definition.packageName),
  ]);
  const versionStatus = getVersionStatus(installedVersion, latestVersion);
  return {
    installedVersion,
    latestVersion,
    versionStatus,
    packageName: definition.packageName,
    checkedAt: new Date().toISOString(),
    installAvailable: installedVersion === null,
    updateAvailable: installedVersion !== null && versionStatus === "outdated",
  };
}

export async function runProviderToolingAction(
  provider: AgentProvider,
  action: ProviderToolingAction,
): Promise<ProviderToolingActionResult> {
  const definition = PROVIDER_TOOLING[provider];
  if (!definition) {
    throw new Error(`Provider '${provider}' does not support tooling actions`);
  }

  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  try {
    const result = await execCommand(npmCommand, definition.installArgs, {
      ...createProviderEnvSpec(),
      timeout: TOOLING_TIMEOUT_MS,
      maxBuffer: OUTPUT_CAP * 2,
      shell: false,
    });
    return {
      provider,
      action,
      exitCode: 0,
      stdout: truncateOutput(result.stdout),
      stderr: truncateOutput(result.stderr),
      success: true,
    };
  } catch (error) {
    const err = error as Error & { code?: unknown; stdout?: string; stderr?: string };
    return {
      provider,
      action,
      exitCode: typeof err.code === "number" ? err.code : null,
      stdout: truncateOutput(err.stdout ?? ""),
      stderr: truncateOutput(err.stderr ?? err.message),
      success: false,
    };
  }
}

async function resolveInstalledVersion(binary: string): Promise<string | null> {
  try {
    const { stdout, stderr } = await execCommand(binary, ["--version"], {
      ...createProviderEnvSpec(),
      timeout: VERSION_TIMEOUT_MS,
      maxBuffer: 64 * 1024,
    });
    return extractVersion(stdout || stderr);
  } catch {
    return null;
  }
}

async function resolveLatestVersion(packageName: string): Promise<string | null> {
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  try {
    const { stdout } = await execCommand(npmCommand, ["view", packageName, "version"], {
      ...createProviderEnvSpec(),
      timeout: VERSION_TIMEOUT_MS,
      maxBuffer: 64 * 1024,
      shell: false,
    });
    return extractVersion(stdout);
  } catch {
    return null;
  }
}

function extractVersion(output: string): string | null {
  const match = output.match(/\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?/);
  return match?.[0] ?? null;
}

function getVersionStatus(
  installedVersion: string | null,
  latestVersion: string | null,
): ProviderVersionStatus {
  if (!installedVersion) {
    return "not-installed";
  }
  if (!latestVersion) {
    return "unknown";
  }
  return installedVersion === latestVersion ? "current" : "outdated";
}

function truncateOutput(output: string): string {
  if (output.length <= OUTPUT_CAP) {
    return output;
  }
  return `${output.slice(0, OUTPUT_CAP)}\n...(truncated)`;
}
