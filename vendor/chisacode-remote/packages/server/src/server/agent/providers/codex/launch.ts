import type { ChildProcess, ChildProcessWithoutNullStreams } from "node:child_process";
import type { Dirent } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type { Logger } from "pino";

import {
  checkProviderLaunchAvailable,
  createProviderEnv,
  createProviderEnvSpec,
  resolveProviderLaunch,
  type ProviderRuntimeSettings,
  type ResolvedProviderLaunch,
} from "../../provider-launch-config.js";
import { findExecutable, probeExecutable } from "../../../../utils/executable.js";
import { spawnProcess } from "../../../../utils/spawn.js";

export const CODEX_GOALS_MIN_VERSION: readonly [number, number, number] = [0, 128, 0];
export const CODEX_AUTO_REVIEW_MIN_VERSION: readonly [number, number, number] = [0, 115, 0];

function assertChildWithPipes(
  child: ChildProcess,
): asserts child is ChildProcessWithoutNullStreams {
  if (!child.stdin || !child.stdout || !child.stderr) {
    throw new Error("Child process did not expose stdio pipes");
  }
}

function codexMicrosoftStorePackageRoot(): string | null {
  const localAppData = process.env.LOCALAPPDATA;
  return localAppData ? path.join(localAppData, "Packages") : null;
}

function parseCodexVersion(versionOutput: string): [number, number, number] | null {
  const match = versionOutput.match(/(\d+)\.(\d+)\.(\d+)/);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

export function codexVersionAtLeast(
  versionOutput: string,
  min: readonly [number, number, number],
): boolean {
  const parsed = parseCodexVersion(versionOutput);
  if (!parsed) return false;
  for (let index = 0; index < 3; index += 1) {
    if (parsed[index] > min[index]) return true;
    if (parsed[index] < min[index]) return false;
  }
  return true;
}

export async function findCodexMicrosoftStoreBinary(): Promise<string | null> {
  if (process.platform !== "win32") {
    return null;
  }

  const packageRoot = codexMicrosoftStorePackageRoot();
  if (!packageRoot) {
    return null;
  }

  let entries: Dirent[];
  try {
    entries = await fs.readdir(packageRoot, { withFileTypes: true });
  } catch {
    return null;
  }

  const codexPackages = entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("OpenAI.Codex_"))
    .map((entry) => entry.name)
    .sort();

  for (const packageName of codexPackages) {
    const candidate = path.join(
      packageRoot,
      packageName,
      "LocalCache",
      "Local",
      "OpenAI",
      "Codex",
      "bin",
      "codex.exe",
    );
    if (await probeExecutable(candidate)) {
      return candidate;
    }
  }

  return null;
}

export async function findDefaultCodexBinary(): Promise<string | null> {
  return (await findExecutable("codex")) ?? (await findCodexMicrosoftStoreBinary());
}

export async function resolveCodexLaunch(
  runtimeSettings?: ProviderRuntimeSettings,
): Promise<ResolvedProviderLaunch> {
  return resolveProviderLaunch({
    commandConfig: runtimeSettings?.command,
    defaultBinary: {
      command: "codex",
      resolvePath: findDefaultCodexBinary,
    },
  });
}

export async function checkCodexLaunchAvailable(launch: ResolvedProviderLaunch) {
  return checkProviderLaunchAvailable(launch, {
    command: "codex",
    resolvePath: findDefaultCodexBinary,
  });
}

export async function resolveCodexLaunchPrefix(
  runtimeSettings?: ProviderRuntimeSettings,
): Promise<{ command: string; args: string[] }> {
  const launch = await resolveCodexLaunch(runtimeSettings);
  const availability = await checkCodexLaunchAvailable(launch);
  if (!availability.available) {
    throw new Error(
      "Codex binary not found. Install the Codex CLI (https://github.com/openai/codex) and ensure it is available in your shell PATH.",
    );
  }
  return {
    command:
      launch.source === "override" ? launch.command : (availability.resolvedPath ?? launch.command),
    args: launch.args,
  };
}

export function buildCodexAppServerEnv(
  runtimeSettings?: ProviderRuntimeSettings,
  launchEnv?: Record<string, string>,
): NodeJS.ProcessEnv {
  return createProviderEnv({
    runtimeSettings,
    overlays: [launchEnv],
  });
}

export async function spawnCodexAppServer(params: {
  logger: Logger;
  runtimeSettings?: ProviderRuntimeSettings;
  launchEnv?: Record<string, string>;
  goalsEnabled?: boolean;
  agentId?: string;
}): Promise<ChildProcessWithoutNullStreams> {
  const launchPrefix = await resolveCodexLaunchPrefix(params.runtimeSettings);
  const args = [...launchPrefix.args, "app-server"];
  if (params.goalsEnabled) {
    args.push("--enable", "goals");
  }
  params.logger.trace(
    {
      agentId: params.agentId,
      provider: "codex",
      launchPrefix,
      goalsEnabled: params.goalsEnabled === true,
    },
    "provider.codex.spawn",
  );
  const child = spawnProcess(launchPrefix.command, args, {
    detached: process.platform !== "win32",
    stdio: ["pipe", "pipe", "pipe"],
    ...createProviderEnvSpec({
      runtimeSettings: params.runtimeSettings,
      overlays: [params.launchEnv],
    }),
  });
  assertChildWithPipes(child);
  return child;
}
