import { resolve } from "path";

function isTruthyEnv(value: string | undefined): boolean {
  const normalized = (value ?? "").trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

export function isChisaCodeDictationDebugEnabled(): boolean {
  return isTruthyEnv(process.env.CHISACODE_DICTATION_DEBUG);
}

export function resolveRecordingsDebugDir(explicitEnvVarName: string): string | null {
  const explicit = process.env[explicitEnvVarName];
  if (explicit && explicit.trim()) {
    return resolve(explicit.trim());
  }

  if (!isChisaCodeDictationDebugEnabled()) {
    return null;
  }

  return resolve(process.cwd(), ".debug/recordings");
}
