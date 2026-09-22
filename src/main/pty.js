const { randomUUID } = require('node:crypto');
const { loadWorkspaceAuthority } = require('./workspace-authority');

let workspaceAuthority = null;

/** Test seam: pin the trust root (node:test runs outside Electron). */
function setWorkspaceAuthority(authority) {
  workspaceAuthority = authority;
}

function asCwd(cwd) {
  if (workspaceAuthority === null) {
    workspaceAuthority = loadWorkspaceAuthority({ allowScratchCwd: true });
  }
  return workspaceAuthority.resolveAuthorizedCwd(cwd);
}

// Copied from the external desktop `apps/server/src/terminal/Manager.ts`.
const DEFAULT_OPEN_COLS = 120;
const DEFAULT_OPEN_ROWS = 30;
const TERMINAL_ENV_BLOCKLIST = new Set(['PORT', 'ELECTRON_RENDERER_PORT', 'ELECTRON_RUN_AS_NODE']);
const leftoverEnvPrefix = ['T', '3CODE_'].join('');

function shouldExcludeTerminalEnvKey(key) {
  const normalizedKey = key.toUpperCase();
  if (normalizedKey.startsWith(leftoverEnvPrefix)) {
    return true;
  }
  if (normalizedKey.startsWith('VITE_')) {
    return true;
  }
  return TERMINAL_ENV_BLOCKLIST.has(normalizedKey);
}

function defaultShellResolver(platform, env) {
  if (platform === 'win32') {
    return 'pwsh.exe';
  }
  return env.SHELL ?? 'bash';
}

function defaultShell() {
  return defaultShellResolver(process.platform, process.env);
}

