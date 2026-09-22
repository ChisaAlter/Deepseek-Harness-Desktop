// Shell environment resolution adapted from VS Code
// https://github.com/microsoft/vscode/blob/main/src/vs/platform/shell/node/shellEnv.ts
// Licensed under the MIT License.

import { execFile, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { userInfo } from "node:os";
import { basename } from "node:path";

const RESOLVE_TIMEOUT_MS = 5_000;

function getSystemShell(): string {
  const shell = process.env.SHELL;
  if (shell) return shell;

  try {
    const info = userInfo();
    if (info.shell && info.shell !== "/bin/false") return info.shell;
  } catch {}

  return process.platform === "darwin" ? "/bin/zsh" : "/bin/bash";
}

function resolveShellEnv(): Record<string, string> | undefined {
  if (process.platform === "win32") return undefined;

  const savedRunAsNode = process.env.ELECTRON_RUN_AS_NODE;
  const savedNoAttach = process.env.ELECTRON_NO_ATTACH_CONSOLE;

  const mark = randomUUID().replace(/-/g, "").slice(0, 12);
  const regex = new RegExp(mark + "({.*})" + mark);

  const shell = getSystemShell();
  const name = basename(shell);

  let command: string;
  let shellArgs: string[];

  const execPath = process.execPath.replace(/'/g, "'\\''");

  if (/^(?:pwsh|powershell)(?:-preview)?$/.test(name)) {
    command = `& '${execPath}' -p '''${mark}'' + JSON.stringify(process.env) + ''${mark}'''`;
    shellArgs = ["-Login", "-Command"];
  } else if (name === "nu") {
    command = `^'${execPath}' -p '"${mark}" + JSON.stringify(process.env) + "${mark}"'`;
    shellArgs = ["-i", "-l", "-c"];
  } else if (name === "xonsh") {
    command = `import os, json; print("${mark}", json.dumps(dict(os.environ)), "${mark}")`;
    shellArgs = ["-i", "-l", "-c"];
  } else {
    command = `'${execPath}' -p '"${mark}" + JSON.stringify(process.env) + "${mark}"'`;
    if (name === "tcsh" || name === "csh") {
      shellArgs = ["-ic"];
    } else {
      shellArgs = ["-i", "-l", "-c"];
    }
  }

  const shellEnv = { ...process.env };
  delete shellEnv.CHISACODE_NODE_ENV;
  delete shellEnv.CHISACODE_DESKTOP_MANAGED;
  delete shellEnv.CHISACODE_SUPERVISED;

  const result = spawnSync(shell, [...shellArgs, command], {
    encoding: "utf8",
    timeout: RESOLVE_TIMEOUT_MS,
    windowsHide: true,
    env: {
      ...shellEnv,
      ELECTRON_RUN_AS_NODE: "1",
      ELECTRON_NO_ATTACH_CONSOLE: "1",
    },
  });

  if (result.status !== 0 && result.status !== null) return undefined;
  if (result.status === null) {
    console.error("[login-shell-env] Shell env resolution terminated by signal");
    return undefined;
  }
  if (!result.stdout) return undefined;

  const match = regex.exec(result.stdout);
  if (!match?.[1]) return undefined;

  try {
    const env = JSON.parse(match[1]) as Record<string, string>;

    if (savedRunAsNode) {
      env.ELECTRON_RUN_AS_NODE = savedRunAsNode;
    } else {
      delete env.ELECTRON_RUN_AS_NODE;
    }

    if (savedNoAttach) {
      env.ELECTRON_NO_ATTACH_CONSOLE = savedNoAttach;
    } else {
      delete env.ELECTRON_NO_ATTACH_CONSOLE;
    }

    delete env.XDG_RUNTIME_DIR;

    return env;
  } catch {
    return undefined;
  }
}

/**
 * On macOS/Linux, Electron inherits a minimal environment when launched from
 * Finder/Dock. Spawn the user's login shell and capture its full environment
 * via Node's JSON.stringify(process.env), so the daemon and all child processes
 * see the same tools and variables as a normal terminal session.
 *
 * Approach borrowed from VS Code (src/vs/platform/shell/node/shellEnv.ts).
 */
export function inheritLoginShellEnv(): void {
  try {
    const env = resolveShellEnv();
    if (env) {
      Object.assign(process.env, env);
    }
  } catch {
    // Keep inherited environment if shell lookup fails.
  }
}

/**
 * Async variant of {@link inheritLoginShellEnv} that uses `execFile`
 * (non-blocking) instead of `spawnSync`. Prefer this on the startup
 * hot-path so the shell resolution can run in parallel with
 * `app.whenReady()` and window creation, avoiding a 2–5 s delay on
 * macOS/Linux.
 */
export async function inheritLoginShellEnvAsync(): Promise<void> {
  if (process.platform === "win32") return;

  try {
    const env = await resolveShellEnvAsync();
    if (env) {
      Object.assign(process.env, env);
    }
  } catch {
    // Keep inherited environment if shell lookup fails.
  }
}

function resolveShellEnvAsync(): Promise<Record<string, string> | undefined> {
  return new Promise((resolve) => {
    if (process.platform === "win32") return resolve(undefined);

    const savedRunAsNode = process.env.ELECTRON_RUN_AS_NODE;
    const savedNoAttach = process.env.ELECTRON_NO_ATTACH_CONSOLE;

    const mark = randomUUID().replace(/-/g, "").slice(0, 12);
    const regex = new RegExp(mark + "({.*})" + mark);

    const shell = getSystemShell();
    const name = basename(shell);

    let command: string;
    let shellArgs: string[];

    const execPath = process.execPath.replace(/'/g, "'\\''");

    if (/^(?:pwsh|powershell)(?:-preview)?$/.test(name)) {
      command = `& '${execPath}' -p '''${mark}'' + JSON.stringify(process.env) + ''${mark}'''`;
      shellArgs = ["-Login", "-Command"];
    } else if (name === "nu") {
      command = `^'${execPath}' -p '"${mark}" + JSON.stringify(process.env) + "${mark}"'`;
      shellArgs = ["-i", "-l", "-c"];
    } else if (name === "xonsh") {
      command = `import os, json; print("${mark}", json.dumps(dict(os.environ)), "${mark}")`;
      shellArgs = ["-i", "-l", "-c"];
    } else {
      command = `'${execPath}' -p '"${mark}" + JSON.stringify(process.env) + "${mark}"'`;
      if (name === "tcsh" || name === "csh") {
        shellArgs = ["-ic"];
      } else {
        shellArgs = ["-i", "-l", "-c"];
      }
    }

    const shellEnv = { ...process.env };
    delete shellEnv.CHISACODE_NODE_ENV;
    delete shellEnv.CHISACODE_DESKTOP_MANAGED;
    delete shellEnv.CHISACODE_SUPERVISED;

    execFile(
      shell,
      [...shellArgs, command],
      {
        encoding: "utf8",
        timeout: RESOLVE_TIMEOUT_MS,
        windowsHide: true,
        env: {
          ...shellEnv,
          ELECTRON_RUN_AS_NODE: "1",
          ELECTRON_NO_ATTACH_CONSOLE: "1",
        },
      },
      (error, stdout) => {
        if (error || !stdout) return resolve(undefined);

        const match = regex.exec(stdout);
        if (!match?.[1]) return resolve(undefined);

        try {
          const env = JSON.parse(match[1]) as Record<string, string>;

          if (savedRunAsNode) {
            env.ELECTRON_RUN_AS_NODE = savedRunAsNode;
          } else {
            delete env.ELECTRON_RUN_AS_NODE;
          }

          if (savedNoAttach) {
            env.ELECTRON_NO_ATTACH_CONSOLE = savedNoAttach;
          } else {
            delete env.ELECTRON_NO_ATTACH_CONSOLE;
          }

          delete env.XDG_RUNTIME_DIR;

          resolve(env);
        } catch {
          resolve(undefined);
        }
      },
    );
  });
}
