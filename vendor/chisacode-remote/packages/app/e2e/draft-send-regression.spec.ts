import { expect, test, type Page } from "./fixtures";
import { composerInput, gotoAppShell } from "./helpers/app";
import { createIdleAgent } from "./helpers/archive-tab";
import { clickNewChat } from "./helpers/launcher";
import {
  archiveLocalWorkspaceFromDaemon,
  connectNewWorkspaceDaemonClient,
  delayBrowserAgentCreatedStatus,
  openNewWorkspaceComposer,
  openProjectViaDaemon,
} from "./helpers/new-workspace";
import { getServerId } from "./helpers/server-id";
import { createTempGitRepo } from "./helpers/workspace";
import { switchAgentViaSidebar, waitForSidebarHydration } from "./helpers/workspace-ui";

/**
 * Regression gates for the draft-send contract:
 * - Gate 1: sending must leave the draft page once the create resolves.
 * - Gate 2: the sidebar must show the new conversation row immediately and
 *   keep it selected from the moment the send starts (not after the create
 *   round-trip). The create ack is deliberately delayed so the tests observe
 *   the optimistic window.
 */
test.describe("Draft send gates", () => {
  let client: Awaited<ReturnType<typeof connectNewWorkspaceDaemonClient>>;
  const localWorkspaceIds = new Set<string>();

  test.describe.configure({ timeout: 240_000 });

  test.beforeEach(async () => {
    client = await connectNewWorkspaceDaemonClient();
  });

  test.afterEach(async () => {
    for (const workspaceId of localWorkspaceIds) {
      await archiveLocalWorkspaceFromDaemon(client, workspaceId).catch(() => undefined);
    }
    localWorkspaceIds.clear();
    await client?.close().catch(() => undefined);
  });

  async function collectThreadIds(page: Page): Promise<string[]> {
    return page
      .locator('[data-testid^="sidebar-v2-thread-"]')
      .evaluateAll((els) =>
        els.map((el) => (el.getAttribute("data-testid") ?? "").replace(/^sidebar-v2-thread-/, "")),
      );
  }

  async function expectFreshThreadSelected(
    page: Page,
    before: Set<string>,
    input: { label: string; seedAgentId: string },
  ): Promise<void> {
    // The optimistic row appears while the create ack is still delayed.
    await expect
      .poll(async () => (await collectThreadIds(page)).filter((id) => !before.has(id)), {
        message: `${input.label}: optimistic sidebar row never appeared`,
        timeout: 10_000,
      })
      .toEqual([expect.stringMatching(/^.+$/)]);
    const fresh = (await collectThreadIds(page)).find((id) => !before.has(id));
    expect(fresh).toBeTruthy();
    // ...and it is selected immediately (Gate 2). The by-project rows carry no
    // aria-selected attribute, so assert the actual selected fill: the fresh
    // row's computed background must differ from an unselected row's.
    const serverId = getServerId();
    const freshRow = page.getByTestId(`sidebar-session-${serverId}-${fresh!}`);
    const seedRow = page.getByTestId(`sidebar-session-${serverId}-${input.seedAgentId}`);
    await expect(freshRow).toBeVisible({ timeout: 5_000 });
    await expect
      .poll(
        async () => {
          const freshBackground = await freshRow
            .evaluate((el) => getComputedStyle(el).backgroundColor)
            .catch(() => null);
          const seedBackground = await seedRow
            .evaluate((el) => getComputedStyle(el).backgroundColor)
            .catch(() => null);
          return freshBackground !== null &&
            freshBackground !== "rgba(0, 0, 0, 0)" &&
            freshBackground !== seedBackground
            ? "selected"
            : `not-selected fresh=${freshBackground} seed=${seedBackground}`;
        },
        { message: `${input.label}: fresh row never became visually selected`, timeout: 5_000 },
      )
      .toBe("selected");
  }

  test("existing-workspace draft send selects the optimistic row immediately and leaves the draft page", async ({
    page,
  }) => {
    const tempRepo = await createTempGitRepo("draft-send-gate-");
    const createdDelay = await delayBrowserAgentCreatedStatus(page);
    const message = "draft-send-gate-2-immediate-selection";
    try {
      const openedProject = await openProjectViaDaemon(client, tempRepo.path);
      localWorkspaceIds.add(openedProject.workspaceId);
      const seedAgent = await createIdleAgent(client, {
        cwd: tempRepo.path,
        title: `draft-send-seed-${Date.now()}`,
      });
      await gotoAppShell(page);
      await waitForSidebarHydration(page);
      await switchAgentViaSidebar(page, seedAgent.id);

      const before = new Set(await collectThreadIds(page));
      await clickNewChat(page);
      const composer = composerInput(page);
      await expect(composer).toBeVisible({ timeout: 30_000 });
      await composer.fill(message);
      await composer.press("Enter");
      await createdDelay.waitForCreateRequest();

      await expectFreshThreadSelected(page, before, {
        label: "existing-workspace draft",
        seedAgentId: seedAgent.id,
      });

      // Gate 1: once the ack lands, the pane leaves the draft page: the draft
      // create button is gone and the conversation shows the sent message.
      createdDelay.release();
      await expect(page.getByText(message, { exact: true }).first()).toBeVisible({
        timeout: 30_000,
      });
      await expect(
        page.getByTestId("message-input-root").getByRole("button", { name: /^(Create|创建)$/ }),
      ).toHaveCount(0, { timeout: 30_000 });
      await expect(composerInput(page)).toBeVisible({ timeout: 30_000 });
    } finally {
      createdDelay.release();
      await tempRepo.cleanup();
    }
  });

  test("/new auto-send selects the optimistic row before the create resolves", async ({ page }) => {
    const tempRepo = await createTempGitRepo("draft-send-new-");
    const createdDelay = await delayBrowserAgentCreatedStatus(page);
    const message = "draft-send-new-gate-2-selection";
    try {
      const openedProject = await openProjectViaDaemon(client, tempRepo.path);
      localWorkspaceIds.add(openedProject.workspaceId);
      const seedAgent = await createIdleAgent(client, {
        cwd: tempRepo.path,
        title: `draft-send-new-seed-${Date.now()}`,
      });
      await gotoAppShell(page);
      await waitForSidebarHydration(page);
      await switchAgentViaSidebar(page, seedAgent.id);
      const before = new Set(await collectThreadIds(page));

      await openNewWorkspaceComposer(page, {
        workspaceDirectory: openedProject.workspaceDirectory,
      });
      const composer = composerInput(page);
      await expect(composer).toBeVisible({ timeout: 30_000 });
      await composer.fill(message);
      await page
        .getByTestId("message-input-root")
        .getByRole("button", { name: /^(Create|创建)$/ })
        .click();
      await createdDelay.waitForCreateRequest();

      await expectFreshThreadSelected(page, before, {
        label: "/new auto-send",
        seedAgentId: seedAgent.id,
      });

      // Gate 1: after the ack, the conversation view shows the sent message and
      // the draft create UI is gone.
      createdDelay.release();
      await expect(page.getByText(message, { exact: true }).first()).toBeVisible({
        timeout: 30_000,
      });
      await expect(
        page.getByTestId("message-input-root").getByRole("button", { name: /^(Create|创建)$/ }),
      ).toHaveCount(0, { timeout: 30_000 });
      await expect(composerInput(page)).toBeVisible({ timeout: 30_000 });
    } finally {
      createdDelay.release();
      await tempRepo.cleanup();
    }
  });
});
