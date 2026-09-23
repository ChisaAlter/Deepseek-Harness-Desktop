import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, isAbsolute, join } from "node:path";
import { homedir } from "node:os";

let cachedClientId: string | null = null;

/**
 * Resolves the directory that stores the CLI's client identity.
 * @param env Environment containing the optional `CHISACODE_HOME` override
 * @returns An absolute directory suitable for stateful client identity storage
 */
export function resolveCliClientIdDirectory(env: NodeJS.ProcessEnv = process.env): string {
  const configuredHome = env.CHISACODE_HOME;
  if (!configuredHome?.trim() || !isAbsolute(configuredHome)) {
    return join(homedir(), ".chisacode");
  }
  return configuredHome;
}

function normalizeClientId(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function generateClientId(): string {
  return `cid_${randomUUID().replace(/-/g, "")}`;
}

function clientSessionKeyFile(): string {
  return join(resolveCliClientIdDirectory(), "cli-client-id");
}

export async function getOrCreateCliClientId(): Promise<string> {
  if (cachedClientId) {
    return cachedClientId;
  }

  const sessionKeyFile = clientSessionKeyFile();
  try {
    const existing = normalizeClientId(await readFile(sessionKeyFile, "utf8"));
    if (existing) {
      cachedClientId = existing;
      return existing;
    }
  } catch (error) {
    const code = (error as { code?: string } | null)?.code;
    if (code !== "ENOENT") {
      throw error;
    }
  }

  const nextValue = generateClientId();
  await mkdir(dirname(sessionKeyFile), { recursive: true });
  await writeFile(sessionKeyFile, nextValue, { mode: 0o600 });
  cachedClientId = nextValue;
  return nextValue;
}
