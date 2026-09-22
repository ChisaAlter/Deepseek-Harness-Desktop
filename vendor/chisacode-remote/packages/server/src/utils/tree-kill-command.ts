import { execFile } from "node:child_process";

/** Runs a bounded hidden child process and resolves its UTF-8 stdout. */
export function execFileText(
  command: string,
  args: string[],
  options: { signal?: AbortSignal; timeout?: number } = {},
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      {
        encoding: "utf8",
        killSignal: "SIGKILL",
        maxBuffer: 4 * 1024 * 1024,
        signal: options.signal,
        timeout: options.timeout,
        windowsHide: true,
      },
      (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(stdout);
      },
    );
  });
}
