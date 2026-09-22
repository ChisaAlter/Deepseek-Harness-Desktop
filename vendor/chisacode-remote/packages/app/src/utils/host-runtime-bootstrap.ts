import type { ActiveWorkspaceSelection } from "@/stores/navigation-active-workspace-store";
import type { DaemonStartResult } from "@/runtime/daemon-start-service";
import type { Href } from "expo-router";
import { buildHostNewWorkspaceRoute, mapPathnameToServer } from "@/utils/host-routes";

/** Minimal store surface required to boot the host runtime. */
export interface HostRuntimeBootstrapStore {
  boot: () => void;
}

/** Minimal daemon start service surface required by the host runtime bootstrap. */
export interface HostRuntimeBootstrapDaemonStartService {
  start: () => Promise<DaemonStartResult>;
}

type HostRuntimeBootstrapStartGate = boolean | (() => boolean | Promise<boolean>);

/** Inputs required to boot the host runtime and conditionally start the desktop daemon. */
export interface StartHostRuntimeBootstrapInput {
  store: HostRuntimeBootstrapStore;
  daemonStartService: HostRuntimeBootstrapDaemonStartService;
  shouldStartDaemon: HostRuntimeBootstrapStartGate;
  onGateError?: (message: string) => void;
}

/**
 * Boots the host runtime store and starts the desktop daemon when the gate allows it.
 * @param input The store, daemon start service, start gate, and optional gate error handler
 */
export function startHostRuntimeBootstrap(input: StartHostRuntimeBootstrapInput): void {
  input.store.boot();
  startDaemonIfGateAllows({
    daemonStartService: input.daemonStartService,
    shouldStartDaemon: input.shouldStartDaemon,
    onGateError: input.onGateError,
  });
}

/**
 * Starts the desktop daemon when the gate resolves to true, reporting gate evaluation errors.
 * @param input The daemon start service, start gate, and optional gate error handler
 */
export function startDaemonIfGateAllows(input: {
  daemonStartService: HostRuntimeBootstrapDaemonStartService;
  shouldStartDaemon: HostRuntimeBootstrapStartGate;
  onGateError?: (message: string) => void;
}): void {
  const gate = input.shouldStartDaemon;
  if (typeof gate === "boolean") {
    if (gate) {
      void input.daemonStartService.start();
    }
    return;
  }

  void Promise.resolve()
    .then(() => gate())
    .then((shouldStartDaemon) => {
      if (shouldStartDaemon) {
        void input.daemonStartService.start();
      }
      return null;
    })
    .catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      input.onGateError?.(`Failed to evaluate desktop daemon settings: ${message}`);
    });
}

/** Route shown when no host is available to redirect to at startup. */
export const WELCOME_ROUTE: Href = "/welcome";

/** Inputs describing startup navigation state used to decide the initial redirect. */
export interface ResolveStartupRedirectInput {
  pathname: string;
  anyOnlineHostServerId: string | null;
  workspaceSelection: ActiveWorkspaceSelection | null;
  isWorkspaceSelectionLoaded: boolean;
  isWorkspaceSelectionValidationPending?: boolean;
  workspaceSelectionExists?: boolean;
  hasGivenUpWaitingForHost: boolean;
  /**
   * Whether the app is running as the desktop Electron build. When true the
   * startup redirect never falls back to the welcome route — the desktop is
   * hard-bound to its built-in daemon and stays on the startup splash until
   * an online host appears or the user retries. Defaults to false (non-desktop)
   * so existing callers and tests keep the legacy welcome-fallback behavior.
   */
  isDesktop?: boolean;
}

/** Inputs describing the active host and known hosts used to decide a fallback redirect. */
export interface ResolveActiveHostRedirectInput {
  pathname: string;
  activeServerId: string | null;
  hostServerIds: readonly string[];
}

function isIndexPathname(pathname: string) {
  return pathname === "/" || pathname === "";
}

