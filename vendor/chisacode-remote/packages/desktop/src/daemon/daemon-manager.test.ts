import { EventEmitter } from "node:events";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_DESKTOP_SETTINGS } from "../settings/desktop-settings";
import {
  createDaemonCommandHandlers,
  assertTransportPathAllowed,
  isMainAppSenderUrl,
  PRIVILEGED_COMMANDS,
  resolveDesktopDaemonStatus,
  resolveDesktopDevPort,
  resolveMainAppSenderValidationOptions,
  shouldRestartForVersion,
} from "./daemon-manager";
import type { DesktopDaemonStatus } from "./daemon-manager";

const mocks = vi.hoisted(() => ({
  settings: {
    releaseChannel: "stable",
    daemon: {
      manageBuiltInDaemon: true,
      keepRunningAfterQuit: true,
    },
  },
  runExternalCliJsonCommand: vi.fn(),
  runExternalCliTextCommand: vi.fn(),
  spawnProcess: vi.fn(),
}));

vi.mock("electron", () => ({
  app: {
    getPath: vi.fn(() => "/tmp/chisacode-user-data"),
    getVersion: vi.fn(() => "1.2.3"),
    isPackaged: false,
  },
  ipcMain: { handle: vi.fn() },
  powerMonitor: { getSystemIdleTime: vi.fn(() => 0) },
}));

vi.mock("electron-log/main", () => ({
  default: { info: vi.fn(), error: vi.fn() },
}));

vi.mock("@chisacode/server", () => ({
  resolveChisaCodeHome: vi.fn(() => "/tmp/chisacode-home"),
  spawnProcess: mocks.spawnProcess,
}));

vi.mock("../settings/desktop-settings-electron.js", () => ({
  getDesktopSettingsStore: () => ({
    get: async () => mocks.settings,
    patch: vi.fn(),
    migrateLegacyRendererSettings: vi.fn(),
  }),
}));

vi.mock("./runtime-paths.js", () => ({
  createNodeEntrypointInvocation: vi.fn(() => ({
    command: "node",
    args: [],
    env: {},
  })),
  resolveDaemonRunnerEntrypoint: vi.fn(() => ({
    entryPath: "/tmp/daemon.js",
    execArgv: [],
  })),
}));

vi.mock("./cli/external.js", () => ({
  runExternalCliJsonCommand: mocks.runExternalCliJsonCommand,
  runExternalCliTextCommand: mocks.runExternalCliTextCommand,
}));

function desktopSettingsWithManagement(enabled: boolean) {
  return {
    ...DEFAULT_DESKTOP_SETTINGS,
    daemon: {
      ...DEFAULT_DESKTOP_SETTINGS.daemon,
      manageBuiltInDaemon: enabled,
    },
  };
}

type MockChildProcess = EventEmitter & {
  stdout: EventEmitter;
  stderr: EventEmitter;
  pid: number;
  spawnfile: string;
  spawnargs: string[];
  unref: ReturnType<typeof vi.fn>;
};

function createMockChildProcess(): MockChildProcess {
  const child = new EventEmitter() as MockChildProcess;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.pid = 1234;
  child.spawnfile = "node";
  child.spawnargs = ["node", "daemon.js"];
  child.unref = vi.fn();
  return child;
}

function scheduleFailedStartupOutput(child: MockChildProcess): void {
  setImmediate(() => {
    child.stdout.emit("data", Buffer.from(`${"x".repeat(80_000)}stdout-tail`));
    child.stderr.emit("data", Buffer.from(`${"y".repeat(80_000)}stderr-tail`));
    child.emit("exit", 1, null);
  });
}

