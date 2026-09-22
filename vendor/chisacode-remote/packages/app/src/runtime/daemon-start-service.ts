import {
  restartDesktopDaemon,
  startDesktopDaemon,
  type DesktopDaemonStatus,
} from "@/desktop/daemon/desktop-daemon";
import { connectionFromListen } from "@/types/host-connection";
import type { HostRuntimeStore } from "@/runtime/host-runtime";

export type DaemonStartResult = { ok: true } | { ok: false; error: string };

/**
 * Store surface required by the daemon start service. Beyond upserting the
 * connection, the service subscribes to connection-status changes so it can
 * detect when a successfully started daemon reaches "online" or stalls in
 * "connecting" and report a timeout error.
 */
export interface DaemonStartServiceStore
  extends
    Pick<HostRuntimeStore, "upsertConnectionFromListen">,
    Pick<HostRuntimeStore, "subscribeAll">,
    Pick<HostRuntimeStore, "getSnapshot"> {}

export interface DaemonStartServiceDeps {
  store: DaemonStartServiceStore;
  startDesktopDaemon?: () => Promise<DesktopDaemonStatus>;
  restartDesktopDaemon?: () => Promise<DesktopDaemonStatus>;
  /** Milliseconds to wait for the connection to reach "online" after a successful start. */
  connectingTimeoutMs?: number;
}

/** Error message shown when the daemon process starts but the client never connects. */
const CONNECTING_TIMEOUT_MESSAGE =
  "Desktop daemon started but the connection was not established. Please retry.";

const DEFAULT_CONNECTING_TIMEOUT_MS = 20_000;

export class DaemonStartService {
  private readonly store: DaemonStartServiceStore;
  private readonly invokeStartDesktopDaemon: () => Promise<DesktopDaemonStatus>;
  private readonly invokeRestartDesktopDaemon: () => Promise<DesktopDaemonStatus>;
  private readonly connectingTimeoutMs: number;
  private readonly listeners = new Set<() => void>();
  private lastError: string | null = null;
  private inFlightCount = 0;
  private hasEverSucceeded = false;

  // Connecting watch: after a successful start, observe the store to detect
  // whether the client reaches "online" within the timeout window. If it does
  // not, surface a timeout error so the splash can show a retryable error
  // instead of staying on a pure-logo splash forever.
  private connectingTimer: ReturnType<typeof setTimeout> | null = null;
  private connectingUnsubscribe: (() => void) | null = null;
  private connectingWatchServerId: string | null = null;

  constructor(deps: DaemonStartServiceDeps) {
    this.store = deps.store;
    this.invokeStartDesktopDaemon = deps.startDesktopDaemon ?? startDesktopDaemon;
    this.invokeRestartDesktopDaemon = deps.restartDesktopDaemon ?? restartDesktopDaemon;
    this.connectingTimeoutMs = deps.connectingTimeoutMs ?? DEFAULT_CONNECTING_TIMEOUT_MS;
  }

  async start(): Promise<DaemonStartResult> {
    this.beginRequest();
    try {
      const daemon = await this.invokeStartDesktopDaemon();
      const listenAddress = daemon.listen?.trim() ?? "";
      const serverId = daemon.serverId.trim();
      if (!listenAddress) {
        return this.fail("Desktop daemon did not return a listen address.");
      }
      if (!serverId) {
        return this.fail("Desktop daemon did not return a server id.");
      }
      if (!connectionFromListen(listenAddress)) {
        return this.fail(`Desktop daemon returned an unsupported listen address: ${listenAddress}`);
      }
      const profile = await this.store.upsertConnectionFromListen({
        listenAddress,
        serverId,
        hostname: daemon.hostname,
      });
      this.hasEverSucceeded = true;
      this.clearConnectingWatch();
      this.startConnectingWatch(profile.serverId);
      return { ok: true };
    } catch (error) {
      return this.fail(error instanceof Error ? error.message : String(error));
    } finally {
      this.endRequest();
    }
  }

