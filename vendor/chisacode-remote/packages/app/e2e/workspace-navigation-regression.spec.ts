import { buildHostAgentDetailRoute, buildHostWorkspaceRoute } from "@/utils/host-routes";
import type { WebSocketRoute } from "@playwright/test";
import { expect, test, type Page } from "./fixtures";
import { gotoAppShell, openSettings } from "./helpers/app";
import {
  createIdleAgent,
  expectWorkspaceTabHidden,
  expectWorkspaceTabVisible,
  openWorkspaceWithAgents,
} from "./helpers/archive-tab";
import { expectComposerVisible } from "./helpers/composer";
import { daemonWsRoutePattern } from "./helpers/daemon-port";
import { seedWorkspace } from "./helpers/seed-client";
import {
  expectConversationColumnWidthStable,
  expectOnlyWorkspaceAgentSurfacesVisible,
  expectSidebarThreadActive,
  expectTerminalSurfaceFullWidth,
  expectWorkspaceDeckEntryCount,
  expectWorkspaceHeader,
  expectWorkspaceHeaderAbsent,
  expectMenuButtonVisible,
  expectHostConnectingOrOffline,
  expectReconnectingToastVisible,
  expectReconnectingToastGone,
  getVisibleWorkspaceAgentSurfaceIds,
  measureConversationAspectColumn,
  switchAgentViaSidebar,
  waitForSidebarHydration,
  waitForWorkspaceTabsVisible,
  expectWorkspaceTabsAbsent,
  workspaceDeckEntryLocator,
} from "./helpers/workspace-ui";
import { clickSettingsBackToWorkspace } from "./helpers/settings";
import { getServerId } from "./helpers/server-id";
import { TerminalE2EHarness, withTerminalInApp } from "./helpers/terminal-dsl";

const LOADING_WORKSPACE_TEXT_PATTERN = /Loading workspace/i;

async function expectNoLoadingWorkspacePane(
  page: Page,
  input: { label: string; durationMs?: number },
): Promise<void> {
  const durationMs = input.durationMs ?? 2000;
  const startedAt = Date.now();
  const samples: string[] = [];

  while (Date.now() - startedAt < durationMs) {
    const url = page.url();
    const text = await page
      .locator("body")
      .innerText({ timeout: 250 })
      .catch((error) => `[body unavailable: ${error instanceof Error ? error.message : error}]`);
    samples.push(`${Date.now() - startedAt}ms ${url}\n${text.slice(0, 1000)}`);

    if (LOADING_WORKSPACE_TEXT_PATTERN.test(text)) {
      throw new Error(
        `${input.label}: loading workspace pane appeared during reconnect window.\n\n${samples.join(
          "\n\n---\n\n",
        )}`,
      );
    }

    await page.waitForTimeout(100);
  }
}

async function expectNoLoadingPane(page: Page): Promise<void> {
  await expect(page.getByText(LOADING_WORKSPACE_TEXT_PATTERN)).toHaveCount(0);
}

async function installDaemonWebSocketGate(page: Page) {
  let acceptingConnections = true;
  const activeSockets = new Set<WebSocketRoute>();

  await page.routeWebSocket(daemonWsRoutePattern(), (ws) => {
    if (!acceptingConnections) {
      void ws.close({ code: 1008, reason: "Blocked by workspace reconnect regression test." });
      return;
    }

    activeSockets.add(ws);
    const server = ws.connectToServer();

    ws.onMessage((message) => {
      if (!acceptingConnections) {
        return;
      }
      try {
        server.send(message);
      } catch {
        activeSockets.delete(ws);
      }
    });

    server.onMessage((message) => {
      if (!acceptingConnections) {
        return;
      }
      try {
        ws.send(message);
      } catch {
        activeSockets.delete(ws);
      }
    });
  });

  return {
    async drop(): Promise<void> {
      acceptingConnections = false;
      const sockets = Array.from(activeSockets);
      activeSockets.clear();
      await Promise.all(
        sockets.map((ws) =>
          ws
            .close({ code: 1008, reason: "Dropped by workspace reconnect regression test." })
            .catch(() => undefined),
        ),
      );
    },
    restore(): void {
      acceptingConnections = true;
    },
  };
}