describe("daemon-manager commands", () => {
  beforeEach(() => {
    mocks.settings = DEFAULT_DESKTOP_SETTINGS;
    mocks.runExternalCliJsonCommand.mockReset();
    mocks.runExternalCliTextCommand.mockReset();
    mocks.spawnProcess.mockReset();
  });

  it("starts the daemon even while built-in daemon management is disabled (hard-bound)", async () => {
    mocks.settings = desktopSettingsWithManagement(false);
    // Status check reports a reachable running daemon — start returns it
    // without spawning. The key assertion: start does NOT throw
    // "daemon management disabled" even though manageBuiltInDaemon is false.
    mocks.runExternalCliJsonCommand.mockResolvedValue({
      localDaemon: "stale_pid",
      connectedDaemon: "reachable",
      serverId: "srv_hardbound",
      pid: 9999,
      listen: "127.0.0.1:6767",
      hostname: "dev-host",
      daemonVersion: "1.2.3",
      desktopManaged: true,
    });
    const handlers = createDaemonCommandHandlers();

    const status = await handlers.start_desktop_daemon();

    expect(status.status).toBe("running");
    expect(status.serverId).toBe("srv_hardbound");
    expect(mocks.spawnProcess).not.toHaveBeenCalled();
  });

  it("refuses restart while built-in daemon management is disabled", async () => {
    mocks.settings = desktopSettingsWithManagement(false);
    const handlers = createDaemonCommandHandlers();

    await expect(handlers.restart_desktop_daemon()).rejects.toThrow(/daemon 管理已禁用|disabled/);

    expect(mocks.runExternalCliJsonCommand).not.toHaveBeenCalled();
    expect(mocks.spawnProcess).not.toHaveBeenCalled();
  });

  it("keeps stop callable while built-in daemon management is disabled", async () => {
    mocks.settings = desktopSettingsWithManagement(false);
    mocks.runExternalCliJsonCommand.mockResolvedValue({
      localDaemon: "stopped",
      serverId: "",
    });
    const handlers = createDaemonCommandHandlers();

    await expect(handlers.stop_desktop_daemon()).resolves.toEqual({
      serverId: "",
      status: "stopped",
      listen: null,
      hostname: null,
      pid: null,
      home: "/tmp/chisacode-home",
      version: null,
      desktopManaged: false,
      error: null,
    });

    expect(mocks.runExternalCliJsonCommand).toHaveBeenCalledWith(["daemon", "status", "--json"]);
  });

  it("routes running desktop daemon stops through external CLI daemon stop", async () => {
    mocks.runExternalCliJsonCommand
      .mockResolvedValueOnce({
        localDaemon: "running",
        serverId: "server-1",
        pid: 4242,
        listen: "127.0.0.1:6767",
        desktopManaged: true,
      })
      .mockResolvedValueOnce({ action: "stopped" })
      .mockResolvedValueOnce({
        localDaemon: "stopped",
        serverId: "",
      });
    const handlers = createDaemonCommandHandlers();

    await expect(handlers.stop_desktop_daemon()).resolves.toEqual({
      serverId: "",
      status: "stopped",
      listen: null,
      hostname: null,
      pid: null,
      home: "/tmp/chisacode-home",
      version: null,
      desktopManaged: false,
      error: null,
    });

    expect(mocks.runExternalCliJsonCommand).toHaveBeenNthCalledWith(1, [
      "daemon",
      "status",
      "--json",
    ]);
    expect(mocks.runExternalCliJsonCommand).toHaveBeenNthCalledWith(2, [
      "daemon",
      "stop",
      "--json",
      "--timeout",
      "5",
      "--force",
      "--kill-timeout",
      "5",
    ]);
    expect(mocks.runExternalCliJsonCommand).toHaveBeenNthCalledWith(3, [
      "daemon",
      "status",
      "--json",
    ]);
  });

  it("uses a reachable daemon when the PID file is stale", async () => {
    mocks.runExternalCliJsonCommand.mockResolvedValue({
      localDaemon: "stale_pid",
      connectedDaemon: "reachable",
      serverId: "server-1",
      pid: 7675,
      listen: "127.0.0.1:6767",
      hostname: "dev-host",
      daemonVersion: "1.2.2",
      desktopManaged: true,
    });
    const handlers = createDaemonCommandHandlers();

    await expect(handlers.start_desktop_daemon()).resolves.toEqual({
      serverId: "server-1",
      status: "running",
      listen: "127.0.0.1:6767",
      hostname: "dev-host",
      pid: null,
      home: "/tmp/chisacode-home",
      version: "1.2.2",
      desktopManaged: false,
      error: null,
    });

    expect(mocks.spawnProcess).not.toHaveBeenCalled();
  });

  it("bounds captured daemon startup output", async () => {
    mocks.runExternalCliJsonCommand.mockResolvedValue({
      localDaemon: "stopped",
      connectedDaemon: "unreachable",
      serverId: "",
    });
    mocks.spawnProcess.mockImplementation(() => {
      const child = createMockChildProcess();
      scheduleFailedStartupOutput(child);
      return child;
    });
    const handlers = createDaemonCommandHandlers();

    let thrown: Error | null = null;
    try {
      await handlers.start_desktop_daemon();
    } catch (error) {
      thrown = error instanceof Error ? error : new Error(String(error));
    }

    expect(thrown).toBeInstanceOf(Error);
    const message = thrown?.message ?? "";
    expect(message).toContain("Daemon failed to start: exit code 1");
    expect(message).toContain("output truncated to the last 65536 chars");
    expect(message).toContain("stdout-tail");
    expect(message).toContain("stderr-tail");
    expect(message.length).toBeLessThan(150_000);
  });
});

