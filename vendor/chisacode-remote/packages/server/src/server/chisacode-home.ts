import os from "node:os";
import path from "node:path";
import { ensurePrivateDirectory } from "./private-files.js";

export const CHISACODE_HOME_ENV = "CHISACODE_HOME";
export const DEFAULT_CHISACODE_HOME = "~/.chisacode";

function expandHomeDir(input: string): string {
  if (input.startsWith("~/")) {
    return path.join(os.homedir(), input.slice(2));
  }
  if (input === "~") {
    return os.homedir();
  }
  return input;
}

function resolveHomeCandidate(input: string): string {
  return path.resolve(expandHomeDir(input));
}

function resolveDefaultHome(): string {
  return resolveHomeCandidate(DEFAULT_CHISACODE_HOME);
}

export function resolveChisaCodeHome(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.CHISACODE_HOME;
  const resolved = raw ? resolveHomeCandidate(raw) : resolveDefaultHome();
  ensurePrivateDirectory(resolved);
  return resolved;
}
