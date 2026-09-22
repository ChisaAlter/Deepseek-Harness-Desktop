import { describe, expect, it, vi } from "vitest";
import {
  resolveActiveHostRedirectRoute,
  resolveStartupRedirectRoute,
  resolveStartupWorkspaceSelection,
  shouldArmStartupGiveUpToWelcome,
  startHostRuntimeBootstrap,
  WELCOME_ROUTE,
} from "./host-runtime-bootstrap";

function createFakeStore() {
  return { boot: vi.fn() };
}

function createFakeDaemonStartService() {
  return {
    start: vi.fn(async () => ({ ok: true as const })),
  };
}

describe("startHostRuntimeBootstrap", () => {
  it("fires boot and daemon-start without awaiting the daemon-start promise", () => {
    const events: string[] = [];
    const store = {
      boot: vi.fn(() => {
        events.push("boot");
      }),
    };
    const daemonStartService = {
      start: vi.fn(async () => {
        events.push("daemon-start");
        return { ok: true as const };
      }),
    };

    startHostRuntimeBootstrap({
      store,
      daemonStartService,
      shouldStartDaemon: true,
    });

    expect(store.boot).toHaveBeenCalledTimes(1);
    expect(daemonStartService.start).toHaveBeenCalledTimes(1);
    expect(events).toEqual(["boot", "daemon-start"]);
  });

  it("skips daemon-start when shouldStartDaemon is false", () => {
    const store = createFakeStore();
    const daemonStartService = createFakeDaemonStartService();

    startHostRuntimeBootstrap({
      store,
      daemonStartService,
      shouldStartDaemon: false,
    });

    expect(store.boot).toHaveBeenCalledTimes(1);
    expect(daemonStartService.start).not.toHaveBeenCalled();
  });

  it("skips daemon-start when the startup gate resolves false", async () => {
    const store = createFakeStore();
    const daemonStartService = createFakeDaemonStartService();

    startHostRuntimeBootstrap({
      store,
      daemonStartService,
      shouldStartDaemon: async () => false,
    });
    await Promise.resolve();

    expect(store.boot).toHaveBeenCalledTimes(1);
    expect(daemonStartService.start).not.toHaveBeenCalled();
  });

  it("surfaces gate rejection to onGateError without starting the daemon", async () => {
    const store = createFakeStore();
    const daemonStartService = createFakeDaemonStartService();
    const onGateError = vi.fn();

    startHostRuntimeBootstrap({
      store,
      daemonStartService,
      shouldStartDaemon: async () => {
        throw new Error("settings file unreadable");
      },
      onGateError,
    });
    await vi.waitFor(() => {
      expect(onGateError).toHaveBeenCalledTimes(1);
    });

    expect(daemonStartService.start).not.toHaveBeenCalled();
    expect(onGateError).toHaveBeenCalledWith(expect.stringContaining("settings file unreadable"));
  });

  it("does not await the daemon-start promise", () => {
    const store = createFakeStore();
    let resolveStart: ((value: { ok: true }) => void) | undefined;
    const daemonStartService = {
      start: vi.fn(
        () =>
          new Promise<{ ok: true }>((resolve) => {
            resolveStart = resolve;
          }),
      ),
    };

    startHostRuntimeBootstrap({
      store,
      daemonStartService,
      shouldStartDaemon: true,
    });

    expect(store.boot).toHaveBeenCalledTimes(1);
    expect(daemonStartService.start).toHaveBeenCalledTimes(1);

    resolveStart?.({ ok: true });
  });
});

