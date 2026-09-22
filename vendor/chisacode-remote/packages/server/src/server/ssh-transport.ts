/**
 * SSH Transport — run ACP agents on remote machines via SSH stdio.
 *
 * Creates a spawn-compatible function that runs a command on a remote host
 * over SSH, piping NDJSON (ACP protocol) through stdin/stdout. This plugs
 * directly into the ACP process runtime's `spawn` option — a remote agent
 * is just an ACP provider whose transport is SSH instead of a local process.
 *
 * Design adapted from Cindy's maker-remote-ssh + maker-cc-manager (Apache-2.0).
 */
import { type ChildProcess, spawn } from "node:child_process";
import type { SpawnProcessOptions } from "../utils/spawn.js";

// ── Types ──────────────────────────────────────────────────────────────────

export interface SSHConnectionConfig {
  /** Remote hostname or IP. */
  host: string;
  /** SSH username. Defaults to current user if omitted. */
  user?: string;
  /** SSH port. Defaults to 22. */
  port?: number;
  /** Path to private key file. If omitted, uses ssh-agent or default keys. */
  identityFile?: string;
  /** Additional SSH options (-o key=value). */
  sshOptions?: string[];
}

export interface SSHSpawnOptions {
  /** Remote command to execute (e.g. "chisacode-agent" or "claude --acp"). */
  remoteCommand: string;
  /** Arguments for the remote command. */
  remoteArgs?: string[];
  /** Remote working directory. */
  remoteCwd?: string;
  /** Environment variables to set on the remote side. */
  remoteEnv?: Record<string, string>;
}

// ── SSH command building ───────────────────────────────────────────────────

/**
 * SSH options that are safe to pass through `-o key=value`. Anything outside
 * this allowlist is rejected to prevent option-injection gadgets — in particular
 * `ProxyCommand`/`RemoteCommand`/`LocalCommand` run arbitrary local commands,
 * `PKCS11Provider` loads a native shared library into the ssh client, and
 * `ControlMaster`/`ControlPath` allow connection hijacking.
 */
const SAFE_SSH_OPTION_KEYS = new Set([
  "BatchMode",
  "ConnectTimeout",
  "ServerAliveInterval",
  "ServerAliveCountMax",
  "Compression",
  "LogLevel",
  "UserKnownHostsFile",
]);

/**
 * Option key prefixes that must never be weakened by a caller. Host-key
 * verification defaults are forced below; letting a peer disable them would
 * allow a man-in-the-middle on the NDJSON ACP channel.
 */
const FORBIDDEN_SSH_OPTION_KEYS = new Set([
  "StrictHostKeyChecking",
  "UserKnownHostsFile",
  "ProxyCommand",
  "ProxyJump",
  "RemoteCommand",
  "LocalCommand",
  "PermitLocalCommand",
  "PKCS11Provider",
  "ControlMaster",
  "ControlPath",
  "ControlPersist",
  "IdentityAgent",
  "CertificateFile",
  "SendEnv",
  "SetEnv",
]);

function parseOptionKey(opt: string): string {
  // -o key=value → key; reject anything that is not a simple key=value pair.
  const eq = opt.indexOf("=");
  if (eq <= 0) {
    throw new Error(`Invalid SSH option (expected key=value): "${opt}"`);
  }
  return opt.slice(0, eq).trim();
}

function assertSafeSSHOptions(sshOptions: string[] | undefined): void {
  if (!sshOptions) return;
  for (const opt of sshOptions) {
    const key = parseOptionKey(opt);
    if (FORBIDDEN_SSH_OPTION_KEYS.has(key)) {
      throw new Error(`Forbidden SSH option "${key}" is not allowed via sshOptions`);
    }
    if (!SAFE_SSH_OPTION_KEYS.has(key)) {
      throw new Error(`Unknown SSH option "${key}" is not in the safe allowlist`);
    }
  }
}

/**
 * Build the SSH command arguments for spawning a remote process.
 * Exported for testing — the actual spawn is done by {@link createSSHSpawner}.
 */