test.describe("Workspace navigation regression", () => {
  test.describe.configure({ timeout: 240_000 });

  test("keeps the workspace composer available after returning from settings", async ({
    page,
    withWorkspace,
  }) => {
    const workspace = await withWorkspace({ prefix: "workspace-settings-back-tab-" });

    await workspace.navigateTo();
    await expectComposerVisible(page);

    await openSettings(page);
    await clickSettingsBackToWorkspace(page);
    await expect(page).toHaveURL(/\/workspace\//, { timeout: 30_000 });
    await expectComposerVisible(page);
  });

  test("keeps the workspace rendered while reconnecting to the host", async ({ page }) => {
    const serverId = getServerId();

    const daemonGate = await installDaemonWebSocketGate(page);

    const workspace = await seedWorkspace({ repoPrefix: "workspace-reconnect-" });

    try {
      const agent = await createIdleAgent(workspace.client, {
        cwd: workspace.repoPath,
        title: `workspace-reconnect-${Date.now()}`,
      });

      await gotoAppShell(page);
      await waitForSidebarHydration(page);
      await page.goto(buildHostAgentDetailRoute(serverId, agent.id), {
        waitUntil: "commit",
        timeout: 60_000,
      });
      await page.waitForFunction(
        () =>
          window.location.pathname.includes("/workspace/") &&
          !window.location.search.includes("open="),
        undefined,
        { timeout: 60_000 },
      );
      await expectWorkspaceHeader(page, {
        title: agent.title,
        subtitle: workspace.projectDisplayName,
      });
      await waitForWorkspaceTabsVisible(page);
      await expectWorkspaceTabVisible(page, agent.id);

      await daemonGate.drop();
      await expectReconnectingToastVisible(page);
      await expectWorkspaceHeader(page, {
        title: agent.title,
        subtitle: workspace.projectDisplayName,
      });
      await waitForWorkspaceTabsVisible(page);
      await expectComposerVisible(page);
      await expectNoLoadingPane(page);

      const monitorReconnect = expectNoLoadingWorkspacePane(page, {
        label: "host reconnect",
      });
      daemonGate.restore();
      await expectReconnectingToastGone(page);
      await monitorReconnect;
      await expectWorkspaceHeader(page, {
        title: agent.title,
        subtitle: workspace.projectDisplayName,
      });
      await waitForWorkspaceTabsVisible(page);
      await expectComposerVisible(page);
    } finally {
      daemonGate.restore();
      await workspace.cleanup();
    }
  });

  test("cold offline workspace route gates the screen interior but keeps settings reachable", async ({
    page,
  }) => {
    const serverId = getServerId();

    await page.routeWebSocket(daemonWsRoutePattern(), async (ws) => {
      await ws.close({ code: 1008, reason: "Blocked cold offline workspace route test." });
    });

    await page.goto(
      `/h/${encodeURIComponent(serverId)}/workspace/${encodeURIComponent("/tmp/chisacode-missing-workspace")}`,
    );

    await expectHostConnectingOrOffline(page);
    await expectMenuButtonVisible(page);
    await expectWorkspaceHeaderAbsent(page);
    await expectWorkspaceTabsAbsent(page);
    await openSettings(page);
    await expect(page).toHaveURL(/\/settings\/general(?:\?.*)?$/);
  });

  test("cold workspace URL keeps sidebar workspace navigation functional", async ({ page }) => {
    const serverId = getServerId();

    const firstWorkspace = await seedWorkspace({ repoPrefix: "workspace-cold-url-a-" });
    const secondWorkspace = await seedWorkspace({ repoPrefix: "workspace-cold-url-b-" });

    try {
      await page.goto(buildHostWorkspaceRoute(serverId, firstWorkspace.workspaceId));
      await waitForSidebarHydration(page);
      await expect(page).toHaveURL(buildHostWorkspaceRoute(serverId, firstWorkspace.workspaceId), {
        timeout: 30_000,
      });

      // SidebarV2 lists agent threads only; an agent-less workspace is
      // reachable by route alone. Assert the workspace deck renders for the
      // cold URL instead of sidebar navigation.
      await expect(
        page
          .getByTestId(`workspace-deck-entry-${serverId}:${firstWorkspace.workspaceId}`)
          .filter({ visible: true }),
      ).toBeVisible({ timeout: 30_000 });
    } finally {
      await secondWorkspace.cleanup();
      await firstWorkspace.cleanup();
    }
  });

  test("sidebar navigation and reload keep workspace selection and tabs aligned", async ({
    page,
  }) => {
    const serverId = getServerId();

    const firstWorkspace = await seedWorkspace({ repoPrefix: "workspace-nav-reg-a-" });
    const secondWorkspace = await seedWorkspace({ repoPrefix: "workspace-nav-reg-b-" });

    try {
      const firstAgent = await createIdleAgent(firstWorkspace.client, {
        cwd: firstWorkspace.repoPath,
        title: `workspace-nav-a-${Date.now()}`,
      });
      const secondAgent = await createIdleAgent(secondWorkspace.client, {
        cwd: secondWorkspace.repoPath,
        title: `workspace-nav-b-${Date.now()}`,
      });

      await gotoAppShell(page);
      await waitForSidebarHydration(page);
      // The default sidebar view is by-project, whose rows expose selection as
      // a row fill rather than aria-selected. Switch to by-status so the
      // selection assertions below have a deterministic DOM signal (and the
      // view mode persists through the reload below).
      await page.getByTestId("sidebar-view-by-status").click();
      await openWorkspaceWithAgents(page, [firstAgent, secondAgent]);

      const firstDeckEntry = workspaceDeckEntryLocator(page, serverId, firstWorkspace.workspaceId);
      const secondDeckEntry = workspaceDeckEntryLocator(
        page,
        serverId,
        secondWorkspace.workspaceId,
      );

      await switchAgentViaSidebar(page, firstAgent.id);
      await waitForWorkspaceTabsVisible(page);
      await expect(page).toHaveURL(buildHostWorkspaceRoute(serverId, firstWorkspace.workspaceId), {
        timeout: 30_000,
      });
      await expectSidebarThreadActive({ page, agentId: firstAgent.id });
      await expectSidebarThreadActive({ page, agentId: secondAgent.id, selected: false });
      await expectWorkspaceHeader(page, {
        title: firstAgent.title,
        subtitle: firstWorkspace.projectDisplayName,
      });
      await expectWorkspaceTabVisible(page, firstAgent.id);
      await expectWorkspaceTabHidden(page, secondAgent.id);
      await expectOnlyWorkspaceAgentSurfacesVisible(page, [firstAgent.id]);
      await expect(getVisibleWorkspaceAgentSurfaceIds(page)).resolves.toEqual([firstAgent.id]);
      await expect(firstDeckEntry).toBeVisible({ timeout: 30_000 });

      await switchAgentViaSidebar(page, secondAgent.id);
      await waitForWorkspaceTabsVisible(page);
      await expect(page).toHaveURL(buildHostWorkspaceRoute(serverId, secondWorkspace.workspaceId), {
        timeout: 30_000,
      });
      await expectSidebarThreadActive({ page, agentId: secondAgent.id });
      await expectSidebarThreadActive({ page, agentId: firstAgent.id, selected: false });
      await expectWorkspaceHeader(page, {
        title: secondAgent.title,
        subtitle: secondWorkspace.projectDisplayName,
      });
      await expectWorkspaceTabVisible(page, secondAgent.id);
      await expectWorkspaceTabHidden(page, firstAgent.id);
      await expectOnlyWorkspaceAgentSurfacesVisible(page, [secondAgent.id]);
      await expect(getVisibleWorkspaceAgentSurfaceIds(page)).resolves.toEqual([secondAgent.id]);
      await expect(firstDeckEntry).toBeAttached();
      await expect(firstDeckEntry).toBeHidden();
      await expect(secondDeckEntry).toBeVisible({ timeout: 30_000 });
      await expectWorkspaceDeckEntryCount(page, 2);

      await page.evaluate(
        ({ agentId, serverId: targetServerId }) => {
          globalThis.dispatchEvent(
            new CustomEvent("chisacode:web-notification-click", {
              detail: {
                data: {
                  serverId: targetServerId,
                  agentId,
                  reason: "finished",
                },
              },
              cancelable: true,
            }),
          );
        },
        { agentId: secondAgent.id, serverId },
      );
      await waitForWorkspaceTabsVisible(page);
      await expect(page).toHaveURL(buildHostWorkspaceRoute(serverId, secondWorkspace.workspaceId), {
        timeout: 30_000,
      });
      await expect(secondDeckEntry).toBeVisible({ timeout: 30_000 });
      await expectWorkspaceTabVisible(page, secondAgent.id);
      await expectWorkspaceTabHidden(page, firstAgent.id);
      await expectOnlyWorkspaceAgentSurfacesVisible(page, [secondAgent.id]);
      await expect(firstDeckEntry).toBeAttached();
      await expect(firstDeckEntry).toBeHidden();
      await expectWorkspaceDeckEntryCount(page, 2);

      await switchAgentViaSidebar(page, firstAgent.id);
      await waitForWorkspaceTabsVisible(page);
      await expect(page).toHaveURL(buildHostWorkspaceRoute(serverId, firstWorkspace.workspaceId), {
        timeout: 30_000,
      });
      await expect(firstDeckEntry).toBeVisible({ timeout: 30_000 });
      await expect(secondDeckEntry).toBeAttached();
      await expect(secondDeckEntry).toBeHidden();
      await expectWorkspaceDeckEntryCount(page, 2);

      await page.reload();
      await waitForSidebarHydration(page);
      await waitForWorkspaceTabsVisible(page);
      await expect(page).toHaveURL(buildHostWorkspaceRoute(serverId, firstWorkspace.workspaceId), {
        timeout: 30_000,
      });
      await expectSidebarThreadActive({ page, agentId: firstAgent.id });
      await expectWorkspaceHeader(page, {
        title: firstAgent.title,
        subtitle: firstWorkspace.projectDisplayName,
      });
      await expectWorkspaceTabVisible(page, firstAgent.id);
      await expectWorkspaceTabHidden(page, secondAgent.id);
      await expectOnlyWorkspaceAgentSurfacesVisible(page, [firstAgent.id]);
      await expect(getVisibleWorkspaceAgentSurfaceIds(page)).resolves.toEqual([firstAgent.id]);
    } finally {
      await secondWorkspace.cleanup();
      await firstWorkspace.cleanup();
    }
  });

  test("same-workspace agent switches keep conversation column width stable", async ({ page }) => {
    // Gates the T3-style shell-hosted ConversationAspectColumn fix: the column
    // mounts once on the center-column shell and must not re-measure (800→paneH)
    // when the keyed agent panel remounts on switch.
    const workspace = await seedWorkspace({ repoPrefix: "conv-col-stable-" });

    try {
      const firstAgent = await createIdleAgent(workspace.client, {
        cwd: workspace.repoPath,
        title: `conv-col-a-${Date.now()}`,
      });
      const secondAgent = await createIdleAgent(workspace.client, {
        cwd: workspace.repoPath,
        title: `conv-col-b-${Date.now()}`,
      });

      await openWorkspaceWithAgents(page, [firstAgent, secondAgent]);
      await waitForWorkspaceTabsVisible(page);
      await switchAgentViaSidebar(page, firstAgent.id);
      await expectWorkspaceTabVisible(page, firstAgent.id);
      await expectComposerVisible(page);

      // Wait for first measure to settle, then capture baseline.
      await expect
        .poll(
          async () => {
            const box = await measureConversationAspectColumn(page);
            return box && box.width > 0 ? box.width : 0;
          },
          { timeout: 15_000 },
        )
        .toBeGreaterThan(0);
      const baseline = await measureConversationAspectColumn(page);
      expect(baseline).not.toBeNull();

      await switchAgentViaSidebar(page, secondAgent.id);
      await expectWorkspaceTabVisible(page, secondAgent.id);
      await expectConversationColumnWidthStable(page, { baseline });

      await switchAgentViaSidebar(page, firstAgent.id);
      await expectWorkspaceTabVisible(page, firstAgent.id);
      await expectConversationColumnWidthStable(page, { baseline });
    } finally {
      await workspace.cleanup();
    }
  });

  test("terminal surface stays full-width of the main panel", async ({ page }) => {
    // ConversationAspectColumn is kind-gated to agent/draft only — terminal must
    // not inherit the 800-centered reading column.
    const harness = await TerminalE2EHarness.create({ tempPrefix: "term-fullwidth-" });
    try {
      await withTerminalInApp(page, harness, { name: "fullwidth-check" }, async () => {
        await expectTerminalSurfaceFullWidth(page);
      });
    } finally {
      await harness.cleanup();
    }
  });
});
