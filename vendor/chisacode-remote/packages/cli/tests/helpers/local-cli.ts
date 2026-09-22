import { spawn } from "node:child_process";
import { join } from "node:path";

const CLI_ENTRY = join(import.meta.dirname, "..", "..", "dist", "index.js");

export interface LocalCliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export function runLocalChisaCode(
  args: string[],
  env: NodeJS.ProcessEnv = {},
): Promise<LocalCliResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI_ENTRY, ...args], {
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", (code) => {
      resolve({
        exitCode: code ?? 1,
        stdout,
        stderr,
      });
    });
  });
}