describe("resolveStartupRedirectRoute", () => {
  const baseInput = {
    pathname: "/",
    anyOnlineHostServerId: null,
    workspaceSelection: null,
    isWorkspaceSelectionLoaded: true,
    hasGivenUpWaitingForHost: false,
  };

  it("returns null when the pathname is not the index route", () => {
    expect(
      resolveStartupRedirectRoute({
        ...baseInput,
        pathname: "/h/server-1",
        anyOnlineHostServerId: "server-1",
      }),
    ).toBeNull();
  });

  it("does not wait on workspace selection hydration when no selection will be restored", () => {
    // Soft Home startup always passes workspaceSelection: null. Blocking on
    // AsyncStorage hydrate here freezes the splash forever if hydrate hangs.
    expect(
      resolveStartupRedirectRoute({
        ...baseInput,
        anyOnlineHostServerId: "server-1",
        isWorkspaceSelectionLoaded: false,
      }),
    ).toBe("/h/server-1/new");
  });

  it("still waits on hydration only when a workspace selection may be restored", () => {
    expect(
      resolveStartupRedirectRoute({
        ...baseInput,
        anyOnlineHostServerId: "server-1",
        workspaceSelection: { serverId: "server-1", workspaceId: "workspace-a" },
        isWorkspaceSelectionLoaded: false,
      }),
    ).toBeNull();
  });

  it("still redirects to welcome after give-up even when workspace selection is not hydrated", () => {
    expect(
      resolveStartupRedirectRoute({
        ...baseInput,
        isWorkspaceSelectionLoaded: false,
        hasGivenUpWaitingForHost: true,
      }),
    ).toBe(WELCOME_ROUTE);
  });

  it("waits while no host is online and the give-up timer has not fired", () => {
    expect(resolveStartupRedirectRoute(baseInput)).toBeNull();
  });

  describe("scenario: saved-host-online", () => {
    it("leaves matching persisted workspace navigation to the workspace navigator", () => {
      const route = resolveStartupRedirectRoute({
        ...baseInput,
        anyOnlineHostServerId: "server-1",
        workspaceSelection: { serverId: "server-1", workspaceId: "workspace-a" },
      });

      expect(route).toBeNull();
    });

    it("resolves the persisted workspace when the online host matches it", () => {
      const selection = resolveStartupWorkspaceSelection({
        ...baseInput,
        anyOnlineHostServerId: "server-1",
        workspaceSelection: { serverId: "server-1", workspaceId: "workspace-a" },
        workspaceSelectionExists: true,
      });

      expect(selection).toEqual({ serverId: "server-1", workspaceId: "workspace-a" });
    });

    it("waits for workspace validation before restoring a persisted workspace route", () => {
      const route = resolveStartupRedirectRoute({
        ...baseInput,
        anyOnlineHostServerId: "server-1",
        workspaceSelection: { serverId: "server-1", workspaceId: "workspace-a" },
        isWorkspaceSelectionValidationPending: true,
      });
      const selection = resolveStartupWorkspaceSelection({
        ...baseInput,
        anyOnlineHostServerId: "server-1",
        workspaceSelection: { serverId: "server-1", workspaceId: "workspace-a" },
        isWorkspaceSelectionValidationPending: true,
      });

      expect(route).toBeNull();
      expect(selection).toBeNull();
    });

    it("ignores a persisted workspace route once hydration proves it is missing", () => {
      const route = resolveStartupRedirectRoute({
        ...baseInput,
        anyOnlineHostServerId: "server-1",
        workspaceSelection: { serverId: "server-1", workspaceId: "DESKTOP-TFK2NTA" },
        workspaceSelectionExists: false,
      });
      const selection = resolveStartupWorkspaceSelection({
        ...baseInput,
        anyOnlineHostServerId: "server-1",
        workspaceSelection: { serverId: "server-1", workspaceId: "DESKTOP-TFK2NTA" },
        workspaceSelectionExists: false,
      });

      expect(route).toBe("/h/server-1/new");
      expect(selection).toBeNull();
    });

    it("leaves persisted workspace navigation to the workspace navigator when another host is first online", () => {
      const route = resolveStartupRedirectRoute({
        ...baseInput,
        anyOnlineHostServerId: "server-2",
        workspaceSelection: { serverId: "server-1", workspaceId: "workspace-a" },
      });

      expect(route).toBeNull();
    });

    it("resolves the persisted workspace when another host is first online", () => {
      const selection = resolveStartupWorkspaceSelection({
        ...baseInput,
        anyOnlineHostServerId: "server-2",
        workspaceSelection: { serverId: "server-1", workspaceId: "workspace-a" },
      });

      expect(selection).toEqual({ serverId: "server-1", workspaceId: "workspace-a" });
    });

    it("redirects to Soft Home (/new) when no persisted workspace exists", () => {
      const route = resolveStartupRedirectRoute({
        ...baseInput,
        anyOnlineHostServerId: "server-2",
      });

      expect(route).toBe("/h/server-2/new");
    });
  });

  describe("scenario: daemon-start-success-only (host comes online via daemon-start upsert)", () => {
    it("redirects to Soft Home (/new) for the host that came online", () => {
      const route = resolveStartupRedirectRoute({
        ...baseInput,
        anyOnlineHostServerId: "srv_desktop",
      });

      expect(route).toBe("/h/srv_desktop/new");
    });
  });

  describe("scenario: both-succeed", () => {
    it("leaves matching persisted workspace navigation to the workspace navigator", () => {
      const route = resolveStartupRedirectRoute({
        ...baseInput,
        anyOnlineHostServerId: "server-saved",
        workspaceSelection: { serverId: "server-saved", workspaceId: "workspace-a" },
      });

      expect(route).toBeNull();
    });
  });

  describe("scenario: both-fail (no host comes online, give-up timer fires)", () => {
    it("redirects to the welcome route", () => {
      const route = resolveStartupRedirectRoute({
        ...baseInput,
        hasGivenUpWaitingForHost: true,
      });

      expect(route).toBe(WELCOME_ROUTE);
    });

    it("still redirects to Soft Home (/new) when one host comes online before the timer expires", () => {
      const route = resolveStartupRedirectRoute({
        ...baseInput,
        anyOnlineHostServerId: "server-saved",
        hasGivenUpWaitingForHost: true,
      });

      expect(route).toBe("/h/server-saved/new");
    });
  });

  describe("scenario: desktop hard-bound (isDesktop: true)", () => {
    it("never redirects to welcome even when give-up fires and no host is online", () => {
      expect(
        resolveStartupRedirectRoute({
          ...baseInput,
          isDesktop: true,
          hasGivenUpWaitingForHost: true,
        }),
      ).toBeNull();
    });

    it("redirects to Soft Home when an online host appears", () => {
      const route = resolveStartupRedirectRoute({
        ...baseInput,
        isDesktop: true,
        anyOnlineHostServerId: "srv_desktop",
      });

      expect(route).toBe("/h/srv_desktop/new");
    });

    it("returns null while waiting (no give-up, no online host)", () => {
      expect(
        resolveStartupRedirectRoute({
          ...baseInput,
          isDesktop: true,
        }),
      ).toBeNull();
    });

    it("online host wins over give-up on desktop", () => {
      const route = resolveStartupRedirectRoute({
        ...baseInput,
        isDesktop: true,
        anyOnlineHostServerId: "srv_desktop",
        hasGivenUpWaitingForHost: true,
      });

      expect(route).toBe("/h/srv_desktop/new");
    });
  });
});

