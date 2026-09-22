import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import { shouldUseDesktopDaemon } from "@/desktop/daemon/desktop-daemon";
import { useLatchedBoolean } from "@/hooks/use-latched-boolean";
import { getHostRuntimeStore, hasConfiguredLocalDaemonOverride } from "@/runtime/host-runtime";
import { getDaemonStartService } from "@/runtime/daemon-start-service";
import {
  shouldArmStartupGiveUpToWelcome,
  startDaemonIfGateAllows,
  startHostRuntimeBootstrap,
} from "@/utils/host-runtime-bootstrap";

export interface HostRuntimeBootstrapState {
  splashError: string | null;
  retry: () => void;
  hasGivenUpWaitingForHost: boolean;
  storeReady: boolean;
}

const HostRuntimeBootstrapContext = createContext<HostRuntimeBootstrapState>({
  splashError: null,
  retry: () => {},
  hasGivenUpWaitingForHost: false,
  storeReady: false,
});

export function useEarliestOnlineHostServerId(): string | null {
  const store = getHostRuntimeStore();
  const subscribe = useCallback(
    (listener: () => void) => {
      const unsubscribeAll = store.subscribeAll(listener);
      const unsubscribeHostList = store.subscribeHostList(listener);
      return () => {
        unsubscribeAll();
        unsubscribeHostList();
      };
    },
    [store],
  );
  return useSyncExternalStore(
    subscribe,
    () => store.getEarliestOnlineHostServerId(),
    () => store.getEarliestOnlineHostServerId(),
  );
}

function useDaemonStartLastError(): string | null {
  const service = getDaemonStartService({ store: getHostRuntimeStore() });
  return useSyncExternalStore(
    (listener) => service.subscribe(listener),
    () => service.getLastError(),
    () => service.getLastError(),
  );
}

const STARTUP_GIVE_UP_TIMEOUT_MS = 5_000;

/**
 * Desktop is hard-bound to its built-in daemon: always start it on boot
 * regardless of the manageBuiltInDaemon setting. The setting only controls
 * whether the desktop may manually stop/restart the daemon during a session.
 */
async function shouldStartBuiltInDaemon(): Promise<boolean> {
  return shouldUseDesktopDaemon();
}

function useDaemonStartSettledError(): boolean {
  const service = getDaemonStartService({ store: getHostRuntimeStore() });
  return useSyncExternalStore(
    (listener) => service.subscribe(listener),
    () => service.hasSettledWithError(),
    () => service.hasSettledWithError(),
  );
}

function HostRuntimeBootstrapProvider({ children }: { children: ReactNode }) {
  const isDesktop = shouldUseDesktopDaemon();

  useEffect(() => {
    const store = getHostRuntimeStore();
    const daemonStartService = getDaemonStartService({ store });
    startHostRuntimeBootstrap({
      store,
      daemonStartService,
      shouldStartDaemon: shouldStartBuiltInDaemon,
      onGateError: (message) => daemonStartService.recordError(message),
    });
  }, []);

  const anyOnlineHostServerId = useEarliestOnlineHostServerId();
  const daemonStartError = useDaemonStartLastError();
  const daemonStartSettledError = useDaemonStartSettledError();
  const waitForConfiguredLocalDaemon =
    hasConfiguredLocalDaemonOverride() && !shouldUseDesktopDaemon();

  const [hasGivenUpWaitingForHost, setHasGivenUpWaitingForHost] = useState(false);
  // Arm the give-up timer once on mount. Do not reset it when daemon-start
  // flapping or host probes re-render this provider — resetting was a common
  // way to keep the pure-logo splash on screen forever. Online host / error
  // still unlatch storeReady immediately via isCurrentlyStoreReady below.
  //
  // Desktop is hard-bound to its built-in daemon and must never redirect to the
  // welcome route due to a timeout — it stays on the retryable splash instead.
  useEffect(() => {
    if (
      !shouldArmStartupGiveUpToWelcome({
        isDesktop,
        waitForConfiguredLocalDaemon,
      })
    ) {
      return;
    }
    const handle = setTimeout(() => {
      setHasGivenUpWaitingForHost(true);
    }, STARTUP_GIVE_UP_TIMEOUT_MS);
    return () => {
      clearTimeout(handle);
    };
  }, [waitForConfiguredLocalDaemon, isDesktop]);

  const retry = useCallback(() => {
    const daemonStartService = getDaemonStartService({ store: getHostRuntimeStore() });
    // If a prior start succeeded (daemon likely running) but no host is online,
    // the connection is stuck — restart the daemon instead of no-op starting.
    if (daemonStartService.hasEverSucceededCheck() && !anyOnlineHostServerId) {
      void daemonStartService.restart();
      return;
    }
    startDaemonIfGateAllows({
      daemonStartService,
      shouldStartDaemon: shouldStartBuiltInDaemon,
      onGateError: (message) => daemonStartService.recordError(message),
    });
  }, [anyOnlineHostServerId]);

  const splashError = !anyOnlineHostServerId ? daemonStartError : null;
  // Desktop unlatches storeReady when the daemon start has settled with an
  // error (start failed or connecting timed out) so the settings route becomes
  // reachable — without redirecting to the welcome route.
  const isCurrentlyStoreReady =
    Boolean(anyOnlineHostServerId) ||
    Boolean(splashError) ||
    Boolean(daemonStartSettledError) ||
    hasGivenUpWaitingForHost;
  const storeReady = useLatchedBoolean(isCurrentlyStoreReady);

  const state = useMemo<HostRuntimeBootstrapState>(
    () => ({ splashError, retry, hasGivenUpWaitingForHost, storeReady }),
    [splashError, retry, hasGivenUpWaitingForHost, storeReady],
  );

  return (
    <HostRuntimeBootstrapContext.Provider value={state}>
      {children}
    </HostRuntimeBootstrapContext.Provider>
  );
}

export { HostRuntimeBootstrapProvider };

export function useStoreReady(): boolean {
  return useContext(HostRuntimeBootstrapContext).storeReady;
}

export function useHostRuntimeBootstrapState(): HostRuntimeBootstrapState {
  return useContext(HostRuntimeBootstrapContext);
}