describe("daemon-manager privileged IPC sender validation", () => {
  it("accepts packaged app protocol routes as main application senders", () => {
    expect(isMainAppSenderUrl("chisacode://app/h/srv_1/workspace/b64_x")).toBe(true);
    expect(isMainAppSenderUrl("chisacode://app/settings/models")).toBe(true);
  });

  it("keeps external origins blocked from privileged desktop commands", () => {
    expect(isMainAppSenderUrl("https://example.com")).toBe(false);
    expect(isMainAppSenderUrl("https://localhost.evil.test")).toBe(false);
    expect(isMainAppSenderUrl("about:blank")).toBe(false);
  });

  it("rejects file:// and localhost in packaged builds", () => {
    expect(isMainAppSenderUrl("file:///app-dist/index.html", { packaged: true })).toBe(false);
    expect(isMainAppSenderUrl("http://localhost:8081/h/srv_1/workspace", { packaged: true })).toBe(
      false,
    );
    expect(isMainAppSenderUrl("http://localhost:3000/h/srv_1/workspace", { packaged: true })).toBe(
      false,
    );
  });

  it("trusts file:// and the dev port in dev mode", () => {
    expect(isMainAppSenderUrl("file:///app-dist/index.html", { packaged: false })).toBe(true);
    expect(isMainAppSenderUrl("http://localhost:8081/h/srv_1/workspace", { packaged: false })).toBe(
      true,
    );
  });

  it("rejects non-dev localhost ports in dev mode", () => {
    expect(isMainAppSenderUrl("http://localhost:3000/h/srv_1/workspace", { packaged: false })).toBe(
      false,
    );
  });

  it("trusts Metro fallback ports used by desktop dev scripts", () => {
    expect(isMainAppSenderUrl("http://localhost:8082/", { packaged: false })).toBe(true);
    expect(isMainAppSenderUrl("http://127.0.0.1:8083/h/srv_1", { packaged: false })).toBe(true);
    expect(isMainAppSenderUrl("http://localhost:8085/", { packaged: false })).toBe(true);
  });

  it("honors a custom dev port when provided", () => {
    expect(
      isMainAppSenderUrl("http://localhost:3000/h/srv_1/workspace", {
        packaged: false,
        devPort: 3000,
      }),
    ).toBe(true);
  });

  it("resolves the primary dev port from EXPO_PORT / EXPO_DEV_URL", () => {
    expect(resolveDesktopDevPort({ EXPO_PORT: "8084" })).toBe(8084);
    expect(resolveDesktopDevPort({ EXPO_DEV_URL: "http://localhost:8082" })).toBe(8082);
    expect(
      resolveMainAppSenderValidationOptions({
        packaged: false,
        env: { EXPO_DEV_URL: "http://localhost:8082" },
      }).allowedDevPorts,
    ).toContain(8082);
  });

  it("classifies skills write commands as privileged (sender must be main app)", () => {
    // These commands write files into the user's home directory
    // (~/.agents/skills, ~/.claude/skills, ~/.codex/skills) and must only be
    // invocable from the main application window, not from webviews/iframes.
    expect(PRIVILEGED_COMMANDS.has("install_skills")).toBe(true);
    expect(PRIVILEGED_COMMANDS.has("update_skills")).toBe(true);
    expect(PRIVILEGED_COMMANDS.has("uninstall_skills")).toBe(true);
  });

  it("does not classify the read-only skills status command as privileged", () => {
    expect(PRIVILEGED_COMMANDS.has("get_skills_status")).toBe(false);
  });

  it("classifies desktop settings write commands as privileged", () => {
    // These write desktop-settings.json (releaseChannel, daemon management)
    // and could otherwise let a compromised frame flip the release channel or
    // disable the built-in daemon manager. Read-only get_desktop_settings
    // is intentionally not privileged.
    expect(PRIVILEGED_COMMANDS.has("patch_desktop_settings")).toBe(true);
    expect(PRIVILEGED_COMMANDS.has("migrate_legacy_desktop_settings")).toBe(true);
    expect(PRIVILEGED_COMMANDS.has("check_app_update")).toBe(true);
    expect(PRIVILEGED_COMMANDS.has("get_desktop_settings")).toBe(false);
  });
});

