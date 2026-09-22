import { existsSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  ChisaCodeConfigRawSchema,
  type ChisaCodeConfigRaw,
  type ChisaCodeConfigRevision,
  type ProjectConfigRpcError,
} from "@chisacode/protocol/chisacode-config-schema";
export {
  ChisaCodeConfigRevisionSchema,
  ProjectConfigRpcErrorSchema,
  type ChisaCodeConfigRevision,
  type ProjectConfigRpcError,
} from "@chisacode/protocol/chisacode-config-schema";

export const CHISACODE_CONFIG_FILE_NAME = "chisacode.json";

export type ReadChisaCodeConfigForEditResult =
  | { ok: true; config: ChisaCodeConfigRaw | null; revision: ChisaCodeConfigRevision | null }
  | { ok: false; error: ProjectConfigRpcError };

export type WriteChisaCodeConfigForEditResult =
  | { ok: true; config: ChisaCodeConfigRaw; revision: ChisaCodeConfigRevision }
  | { ok: false; error: ProjectConfigRpcError };

export interface WriteChisaCodeConfigForEditInput {
  repoRoot: string;
  config: ChisaCodeConfigRaw;
  expectedRevision: ChisaCodeConfigRevision | null;
}

function resolveConfigPathForRead(repoRoot: string): string {
  return join(repoRoot, CHISACODE_CONFIG_FILE_NAME);
}

function resolveConfigPathForWrite(repoRoot: string): string {
  return join(repoRoot, CHISACODE_CONFIG_FILE_NAME);
}

export function resolveChisaCodeConfigPath(repoRoot: string): string {
  return resolveConfigPathForRead(repoRoot);
}

export function statChisaCodeConfigPath(repoRoot: string): ChisaCodeConfigRevision | null {
  const configPath = resolveChisaCodeConfigPath(repoRoot);
  if (!existsSync(configPath)) {
    return null;
  }
  const stats = statSync(configPath);
  return {
    mtimeMs: stats.mtimeMs,
    size: stats.size,
  };
}

export function readChisaCodeConfigJson(repoRoot: string): unknown {
  const configPath = resolveChisaCodeConfigPath(repoRoot);
  if (!existsSync(configPath)) {
    return null;
  }
  return JSON.parse(readFileSync(configPath, "utf8"));
}

export function readChisaCodeConfigForEdit(repoRoot: string): ReadChisaCodeConfigForEditResult {
  try {
    const json = readChisaCodeConfigJson(repoRoot);
    if (json === null) {
      return { ok: true, config: null, revision: null };
    }
    return {
      ok: true,
      config: ChisaCodeConfigRawSchema.parse(json),
      revision: statChisaCodeConfigPath(repoRoot),
    };
  } catch {
    return {
      ok: false,
      error: { code: "invalid_project_config" },
    };
  }
}

export function writeChisaCodeConfigForEdit(
  input: WriteChisaCodeConfigForEditInput,
): WriteChisaCodeConfigForEditResult {
  const parsed = ChisaCodeConfigRawSchema.safeParse(input.config);
  if (!parsed.success) {
    return { ok: false, error: { code: "invalid_project_config" } };
  }

  const configPath = resolveConfigPathForWrite(input.repoRoot);
  const configFileName = CHISACODE_CONFIG_FILE_NAME;
  const tempPath = join(input.repoRoot, `.${configFileName}.${process.pid}.${randomUUID()}.tmp`);

  try {
    writeFileSync(tempPath, `${JSON.stringify(parsed.data, null, 2)}\n`);
    const currentRevision = statChisaCodeConfigPath(input.repoRoot);
    if (!chisacodeConfigRevisionsEqual(currentRevision, input.expectedRevision)) {
      removeTempChisaCodeConfig(tempPath);
      return {
        ok: false,
        error: { code: "stale_project_config", currentRevision },
      };
    }

    renameSync(tempPath, configPath);
    const revision = statChisaCodeConfigPath(input.repoRoot);
    if (!revision) {
      return { ok: false, error: { code: "write_failed" } };
    }
    return { ok: true, config: parsed.data, revision };
  } catch {
    removeTempChisaCodeConfig(tempPath);
    return { ok: false, error: { code: "write_failed" } };
  }
}

function chisacodeConfigRevisionsEqual(
  left: ChisaCodeConfigRevision | null,
  right: ChisaCodeConfigRevision | null,
): boolean {
  if (left === null || right === null) {
    return left === right;
  }
  return left.mtimeMs === right.mtimeMs && left.size === right.size;
}

function removeTempChisaCodeConfig(tempPath: string): void {
  try {
    rmSync(tempPath, { force: true });
  } catch {
    // Best-effort cleanup only; callers need the original write outcome.
  }
}
