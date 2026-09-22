import { expect, test } from "./fixtures";
import { openAgentRoute, seedMockAgentWorkspace } from "./helpers/mock-agent";
import { expectComposerEditable, submitMessage } from "./helpers/composer";

test.describe("Work log fold", () => {
  test("collapses a completed turn's trailing tool run to a +N badge and expands on demand", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const workspace = await seedMockAgentWorkspace({
      repoPrefix: "work-log-fold-",
      title: "Work log fold",
      model: "one-minute-stream",
    });
    try {
      await openAgentRoute(page, { cwd: workspace.cwd, agentId: workspace.agentId });
      await expectComposerEditable(page);

      // The mock's "end the turn with a tool run" mode streams the reply text
      // first, then read/grep/edit/bash as the turn's last items — the run
      // survives the completed-turn collapse and becomes the fold target.
      await submitMessage(page, "End the turn with a tool run.");

      // The app can lag the daemon stream, so wait on the fold's own
      // observable: the "+N" affordance appears once the app renders the
      // idle state (MAX_VISIBLE_WORK_LOG_ENTRIES = 1 → "+3").
      const moreButton = page.getByRole("button", {
        name: /Show \d+ more tool calls|Show fewer tool calls/,
      });
      await expect(moreButton).toHaveCount(1, { timeout: 60_000 });
      const badges = page.getByTestId("tool-call-badge");
      await expect(badges).toHaveCount(1, { timeout: 15_000 });
      await expect(moreButton).toHaveText("+3");

      // Expanding restores the hidden badges; the affordance switches to
      // "Show fewer" and collapses the run again on a second click.
      await moreButton.click();
      await expect(badges).toHaveCount(4, { timeout: 15_000 });
      await expect(moreButton).toHaveText("Show fewer");
      await moreButton.click();
      await expect(badges).toHaveCount(1, { timeout: 15_000 });
      await expect(moreButton).toHaveText("+3");
    } finally {
      await workspace.cleanup();
    }
  });
});