  /**
   * Restarts the desktop daemon (stop + spawn) rather than no-op starting when
   * the daemon process is already running but the client connection is stuck.
   * Use this for retry when {@link hasEverSucceeded} is true but no host is online.
   * @returns The start result after restart
   */
  async restart(): Promise<DaemonStartResult> {
    this.beginRequest();
    try {
      const daemon = await this.invokeRestartDesktopDaemon();
      const listenAddress = daemon.listen?.trim() ?? "";
      const serverId = daemon.serverId.trim();
      if (!listenAddress) {
        return this.fail("Desktop daemon did not return a listen address.");
      }
      if (!serverId) {
        return this.fail("Desktop daemon did not return a server id.");
      }
      if (!connectionFromListen(listenAddress)) {
        return this.fail(`Desktop daemon returned an unsupported listen address: ${listenAddress}`);
      }
      const profile = await this.store.upsertConnectionFromListen({
        listenAddress,
        serverId,
        hostname: daemon.hostname,
      });
      this.hasEverSucceeded = true;
      this.clearConnectingWatch();
      this.startConnectingWatch(profile.serverId);
      return { ok: true };
    } catch (error) {
      return this.fail(error instanceof Error ? error.message : String(error));
    } finally {
      this.endRequest();
    }
  }

  getLastError(): string | null {
    return this.lastError;
  }

  recordError(message: string): void {
    this.setLastError(message);
  }

  isRunning(): boolean {
    return this.inFlightCount > 0;
  }

  /**
   * Whether the daemon start has ever succeeded in this session. Used by the
   * retry logic to decide whether to restart (daemon likely running but
   * connection stuck) or start fresh (daemon not running).
   * @returns true if at least one start/restart completed successfully
   */
  hasEverSucceededCheck(): boolean {
    return this.hasEverSucceeded;
  }

  /**
   * Whether the service has settled with an error (start/restart failed or the
   * connecting watch timed out). Used by the bootstrap to unlatch storeReady
   * so the settings route becomes reachable without redirecting to welcome.
   * @returns true if the last settled state is an error
   */
  hasSettledWithError(): boolean {
    return this.lastError !== null;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private fail(message: string): DaemonStartResult {
    this.setLastError(message);
    return { ok: false, error: message };
  }

  private setLastError(value: string | null): void {
    if (this.lastError === value) {
      return;
    }
    this.lastError = value;
    this.notify();
  }

  private beginRequest(): void {
    const becameRunning = this.inFlightCount === 0;
    this.inFlightCount += 1;
    const errorChanged = this.lastError !== null;
    this.lastError = null;
    if (becameRunning || errorChanged) {
      this.notify();
    }
  }

  private endRequest(): void {
    this.inFlightCount = Math.max(0, this.inFlightCount - 1);
    if (this.inFlightCount === 0) {
      this.notify();
    }
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }

  /**
   * After a successful start, watch the store for the upserted host to reach
   * "online" within the timeout window. If it does not, surface a timeout
   * error so the splash shows a retryable error instead of a pure logo.
   */
  private startConnectingWatch(serverId: string): void {
    this.connectingWatchServerId = serverId;

    this.connectingUnsubscribe = this.store.subscribeAll(() => {
      const snapshot = this.store.getSnapshot(serverId);
      if (snapshot?.connectionStatus === "online") {
        this.clearConnectingWatch();
      }
    });

    this.connectingTimer = setTimeout(() => {
      const snapshot = this.store.getSnapshot(serverId);
      if (!snapshot || snapshot.connectionStatus !== "online") {
        this.setLastError(CONNECTING_TIMEOUT_MESSAGE);
      }
      this.clearConnectingWatch();
    }, this.connectingTimeoutMs);
  }

  private clearConnectingWatch(): void {
    if (this.connectingTimer) {
      clearTimeout(this.connectingTimer);
      this.connectingTimer = null;
    }
    if (this.connectingUnsubscribe) {
      this.connectingUnsubscribe();
      this.connectingUnsubscribe = null;
    }
    this.connectingWatchServerId = null;
  }
}

let singletonDaemonStartService: DaemonStartService | null = null;
const DAEMON_START_SERVICE_GLOBAL_KEY = "__chisacodeDaemonStartService";

type DaemonStartServiceGlobal = typeof globalThis & {
  [DAEMON_START_SERVICE_GLOBAL_KEY]?: DaemonStartService;
};

export function getDaemonStartService(deps: DaemonStartServiceDeps): DaemonStartService {
  if (singletonDaemonStartService) {
    return singletonDaemonStartService;
  }

  const runtimeGlobal = globalThis as DaemonStartServiceGlobal;
  if (runtimeGlobal[DAEMON_START_SERVICE_GLOBAL_KEY]) {
    singletonDaemonStartService = runtimeGlobal[DAEMON_START_SERVICE_GLOBAL_KEY] ?? null;
    if (singletonDaemonStartService) {
      return singletonDaemonStartService;
    }
  }

  singletonDaemonStartService = new DaemonStartService(deps);
  runtimeGlobal[DAEMON_START_SERVICE_GLOBAL_KEY] = singletonDaemonStartService;
  return singletonDaemonStartService;
}
