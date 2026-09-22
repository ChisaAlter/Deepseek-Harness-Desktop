import { expect, test } from "./fixtures";
import { gotoAppShell } from "./helpers/app";
import { seedWorkspace } from "./helpers/seed-client";
import { createIdleAgent } from "./helpers/archive-tab";
import { sidebarThreadRowLocator, waitForSidebarHydration } from "./helpers/workspace-ui";

test.describe("Sidebar thread rename", () => {
  test("renaming via the thread context menu updates the title in the sidebar", async ({
    page,
  }) => {
    const workspace = await seedWorkspace({ repoPrefix: "sidebar-rename-" });
    const agent = await createIdleAgent(workspace.client, {
      cwd: workspace.repoPath,
      title: "Feature Rename",
    });

    try {
      await gotoAppShell(page);
      await waitForSidebarHydration(page);

      const row = sidebarThreadRowLocator(page, agent.id);
      await expect(row).toBeVisible({ timeout: 30_000 });
      await row.click({ button: "right" });
      await page.getByTestId("sidebar-v2-menu-rename").click();

      // Soft Workbench renames via AdaptiveRenameModal, not an inline row textbox.
      const modal = page.getByTestId(new RegExp(`^sidebar-session-rename-modal-.*-${agent.id}$`));
      await expect(modal).toBeVisible({ timeout: 10_000 });
      const input = page.getByTestId(
        new RegExp(`^sidebar-session-rename-modal-.*-${agent.id}-input$`),
      );
      await expect(input).toBeVisible({ timeout: 10_000 });
      await input.fill("Feature Rename 2");
      const submit = page.getByTestId(
        new RegExp(`^sidebar-session-rename-modal-.*-${agent.id}-submit$`),
      );
      await expect(submit).toBeEnabled({ timeout: 10_000 });
      await submit.click();

      await expect(row).toContainText("Feature Rename 2", { timeout: 30_000 });
    } finally {
      await workspace.cleanup();
    }
  });
});