describe("shouldArmStartupGiveUpToWelcome", () => {
  it("returns false for desktop (hard-bound, no welcome fallback)", () => {
    expect(
      shouldArmStartupGiveUpToWelcome({
        isDesktop: true,
        waitForConfiguredLocalDaemon: false,
      }),
    ).toBe(false);
  });

  it("returns true for non-desktop (legacy give-up behavior)", () => {
    expect(
      shouldArmStartupGiveUpToWelcome({
        isDesktop: false,
        waitForConfiguredLocalDaemon: false,
      }),
    ).toBe(true);
  });

  it("returns false when waiting for a configured local daemon override", () => {
    expect(
      shouldArmStartupGiveUpToWelcome({
        isDesktop: false,
        waitForConfiguredLocalDaemon: true,
      }),
    ).toBe(false);
  });

  it("returns false for desktop even when also waiting for a configured override", () => {
    expect(
      shouldArmStartupGiveUpToWelcome({
        isDesktop: true,
        waitForConfiguredLocalDaemon: true,
      }),
    ).toBe(false);
  });
});

describe("resolveActiveHostRedirectRoute", () => {
  it("redirects a stale host route to the remaining host", () => {
    expect(
      resolveActiveHostRedirectRoute({
        pathname: "/h/server-1/workspace/workspace-a",
        activeServerId: "server-1",
        hostServerIds: ["server-2"],
      }),
    ).toBe("/h/server-2/workspace/workspace-a");
  });

  it("redirects a stale host route to welcome when the last host was removed", () => {
    expect(
      resolveActiveHostRedirectRoute({
        pathname: "/h/server-1/workspace/workspace-a",
        activeServerId: "server-1",
        hostServerIds: [],
      }),
    ).toBe(WELCOME_ROUTE);
  });

  it("does not redirect while the active host still exists", () => {
    expect(
      resolveActiveHostRedirectRoute({
        pathname: "/h/server-1/workspace/workspace-a",
        activeServerId: "server-1",
        hostServerIds: ["server-1"],
      }),
    ).toBeNull();
  });

  it("redirects a stale settings host route to the remaining host settings", () => {
    expect(
      resolveActiveHostRedirectRoute({
        pathname: "/settings/hosts/server-1",
        activeServerId: "server-1",
        hostServerIds: ["server-2"],
      }),
    ).toBe("/settings/hosts/server-2");
  });

  it("redirects a stale settings host route to welcome when the last host was removed", () => {
    expect(
      resolveActiveHostRedirectRoute({
        pathname: "/settings/hosts/server-1",
        activeServerId: "server-1",
        hostServerIds: [],
      }),
    ).toBe(WELCOME_ROUTE);
  });
});
