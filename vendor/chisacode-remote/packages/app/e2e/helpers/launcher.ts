import { expect, type Page } from "@playwright/test";
import { buildHostWorkspaceRoute } from "../../src/utils/host-routes";
import { createTempGitRepo } from "./workspace";
import { getServerId } from "./server-id";

// ─── Navigation ────────────────────────────────────────────────────────────

/** Navigate to a workspace and wait for the workspace surface to appear. */
export async function gotoWorkspace(page: Page, cwd: string): Promise<void> {
  const route = buildHostWorkspaceRoute(getServerId(), cwd);
  await page.goto(route);
  await waitForTabBar(page);
}

// ─── Workspace surface queries ─────────────────────────────────────────────

/** Wait for the workspace surface to hydrate (center content renders). */
export async function waitForTabBar(page: Page): Promise<void> {
  await expect(
    page.locator('[data-testid^="workspace-deck-entry-"]').filter({ visible: true }).first(),
  ).toBeVisible({ timeout: 30_000 });
}

// ─── Content actions ───────────────────────────────────────────────────────

/**
 * Create a draft/chat session via the always-visible header menu.
 */
export async function clickNewChat(page: Page): Promise<void> {
  await page.getByTestId("workspace-header-menu-trigger").click();
  await page.getByTestId("workspace-header-new-agent").click();
}

/**
 * Create a terminal via the always-visible header toggle. Drawer terminals do
 * not force the center content, which matches the current workbench chrome.
 */
export async function clickNewTerminal(page: Page): Promise<void> {
  await page.getByTestId("workspace-header-menu-trigger").click();
  const item = page.getByTestId("workspace-header-new-terminal");
  await expect(item).toBeVisible({ timeout: 10_000 });
  await expect(item).not.toBeDisabled({ timeout: 10_000 });
  await item.click();
}

// ─── Title assertions ──────────────────────────────────────────────────────

/** Wait for the workspace header title to display the given text. */
export async function waitForTabWithTitle(
  page: Page,
  title: string | RegExp,
  timeout = 30_000,
): Promise<void> {
  const matcher = typeof title === "string" ? new RegExp(title, "i") : title;
  await expect(page.getByTestId("workspace-header-title").filter({ hasText: matcher })).toBeVisible(
    {
      timeout,
    },
  );
}

// ─── No-flash measurement ──────────────────────────────────────────────────

/**
 * Measure the time between clicking a launcher tile and the replacement panel becoming visible.
 * Returns elapsed milliseconds.
 */
export async function measureTileTransition(
  page: Page,
  clickAction: () => Promise<void>,
  successLocator: ReturnType<Page["locator"]>,
  timeout = 5_000,
): Promise<number> {
  const start = Date.now();
  await clickAction();
  await expect(successLocator).toBeVisible({ timeout });
  return Date.now() - start;
}

export function terminalSurfaceLocator(page: Page) {
  return page.locator('[data-testid="terminal-surface"]').first();
}

// ─── Workspace setup ───────────────────────────────────────────────────────

/** Create a temp git repo and return its path with a cleanup function. */
export async function createWorkspace(
  prefix = "launcher-e2e-",
): ReturnType<typeof createTempGitRepo> {
  return createTempGitRepo(prefix);
}
