import { expect, type Page } from "@playwright/test";
import { buildHostWorkspaceRoute } from "../../src/utils/host-routes";
import { getServerId } from "./server-id";

/**
 * Opens a workspace by route. Soft Home + SidebarV2 do not render classic
 * `sidebar-workspace-row-*` nodes on the home list, so route navigation is the
 * only reliable path.
 */
export async function selectWorkspaceInSidebar(page: Page, workspaceId: string): Promise<void> {
  const serverId = getServerId();
  await page.goto(buildHostWorkspaceRoute(serverId, workspaceId), {
    waitUntil: "domcontentloaded",
  });
  await page.waitForURL((url) => url.pathname.includes("/workspace/"), { timeout: 60_000 });
}

export async function openMobileAgentSidebar(page: Page): Promise<void> {
  // Soft Home compact uses the header menu toggle (testID menu-button). Fall
  // back to bilingual accessibility labels when the testid is absent.
  const byTestId = page.getByTestId("menu-button");
  if (await byTestId.count()) {
    await byTestId.first().click();
    return;
  }
  await page.getByRole("button", { name: /Open menu|打开菜单|打开侧边栏/i }).click();
}

export async function closeMobileAgentSidebar(page: Page): Promise<void> {
  const closeButton = page.getByTestId("sidebar-close");
  await expect(closeButton).toBeInViewport({ timeout: 5_000 });
  await closeButton.click({ force: true });
}

export async function expectMobileAgentSidebarVisible(page: Page): Promise<void> {
  await expect(
    page.getByTestId("sidebar-sessions").or(page.getByTestId("desktop-left-sidebar")),
  ).toBeInViewport({ timeout: 5_000 });
}

export async function expectMobileAgentSidebarHidden(page: Page): Promise<void> {
  await expect(page.getByTestId("sidebar-sessions")).not.toBeInViewport({ timeout: 5_000 });
}
