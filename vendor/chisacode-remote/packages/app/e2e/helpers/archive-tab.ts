import { randomUUID } from "node:crypto";
import { expect, type Page } from "@playwright/test";
import { buildCreateAgentPreferences, buildSeededHost } from "./daemon-registry";
import { getE2EDaemonPort } from "./daemon-port";
import { getServerId } from "./server-id";
import { waitForWorkspaceTabsVisible } from "./workspace-ui";
import {
  buildHostAgentDetailRoute,
  buildHostSessionsRoute,
  buildHostWorkspaceRoute,
} from "@/utils/host-routes";

export interface ArchiveTabAgent {
  id: string;
  title: string;
  cwd: string;
}

function buildSeededStoragePayload() {
  const nowIso = new Date().toISOString();
  return {
    daemon: buildSeededHost({
      serverId: getServerId(),
      endpoint: `127.0.0.1:${getE2EDaemonPort()}`,
      nowIso,
    }),
    preferences: buildCreateAgentPreferences(getServerId()),
  };
}

async function navigateToAppRoot(page: Page): Promise<void> {
  await page.goto("/", { waitUntil: "commit", timeout: 60_000 });
}

async function navigateToRoute(page: Page, route: string): Promise<void> {
  await page.goto(route, { waitUntil: "commit", timeout: 60_000 });
}

async function waitForCleanWorkspaceRoute(page: Page): Promise<void> {
  await page.waitForFunction(
    () =>
      window.location.pathname.includes("/workspace/") && !window.location.search.includes("open="),
    undefined,
    { timeout: 60_000 },
  );
}

/**
 * The slice of a daemon client `createIdleAgent` needs: spawn an agent and await
 * its idle upsert. The shared seed client satisfies it, so a spec can seed an
 * idle agent from the same client it uses for everything else.
 */
export interface IdleAgentSeedClient {
  createAgent(options: {
    provider: string;
    model: string;
    modeId: string;
    cwd: string;
    title: string;
  }): Promise<{ id: string }>;
  waitForAgentUpsert(
    agentId: string,
    predicate: (snapshot: { status: string }) => boolean,
    timeout?: number,
  ): Promise<{ status: string }>;
}

export async function createIdleAgent(
  client: IdleAgentSeedClient,
  input: { cwd: string; title: string },
): Promise<ArchiveTabAgent> {
  const created = await client.createAgent({
    provider: "opencode",
    model: "opencode/gpt-5-nano",
    modeId: "bypassPermissions",
    cwd: input.cwd,
    title: input.title,
  });
  const snapshot = await client.waitForAgentUpsert(
    created.id,
    (agent) => agent.status === "idle",
    30_000,
  );
  if (snapshot.status !== "idle") {
    throw new Error(`Expected agent ${created.id} to become idle, got ${snapshot.status}.`);
  }
  return {
    id: created.id,
    title: input.title,
    cwd: input.cwd,
  };
}

export async function archiveAgentFromDaemon(
  client: { archiveAgent(agentId: string): Promise<{ archivedAt: string }> },
  agentId: string,
): Promise<void> {
  await client.archiveAgent(agentId);
}

export async function primeAdditionalPage(page: Page): Promise<void> {
  const seedNonce = randomUUID();
  const { daemon, preferences } = buildSeededStoragePayload();

  await page.route(/:(6767)\b/, (route) => route.abort());
  await page.routeWebSocket(/:(6767)\b/, async (ws) => {
    await ws.close({ code: 1008, reason: "Blocked connection to localhost:6767 during e2e." });
  });
  await page.addInitScript(
    ({ daemon: seededDaemon, preferences: seededPreferences, seedNonce: nonce }) => {
      const disableOnceKey = "@chisacode:e2e-disable-default-seed-once";
      const disableValue = localStorage.getItem(disableOnceKey);
      if (disableValue) {
        localStorage.removeItem(disableOnceKey);
        if (disableValue === nonce) {
          return;
        }
      }

      localStorage.setItem("@chisacode:e2e", "1");
      localStorage.setItem("@chisacode:e2e-seed-nonce", nonce);
      localStorage.setItem("@chisacode:daemon-registry", JSON.stringify([seededDaemon]));
      localStorage.removeItem("@chisacode:settings");
      localStorage.setItem(
        "@chisacode:create-agent-preferences",
        JSON.stringify(seededPreferences),
      );
    },
    { daemon, preferences, seedNonce },
  );
  await navigateToAppRoot(page);
}

export async function resetSeededPageState(page: Page): Promise<void> {
  const { daemon, preferences } = buildSeededStoragePayload();
  await navigateToAppRoot(page);
  await page.evaluate(
    ({ daemon: seededDaemon, preferences: seededPreferences }) => {
      localStorage.clear();
      localStorage.setItem("@chisacode:e2e", "1");
      localStorage.setItem("@chisacode:daemon-registry", JSON.stringify([seededDaemon]));
      localStorage.setItem(
        "@chisacode:create-agent-preferences",
        JSON.stringify(seededPreferences),
      );
      localStorage.removeItem("@chisacode:settings");
    },
    { daemon, preferences },
  );
  await navigateToAppRoot(page);
}