/**
 * Resolves the persisted workspace selection that startup should restore, if it is ready to use.
 * @param input The startup navigation state
 * @returns The workspace selection to restore, or null when startup should not restore one
 */
export function resolveStartupWorkspaceSelection(
  input: ResolveStartupRedirectInput,
): ActiveWorkspaceSelection | null {
  if (!isIndexPathname(input.pathname)) {
    return null;
  }
  if (!input.isWorkspaceSelectionLoaded) {
    return null;
  }
  if (!input.workspaceSelection) {
    return null;
  }
  if (input.isWorkspaceSelectionValidationPending === true) {
    return null;
  }
  if (input.workspaceSelectionExists === false) {
    return null;
  }
  return input.workspaceSelection;
}

/**
 * Decides which route the index page should redirect to at startup.
 * @param input The startup navigation state
 * @returns The route to redirect to, or null when no redirect should happen yet
 */
export function resolveStartupRedirectRoute(input: ResolveStartupRedirectInput): Href | null {
  if (!isIndexPathname(input.pathname)) {
    return null;
  }

  // Soft Home startup (index) always passes workspaceSelection: null and no
  // longer restores a workspace tab. Only block on AsyncStorage hydration when
  // a selection may actually be restored — otherwise a hung/slow hydrate leaves
  // the splash logo frozen forever (even after the give-up timer fires).
  const mayRestoreWorkspaceSelection = input.workspaceSelection !== null;
  if (mayRestoreWorkspaceSelection && !input.isWorkspaceSelectionLoaded) {
    return null;
  }

  if (input.anyOnlineHostServerId) {
    if (input.isWorkspaceSelectionLoaded && resolveStartupWorkspaceSelection(input)) {
      return null;
    }
    if (input.isWorkspaceSelectionLoaded && input.isWorkspaceSelectionValidationPending === true) {
      return null;
    }
    // Soft Home: land on /new directly (same surface as 新对话), not host root then Redirect.
    return buildHostNewWorkspaceRoute(input.anyOnlineHostServerId);
  }

  // Desktop is hard-bound to its built-in daemon: never redirect to the
  // welcome route at startup, even after the give-up timer fires. The splash
  // screen stays visible with retry/error until an online host appears.
  const isDesktop = input.isDesktop === true;
  if (!isDesktop && input.hasGivenUpWaitingForHost) {
    return WELCOME_ROUTE;
  }

  return null;
}

/**
 * Decides whether the startup give-up timer (that redirects to the welcome
 * route when no host comes online) should be armed at all.
 *
 * Desktop is hard-bound to its built-in daemon and must never fall through to
 * the welcome route due to a timeout — it stays on the retryable splash until
 * an online host appears or the user intervenes. Non-desktop keeps the legacy
 * give-up behavior, unless a configured local daemon override is being waited
 * on (existing special case).
 * @param input Whether the app is desktop and whether a configured override is being awaited
 * @returns true when the give-up timer should be armed, false to suppress it
 */
export function shouldArmStartupGiveUpToWelcome(input: {
  isDesktop: boolean;
  waitForConfiguredLocalDaemon: boolean;
}): boolean {
  if (input.waitForConfiguredLocalDaemon) {
    return false;
  }
  return !input.isDesktop;
}

/**
 * Decides a fallback route when the active host is no longer among the known hosts.
 * @param input The active server id, known host server ids, and current pathname
 * @returns The equivalent route on a fallback host, the welcome route, or null when no redirect is needed
 */
export function resolveActiveHostRedirectRoute(input: ResolveActiveHostRedirectInput): Href | null {
  if (!input.activeServerId) {
    return null;
  }
  if (input.hostServerIds.includes(input.activeServerId)) {
    return null;
  }

  const fallbackServerId = input.hostServerIds[0] ?? null;
  if (fallbackServerId) {
    return mapPathnameToServer(input.pathname, fallbackServerId);
  }
  return WELCOME_ROUTE;
}
