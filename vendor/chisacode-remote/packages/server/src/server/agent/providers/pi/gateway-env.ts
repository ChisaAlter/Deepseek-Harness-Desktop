import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Env var Pi reads for its agent config directory (`~/.pi/agent` by default). */
export const PI_CODING_AGENT_DIR_ENV = "PI_CODING_AGENT_DIR";

/**
 * When ChisaCode launches Pi against a model gateway it sets OPENAI_API_KEY /
 * OPENAI_BASE_URL. Pi honors the key from env but still resolves openai baseUrl
 * from ~/.pi/agent/models.json (or built-in defaults). Isolate the agent dir so
 * the gateway base URL and env-backed key win over the user's personal Pi config.
 * @param env Launch env overlay for the Pi process
 * @returns Env with PI_CODING_AGENT_DIR set when gateway isolation is needed
 */
export function preparePiGatewayEnv(
  env: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!env) {
    return env;
  }
  const apiKey = env.OPENAI_API_KEY?.trim();
  const baseUrl = env.OPENAI_BASE_URL?.trim();
  if (!apiKey || !baseUrl || env[PI_CODING_AGENT_DIR_ENV]?.trim()) {
    return env;
  }

  const agentDir = resolveManagedPiAgentDir(baseUrl);
  writeManagedPiModelsJson(agentDir, baseUrl);
  return {
    ...env,
    [PI_CODING_AGENT_DIR_ENV]: agentDir,
  };
}

function resolveManagedPiAgentDir(baseUrl: string): string {
  const chisacodeHome = process.env.CHISACODE_HOME?.trim() || join(homedir(), ".chisacode");
  const configHash = createHash("sha256").update(baseUrl).digest("hex").slice(0, 10);
  return join(chisacodeHome, "provider-runtime", "pi", configHash);
}

function writeManagedPiModelsJson(agentDir: string, baseUrl: string): void {
  mkdirSync(agentDir, { recursive: true, mode: 0o700 });
  const modelsPath = join(agentDir, "models.json");
  const payload = {
    providers: {
      openai: {
        baseUrl,
        api: "openai-completions",
        // Resolved from the process env ChisaCode injects for gateway faces.
        apiKey: "$OPENAI_API_KEY",
      },
    },
  };
  const tempPath = join(agentDir, `.${process.pid}.${randomUUID()}.models.json.tmp`);
  const content = `${JSON.stringify(payload, null, 2)}\n`;
  let fd: number | undefined;
  try {
    writeFileSync(tempPath, content, { encoding: "utf8", mode: 0o600 });
    fd = openSync(tempPath, "r");
    try {
      fsyncSync(fd);
    } catch (error) {
      // Windows and some filesystems do not support fsync for this handle.
      // The temp-file + same-directory rename remains atomic, so only treat
      // known unsupported durability errors as best-effort.
      const code = (error as NodeJS.ErrnoException).code;
      if (process.platform !== "win32" || !["EPERM", "EINVAL", "ENOTSUP"].includes(code ?? "")) {
        throw error;
      }
    } finally {
      closeSync(fd);
      fd = undefined;
    }
    renameSync(tempPath, modelsPath);
    if (process.platform !== "win32") {
      try {
        chmodSync(modelsPath, 0o600);
      } catch {
        // Keep launch resilient on filesystems without POSIX chmod support.
      }
    }
  } catch (error) {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        // ignore cleanup errors
      }
    }
    rmSync(tempPath, { force: true });
    throw error;
  }
}