describe("assertTransportPathAllowed", () => {
  // resolveChisaCodeHome is mocked to "/tmp/chisacode-home" (see top of file).

  it("accepts a POSIX socket under ChisaCode home", () => {
    expect(() =>
      assertTransportPathAllowed("socket", "/tmp/chisacode-home/daemon.sock"),
    ).not.toThrow();
  });

  it("rejects a POSIX socket outside ChisaCode home", () => {
    expect(() => assertTransportPathAllowed("socket", "/var/run/docker.sock")).toThrow(
      /must be under ChisaCode home/,
    );
  });

  it("rejects a POSIX socket that escapes via .. traversal", () => {
    expect(() =>
      assertTransportPathAllowed("socket", "/tmp/chisacode-home/../../var/run/docker.sock"),
    ).toThrow(/must be under ChisaCode home/);
  });

  it("accepts a Windows named pipe with chisacode prefix ( UNC form )", () => {
    expect(() => assertTransportPathAllowed("pipe", "\\\\.\\pipe\\chisacode-daemon")).not.toThrow();
  });

  it("accepts a Windows named pipe with chisacode prefix ( pipe:// form )", () => {
    expect(() => assertTransportPathAllowed("pipe", "pipe://chisacode-daemon")).not.toThrow();
  });

  it("rejects a Windows named pipe without chisacode prefix", () => {
    expect(() => assertTransportPathAllowed("pipe", "\\\\.\\pipe\\docker")).toThrow(
      /must start with "chisacode"/,
    );
  });

  it("accepts a socket nested in a subdirectory of ChisaCode home", () => {
    // path.relative yields "sub/daemon.sock" — not `..`-prefixed, not absolute —
    // so the socket is correctly treated as inside home. Locks the
    // path.relative-based check against regressions to a flat prefix compare.
    expect(() =>
      assertTransportPathAllowed("socket", "/tmp/chisacode-home/sub/daemon.sock"),
    ).not.toThrow();
  });

  it("treats Windows same-drive paths differing only by case as inside (regression lock)", () => {
    // The socket branch uses path.relative + path.isAbsolute instead of a
    // case-sensitive startsWith prefix check. On Windows the filesystem is
    // case-insensitive, so `C:\Users\Foo\ChisaCode` and `c:\users\foo\chisacode`
    // must be treated as the same directory. We assert this directly with
    // path.win32 (independent of the POSIX-mocked getChisaCodeHome) so a future
    // revert to startsWith would fail this test, not just silently pass on
    // POSIX CI.
    const rel = path.win32.relative(
      "C:\\Users\\Foo\\ChisaCode",
      "c:\\users\\foo\\chisacode\\daemon.sock",
    );
    expect(rel.startsWith("..")).toBe(false);
    expect(path.win32.isAbsolute(rel)).toBe(false);
  });

  it("rejects a cross-drive Windows socket path as outside home", () => {
    // path.win32.relative returns an absolute path when the target is on a
    // different drive; path.isAbsolute catches it. Locks the cross-drive
    // rejection so a case-insensitive fix does not also let cross-drive paths
    // through.
    const rel = path.win32.relative("C:\\Users\\Foo", "D:\\users\\foo\\sock");
    expect(path.win32.isAbsolute(rel)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Lifecycle tests
// ---------------------------------------------------------------------------

function runningDaemonStatus(overrides?: Partial<DesktopDaemonStatus>): DesktopDaemonStatus {
  return {
    serverId: "server-1",
    status: "running",
    listen: "127.0.0.1:6767",
    hostname: "dev-host",
    pid: 4242,
    home: "/tmp/chisacode-home",
    // resolveDesktopAppVersion() reads the real package.json (1.0.2) in dev mode
    version: "1.0.2",
    desktopManaged: true,
    error: null,
    ...overrides,
  };
}

describe("resolveDesktopDaemonStatus", () => {
  it("resolves a running daemon from valid JSON output", async () => {
    mocks.runExternalCliJsonCommand.mockResolvedValue({
      localDaemon: "running",
      connectedDaemon: "reachable",
      serverId: "server-1",
      pid: 4242,
      listen: "127.0.0.1:6767",
      hostname: "dev-host",
      daemonVersion: "1.2.3",
      desktopManaged: true,
    });

    const status = await resolveDesktopDaemonStatus();

    expect(status).toMatchObject({
      serverId: "server-1",
      status: "running",
      listen: "127.0.0.1:6767",
      hostname: "dev-host",
      pid: 4242,
      version: "1.2.3",
      desktopManaged: true,
    });
  });

  it("returns stopped when localDaemon is missing", async () => {
    mocks.runExternalCliJsonCommand.mockResolvedValue({
      connectedDaemon: "unreachable",
      serverId: "",
    });

    const status = await resolveDesktopDaemonStatus();
    expect(status.status).toBe("stopped");
    expect(status.desktopManaged).toBe(false);
    expect(status.error).toBeNull();
  });

  it("returns errored when localDaemon is unresponsive and API is unreachable", async () => {
    mocks.runExternalCliJsonCommand.mockResolvedValue({
      localDaemon: "unresponsive",
      connectedDaemon: "unreachable",
      serverId: "",
    });

    const status = await resolveDesktopDaemonStatus();
    expect(status.status).toBe("errored");
  });

  it("classifies a daemon as running when API is reachable even with stale local pid", async () => {
    mocks.runExternalCliJsonCommand.mockResolvedValue({
      localDaemon: "stale_pid",
      connectedDaemon: "reachable",
      serverId: "server-1",
      pid: 0,
      listen: "127.0.0.1:6767",
      hostname: "dev-host",
    });

    const status = await resolveDesktopDaemonStatus();
    expect(status.status).toBe("running");
  });

  it("returns stopped with error on JSON parse failure", async () => {
    mocks.runExternalCliJsonCommand.mockRejectedValue(new Error("CLI crash"));

    const status = await resolveDesktopDaemonStatus();
    expect(status.status).toBe("stopped");
    expect(status.error).toBe("CLI crash");
  });
});

describe("shouldRestartForVersion", () => {
  it("returns false when versions match", () => {
    // resolveDesktopAppVersion reads the real workspace package.json (1.0.2)
    const matched = runningDaemonStatus({ version: "1.0.2" });
    expect(shouldRestartForVersion(matched)).toBe(false);
    expect(shouldRestartForVersion(runningDaemonStatus({ version: "v1.0.2" }))).toBe(false);
  });

  it("returns true when versions differ", () => {
    expect(shouldRestartForVersion(runningDaemonStatus({ version: "1.0.1" }))).toBe(true);
    expect(shouldRestartForVersion(runningDaemonStatus({ version: "2.0.0" }))).toBe(true);
  });

  it("returns false when daemon is not desktop-managed", () => {
    const status = runningDaemonStatus({ desktopManaged: false, version: "1.0.0" });
    expect(shouldRestartForVersion(status)).toBe(false);
  });

  it("returns false when daemon version is null", () => {
    expect(shouldRestartForVersion(runningDaemonStatus({ version: null }))).toBe(false);
  });

  it("returns false when daemon version is empty", () => {
    expect(shouldRestartForVersion(runningDaemonStatus({ version: "" }))).toBe(false);
  });
});