export function buildSSHArgs(config: SSHConnectionConfig, options: SSHSpawnOptions): string[] {
  // Reject dangerous caller-supplied options before anything reaches ssh.
  assertSafeSSHOptions(config.sshOptions);

  const args: string[] = [];

  // Port
  if (config.port && config.port !== 22) {
    args.push("-p", String(config.port));
  }

  // Identity file
  if (config.identityFile) {
    args.push("-i", config.identityFile);
  }

  // Caller-supplied safe SSH options (validated above).
  if (config.sshOptions) {
    for (const opt of config.sshOptions) {
      args.push("-o", opt);
    }
  }

  // Disable pseudo-terminal (we need raw stdio for NDJSON)
  args.push("-T");

  // Hardened host-key verification defaults. We set these AFTER caller options
  // so they cannot be weakened — assertSafeSSHOptions already rejected any
  // caller attempt to set these keys. accept-new trusts keys on first sight
  // but refuses to connect if a known key changes (MITM detection).
  args.push("-o", "StrictHostKeyChecking=accept-new");
  args.push("-o", "UserKnownHostsFile=~/.ssh/known_hosts");

  // Batch mode (no interactive prompts)
  args.push("-o", "BatchMode=yes");

  // Connection timeout
  args.push("-o", "ConnectTimeout=30");

  // Keepalive for long-running NDJSON streams (prevent silent disconnect)
  args.push("-o", "ServerAliveInterval=60");
  args.push("-o", "ServerAliveCountMax=3");

  // Target
  const target = config.user ? `${config.user}@${config.host}` : config.host;
  args.push(target);

  // Remote command with optional cwd and env
  const commandParts: string[] = [];
  if (options.remoteCwd) {
    commandParts.push(`cd ${shellQuote(options.remoteCwd)}`);
  }
  if (options.remoteEnv) {
    for (const [key, value] of Object.entries(options.remoteEnv)) {
      // Validate key is a safe shell variable name (prevent command injection)
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
        throw new Error(`Invalid environment variable name: "${key}"`);
      }
      // Newlines in env values would break out of the quoted region in the
      // `&&`-chained remote command and inject a separate command.
      if (value.includes("\n") || value.includes("\0")) {
        throw new Error(`SSH env value for "${key}" must not contain newlines`);
      }
      commandParts.push(`export ${key}=${shellQuote(value)}`);
    }
  }
  const fullCommand = [options.remoteCommand, ...(options.remoteArgs ?? [])]
    .map(shellQuote)
    .join(" ");
  commandParts.push(fullCommand);

  args.push(commandParts.join(" && "));

  return args;
}

/**
 * Create a spawn-compatible function for the ACP process runtime.
 *
 * Usage with ACP runtime:
 * ```ts
 * const sshSpawn = createSSHSpawner(sshConfig);
 * const result = await spawnInitializedACPProcess({
 *   launch: { command: "claude", args: ["--acp"] },
 *   spawn: sshSpawn,
 *   // ...
 * });
 * ```
 */
export function createSSHSpawner(
  config: SSHConnectionConfig,
): (command: string, args: string[], opts: SpawnProcessOptions) => ChildProcess {
  return (command: string, args: string[], opts?: SpawnProcessOptions) => {
    const sshArgs = buildSSHArgs(config, {
      remoteCommand: command,
      remoteArgs: args,
      remoteCwd: opts?.cwd as string | undefined,
      remoteEnv: opts?.env as Record<string, string> | undefined,
    });

    return spawn("ssh", sshArgs, {
      stdio: ["pipe", "pipe", "pipe"],
      // Pass only the minimal env ssh needs to locate binaries and keys; do NOT
      // spread process.env — that would leak daemon secrets (API keys, daemon
      // password) into the ssh child process environment.
      env: {
        PATH: process.env.PATH ?? "",
        HOME: process.env.HOME ?? "",
        LANG: process.env.LANG ?? "",
        // ssh reads GIT_SSH_* / TERM for its own behavior, not for the remote.
        TERM: process.env.TERM ?? "dumb",
      },
    });
  };
}

// ── Connection validation ──────────────────────────────────────────────────

/**
 * Test SSH connectivity by running a simple echo command.
 * Returns true if the connection succeeds within the timeout.
 */
export async function testSSHConnection(
  config: SSHConnectionConfig,
  timeoutMs = 10000,
): Promise<{ ok: boolean; error?: string }> {
  const args = buildSSHArgs(config, { remoteCommand: "echo", remoteArgs: ["ok"] });

  try {
    const result = await new Promise<{ code: number | null; stdout: string; stderr: string }>(
      (resolve) => {
        const child = spawn("ssh", args, { stdio: ["pipe", "pipe", "pipe"] });
        let stdout = "";
        let stderr = "";

        child.stdout?.on("data", (d: Buffer) => {
          stdout += d.toString();
        });
        child.stderr?.on("data", (d: Buffer) => {
          stderr += d.toString();
        });

        const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
        // 'close' always fires (even after spawn errors), so it is the
        // single resolve point — no separate 'error' handler needed.
        child.on("close", (code) => {
          clearTimeout(timer);
          // eslint-disable-next-line eslint-plugin-promise/no-multiple-resolved -- single resolve point; timeout triggers close which lands here
          resolve({ code, stdout, stderr });
        });
      },
    );

    if (result.code === 0 && result.stdout.includes("ok")) {
      return { ok: true };
    }
    return { ok: false, error: result.stderr.trim() || `exit code ${result.code}` };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

// ── Internals ──────────────────────────────────────────────────────────────

function shellQuote(value: string): string {
  // Values starting with `-` would be parsed as an option by the remote shell
  // (e.g. `cd -rf /`); force-quoting them keeps them positional. Newlines/NUL
  // would break out of the quoted region in the `&&`-chained remote command.
  if (value.length === 0 || value.startsWith("-") || value.includes("\n") || value.includes("\0")) {
    // Empty string and control-char values must be quoted to be safe.
    return `'${value.replace(/'/g, "'\\''")}'`;
  }
  if (/^[a-zA-Z0-9._/]+$/.test(value)) return value;
  return `'${value.replace(/'/g, "'\\''")}'`;
}