export async function openWorkspaceWithAgents(
  page: Page,
  agents: [ArchiveTabAgent, ArchiveTabAgent],
): Promise<void> {
  const serverId = getServerId();
  for (const agent of agents) {
    await navigateToRoute(page, buildHostAgentDetailRoute(serverId, agent.id));

    // The workspace layout consumes `?open=agent:xxx`, returns null during the effect,
    // then replaces the URL with the clean workspace route after preparing the tab.
    // On CI, Expo Router's rootNavigationState may take time to initialize,
    // so we allow a generous timeout here (matching terminal-perf pattern).
    await waitForCleanWorkspaceRoute(page);

    await waitForWorkspaceTabsVisible(page);
    await expectWorkspaceTabVisible(page, agent.id);
  }
}

export async function expectWorkspaceTabVisible(page: Page, agentId: string): Promise<void> {
  const panel = page.getByTestId(`agent-panel-${agentId}`).filter({ visible: true });
  await expect(panel.first()).toBeVisible({ timeout: 30_000 });
}

export async function expectWorkspaceTabHidden(page: Page, agentId: string): Promise<void> {
  await expect(page.getByTestId(`agent-panel-${agentId}`).filter({ visible: true })).toHaveCount(
    0,
    {
      timeout: 30_000,
    },
  );
}

export async function expectWorkspaceArchiveOutcome(
  page: Page,
  input: { archivedAgentId: string; survivingAgentId: string },
): Promise<void> {
  await expectWorkspaceTabHidden(page, input.archivedAgentId);
  await expectWorkspaceTabVisible(page, input.survivingAgentId);
}

export async function closeWorkspaceAgentTab(page: Page, agentId: string): Promise<void> {
  const closeButton = page.getByTestId(`workspace-agent-close-${agentId}`).filter({
    visible: true,
  });
  await expect(closeButton.first()).toBeVisible({ timeout: 30_000 });
  await closeButton.first().click();
  await expectWorkspaceTabHidden(page, agentId);
}

export async function expectArchivedAgentFocused(page: Page, agentId: string): Promise<void> {
  await expectWorkspaceTabVisible(page, agentId);
  await expect(
    page
      .getByText(/This agent is archived|此智能体已归档/)
      .filter({ visible: true })
      .first(),
  ).toBeVisible({
    timeout: 30_000,
  });
}

export async function reloadWorkspace(page: Page, workspaceId: string): Promise<void> {
  const serverId = getServerId();
  await navigateToRoute(page, buildHostWorkspaceRoute(serverId, workspaceId));
  await waitForWorkspaceTabsVisible(page);
}

export async function openSessions(page: Page): Promise<void> {
  const serverId = getServerId();
  const currentSessionsButton = page.getByTestId("sidebar-all-sessions");
  const legacySessionsButton = page.getByTestId("sidebar-sessions");
  if (await currentSessionsButton.isVisible().catch(() => false)) {
    await currentSessionsButton.click();
  } else if (await legacySessionsButton.isVisible().catch(() => false)) {
    await legacySessionsButton.click();
  } else {
    await navigateToRoute(page, buildHostSessionsRoute(serverId));
  }
  await expect(page).toHaveURL(new RegExp(`${buildHostSessionsRoute(getServerId())}$`), {
    timeout: 30_000,
  });
  await expect(page.getByText(/^(Sessions|会话)$/).last()).toBeVisible({
    timeout: 30_000,
  });
}

const AGENT_ROW_SELECTOR = '[data-testid^="agent-row-"]';

function getSessionRowByTitle(page: Page, title: string) {
  return page.locator(AGENT_ROW_SELECTOR).filter({ hasText: title }).first();
}

export async function expectSessionRowVisible(page: Page, title: string): Promise<void> {
  await expect(getSessionRowByTitle(page, title)).toBeVisible({ timeout: 30_000 });
}

export async function expectSessionRowArchived(page: Page, title: string): Promise<void> {
  await expect(getSessionRowByTitle(page, title)).toContainText(/Archived|已归档/, {
    timeout: 30_000,
  });
}

export async function clickSessionRow(page: Page, title: string): Promise<void> {
  const row = getSessionRowByTitle(page, title);
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.click();
}

export async function expectSessionsEmptyState(page: Page): Promise<void> {
  // Guard: if session rows appear, a prior spec polluted the shared daemon — see 00-sessions-empty.spec.ts.
  await expect(page.locator(AGENT_ROW_SELECTOR)).toHaveCount(0, { timeout: 5_000 });
  await expect(page.getByTestId("sessions-empty-state")).toBeVisible({ timeout: 30_000 });
}

export async function archiveAgentFromSessions(
  page: Page,
  input: { agentId: string; title: string },
): Promise<void> {
  const row = getSessionRowByTitle(page, input.title);
  await expect(row).toBeVisible({ timeout: 30_000 });
  const box = await row.boundingBox();
  if (!box) {
    throw new Error(`Could not read bounding box for session row ${input.agentId}.`);
  }

  // Long-press the row. Idle agents are archived immediately (no modal).
  // Running/initializing agents show a confirmation modal instead.
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(900);
  await page.mouse.up();

  // If a confirmation modal appears (running agent), click the archive button.
  const archiveButton = page.getByTestId("agent-action-archive").first();
  const modalVisible = await archiveButton.isVisible().catch(() => false);
  if (modalVisible) {
    await archiveButton.click();
  }

  await expectSessionRowArchived(page, input.title);
}