function normalizeShellCommand(value, platform) {
  if (!value) return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;

  if (platform === 'win32') {
    return trimmed;
  }

  const firstToken = trimmed.split(/\s+/g)[0]?.trim();
  if (!firstToken) return null;
  return firstToken.replace(/^['"]|['"]$/g, '');
}

function basenameForPlatform(command, platform) {
  const normalized =
    platform === 'win32' ? command.replaceAll('/', '\\') : command.replaceAll('\\', '/');
  const parts = normalized
    .split(platform === 'win32' ? /\\+/ : /\/+/)
    .filter((part) => part.length > 0);
  return parts.at(-1) ?? normalized;
}

function joinWindowsPath(...parts) {
  return parts
    .map((part, index) => {
      if (index === 0) return part.replace(/[\\/]+$/g, '');
      return part.replace(/^[\\/]+|[\\/]+$/g, '');
    })
    .filter((part) => part.length > 0)
    .join('\\');
}

function shellCandidateFromCommand(command, platform) {
  if (!command || command.length === 0) return null;
  const shellName = basenameForPlatform(command, platform).toLowerCase();
  if (platform === 'win32' && (shellName === 'pwsh.exe' || shellName === 'powershell.exe')) {
    return { shell: command, args: ['-NoLogo'] };
  }
  if (platform !== 'win32' && shellName === 'zsh') {
    return { shell: command, args: ['-o', 'nopromptsp'] };
  }
  return { shell: command };
}

function windowsSystemRoot(env) {
  return env.SystemRoot?.trim() || env.windir?.trim() || 'C:\\Windows';
}

function windowsPowerShellPath(env) {
  return joinWindowsPath(
    windowsSystemRoot(env),
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe',
  );
}

function windowsCmdPath(env) {
  return joinWindowsPath(windowsSystemRoot(env), 'System32', 'cmd.exe');
}

function formatShellCandidate(candidate) {
  if (!candidate.args || candidate.args.length === 0) return candidate.shell;
  return `${candidate.shell} ${candidate.args.join(' ')}`;
}

function uniqueShellCandidates(candidates) {
  const seen = new Set();
  const ordered = [];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const key = formatShellCandidate(candidate);
    if (seen.has(key)) continue;
    seen.add(key);
    ordered.push(candidate);
  }
  return ordered;
}

function resolveShellCandidates(shellResolver, platform, env) {
  const requested = shellCandidateFromCommand(
    normalizeShellCommand(shellResolver(), platform),
    platform,
  );

  if (platform === 'win32') {
    return uniqueShellCandidates([
      requested,
      shellCandidateFromCommand('pwsh.exe', platform),
      shellCandidateFromCommand(windowsPowerShellPath(env), platform),
      shellCandidateFromCommand('powershell.exe', platform),
      shellCandidateFromCommand(env.ComSpec ?? null, platform),
      shellCandidateFromCommand(windowsCmdPath(env), platform),
      shellCandidateFromCommand('cmd.exe', platform),
    ]);
  }

  return uniqueShellCandidates([
    requested,
    shellCandidateFromCommand(normalizeShellCommand(env.SHELL, platform), platform),
    shellCandidateFromCommand('/bin/zsh', platform),
    shellCandidateFromCommand('/bin/bash', platform),
    shellCandidateFromCommand('/bin/sh', platform),
    shellCandidateFromCommand('zsh', platform),
    shellCandidateFromCommand('bash', platform),
    shellCandidateFromCommand('sh', platform),
  ]);
}

function defaultShellArgs(platform = process.platform, env = process.env) {
  const candidate = shellCandidateFromCommand(
    normalizeShellCommand(defaultShellResolver(platform, env), platform),
    platform,
  );
  return candidate?.args ?? [];
}

// Marker variables the AppImage runtime injects into the process it launches.
// They describe the AppImage itself, not the user's session, so terminals must
// not inherit them.
const APPIMAGE_RUNTIME_ENV_KEYS = ['APPIMAGE', 'APPDIR', 'ARGV0', 'OWD'];
// Colon-separated search-path variables the AppImage runtime points at its
// temporary mount (e.g. /tmp/.mount_*/usr/bin, the bundled glib schemas,
// and an $APPDIR/usr/share XDG data entry). Only the mount segments are
// dropped; the user's real entries are preserved. When nothing but mount
// segments remain the variable is removed entirely so consumers fall back to
// their platform default (e.g. gsettings finds the host schemas instead of
// reporting "No schemas installed"). See issues #1699 and #5059.
const APPIMAGE_PATH_LIKE_ENV_KEYS = [
  'PATH',
  'LD_LIBRARY_PATH',
  'XDG_DATA_DIRS',
  'GSETTINGS_SCHEMA_DIR',
];

function isPathSegmentUnderAppDir(segment, appDir) {
  return segment === appDir || segment.startsWith(`${appDir}/`);
}

// On Linux AppImage builds the runtime mounts the app under a temporary dir and
// injects APPIMAGE/APPDIR/ARGV0/OWD plus mount entries on PATH/LD_LIBRARY_PATH.
// The integrated terminal inherits the server process environment, so without
// this scrub those leak into the PTY and tools resolve against the AppImage
// mount instead of the user's real environment (e.g. `php` reporting
// PHP_BINARY as the AppImage path). See issue #1699. The scrub is gated on an
// actual AppImage launch so non-AppImage environments are left untouched.
function stripAppImageRuntimeEnv(env) {
  if (env.APPIMAGE === undefined && env.APPDIR === undefined) return env;

  const scrubbed = { ...env };
  for (const key of APPIMAGE_RUNTIME_ENV_KEYS) {
    delete scrubbed[key];
  }

  const appDir = env.APPDIR?.replace(/\/+$/, '');
  if (appDir) {
    for (const key of APPIMAGE_PATH_LIKE_ENV_KEYS) {
      const value = scrubbed[key];
      if (value === undefined) continue;
      const kept = value
        .split(':')
        .filter((segment) => segment.length > 0 && !isPathSegmentUnderAppDir(segment, appDir));
      if (kept.length > 0) {
        scrubbed[key] = kept.join(':');
      } else {
        delete scrubbed[key];
      }
    }
  }

  return scrubbed;
}

function createTerminalSpawnEnv(baseEnv, runtimeEnv) {
  const spawnEnv = {};
  for (const [key, value] of Object.entries(baseEnv)) {
    if (value === undefined) continue;
    if (shouldExcludeTerminalEnvKey(key)) continue;
    spawnEnv[key] = value;
  }
  if (runtimeEnv) {
    for (const [key, value] of Object.entries(runtimeEnv)) {
      spawnEnv[key] = value;
    }
  }
  return stripAppImageRuntimeEnv(spawnEnv);
}

function ptySpawnOptions({ cwd, cols, rows }, platform = process.platform, env = process.env) {
  const spawnEnv = createTerminalSpawnEnv(env);
  // Windows node-pty never writes `name` into $TERM. Electron stamps
  // TERM=dumb on the GUI process; Ink then skips color. Drop only that stamp.
  if (platform === 'win32' && spawnEnv.TERM === 'dumb') {
    delete spawnEnv.TERM;
  }
  return {
    cwd,
    cols: cols ?? DEFAULT_OPEN_COLS,
    rows: rows ?? DEFAULT_OPEN_ROWS,
    name: platform === 'win32' ? 'xterm-color' : 'xterm-256color',
    env: spawnEnv,
  };
}

function defaultSpawn() {
  let pty;
  try {
    pty = require('node-pty');
  } catch {
    throw new Error('node-pty is not available');
  }
  return ({ cwd, cols, rows, onData, onExit }) => {
    const options = ptySpawnOptions({ cwd, cols, rows });
    const candidates = resolveShellCandidates(
      () => defaultShellResolver(process.platform, process.env),
      process.platform,
      process.env,
    );
    let term;
    let lastError;
    for (const candidate of candidates) {
      try {
        term = pty.spawn(candidate.shell, candidate.args ?? [], options);
        break;
      } catch (error) {
        lastError = error;
      }
    }
    if (!term) {
      throw lastError || new Error('node-pty is not available');
    }
    let resolveExit;
    const exited = new Promise((resolve) => {
      resolveExit = resolve;
    });
    term.onData(onData);
    term.onExit(({ exitCode }) => {
      onExit(exitCode ?? 0);
      resolveExit();
    });
    return {
      write(data) {
        term.write(data);
      },
      resize(nextCols, nextRows) {
        term.resize(nextCols, nextRows);
      },
      kill() {
        term.kill();
        return new Promise((resolve) => {
          const timer = setTimeout(resolve, 2_000);
          exited.then(() => {
            clearTimeout(timer);
            resolve();
          });
        });
      },
    };
  };
}

const BACKEND_UNAVAILABLE = 'terminal backend unavailable';

/**
 * In-process PTY table used by Electron IPC. Tests inject a fake spawn that
 * echoes writes; production lazy-loads node-pty / conpty on the first create
 * so a missing optional native module cannot take down registerIpc.
 * @param {{ spawn?: Function | null, emit?: Function }} [options]
 */
function createPtyController(options = {}) {
  let spawn = options.spawn;
  const emit = options.emit ?? (() => {});
  const sessions = new Map();
  const eventListeners = new Set();

  function publish(channel, payload) {
    emit(channel, payload);
    for (const listener of eventListeners) {
      try {
        listener(channel, payload);
      } catch {
        // Observers must not interrupt terminal I/O.
      }
    }
  }

  function resolveSpawn() {
    if (spawn === null) {
      throw new Error(BACKEND_UNAVAILABLE);
    }
    if (typeof spawn === 'function') return spawn;
    spawn = defaultSpawn();
    return spawn;
  }

  function requireSession(id) {
    const session = sessions.get(id);
    if (!session) {
      throw new Error(`unknown pty id: ${id}`);
    }
    return session;
  }

  return {
    async create(input = {}) {
      const cwd = asCwd(input.cwd);
      if (!cwd) {
        throw new Error('ptyCreate requires a project cwd');
      }
      let backend;
      try {
        backend = resolveSpawn();
      } catch (error) {
        console.error('[pty] backend unavailable:', error && error.message ? error.message : error);
        throw new Error(BACKEND_UNAVAILABLE);
      }
      const id = randomUUID();
      let session;
      try {
        session = backend({
          cwd,
          cols: input.cols,
          rows: input.rows,
          onData(data) {
            publish('shell:pty-data', { id, data: String(data) });
          },
          onExit(code) {
            sessions.delete(id);
            publish('shell:pty-exit', { id, code: Number(code) || 0 });
          },
        });
      } catch (error) {
        console.error('[pty] spawn failed:', error && error.message ? error.message : error);
        throw new Error(BACKEND_UNAVAILABLE);
      }
      sessions.set(id, session);
      return { id };
    },

    async write(id, data) {
      requireSession(id).write(String(data ?? ''));
    },

    async resize(id, cols, rows) {
      requireSession(id).resize(Number(cols) || DEFAULT_OPEN_COLS, Number(rows) || DEFAULT_OPEN_ROWS);
    },

    async kill(id) {
      const session = sessions.get(id);
      if (!session) return;
      await session.kill();
      sessions.delete(id);
    },

    onEvent(listener) {
      if (typeof listener !== 'function') {
        throw new TypeError('PTY event listener must be a function');
      }
      eventListeners.add(listener);
      return () => eventListeners.delete(listener);
    },

    /** Kill every live PTY (app quit, harness restart, renderer teardown). */
    killAll() {
      const cleanup = [];
      for (const session of sessions.values()) {
        try {
          cleanup.push(Promise.resolve(session.kill()).catch(() => {}));
        } catch {
          // A backend that already exited must not block the sweep.
        }
      }
      sessions.clear();
      return Promise.all(cleanup);
    },
  };
}

/**
 * Register desktop PTY IPC on ipcMain.
 * @param {import('electron').IpcMain} ipcMain
 * @param {ReturnType<typeof createPtyController>} [controller]
 */
function registerPtyIpc(ipcMain, controller, options = {}) {
  const authorize = typeof options.authorize === 'function' ? options.authorize : () => {};
  const senders = new Set();
  /** PTY id -> owning webContents, so a dead renderer's PTYs can be reaped. */
  const owners = new Map();
  const live = controller ?? createPtyController({
    emit(channel, payload) {
      for (const sender of senders) {
        if (!sender.isDestroyed()) sender.send(channel, payload);
      }
    },
  });

  if (typeof live.onEvent === 'function') {
    live.onEvent((channel, payload) => {
      if (channel === 'shell:pty-exit' && payload) owners.delete(payload.id);
    });
  }

  function reapSender(sender) {
    for (const [id, owner] of [...owners]) {
      if (owner !== sender) continue;
      owners.delete(id);
      void Promise.resolve(live.kill(id)).catch(() => {});
    }
  }

  function track(event) {
    authorize(event);
    const sender = event.sender;
    if (sender && !senders.has(sender)) {
      senders.add(sender);
      if (typeof sender.on === 'function') {
        // A cross-document navigation (reload included) or a crashed renderer
        // destroys the JS context that owned these PTYs; reap them so main
        // keeps no orphan shells. Same-document navigation fires
        // did-navigate-in-page instead and leaves the sessions alone.
        sender.on('render-process-gone', () => reapSender(sender));
        sender.on('did-navigate', () => reapSender(sender));
      }
      sender.once('destroyed', () => {
        senders.delete(sender);
        reapSender(sender);
      });
    }
    return live;
  }

  ipcMain.handle('shell:pty-create', async (event, input) => {
    const created = await track(event).create(input);
    if (created && typeof created.id === 'string' && event.sender) {
      owners.set(created.id, event.sender);
    }
    return created;
  });
  ipcMain.handle('shell:pty-write', (event, id, data) => track(event).write(id, data));
  ipcMain.handle('shell:pty-resize', (event, id, cols, rows) => track(event).resize(id, cols, rows));
  ipcMain.handle('shell:pty-kill', (event, id) => track(event).kill(id));
  return live;
}

module.exports = {
  BACKEND_UNAVAILABLE,
  DEFAULT_OPEN_COLS,
  DEFAULT_OPEN_ROWS,
  createPtyController,
  registerPtyIpc,
  setWorkspaceAuthority,
  defaultShell,
  defaultShellArgs,
  ptySpawnOptions,
  createTerminalSpawnEnv,
  resolveShellCandidates,
};
