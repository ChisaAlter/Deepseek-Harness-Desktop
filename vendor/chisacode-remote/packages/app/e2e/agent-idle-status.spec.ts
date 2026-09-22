import { expect, test } from "./fixtures";
import { expectAgentIdle, expectTurnCopyButton } from "./helpers/agent-stream";
import { expectComposerEditable, expectComposerVisible } from "./helpers/composer";
import { openAgentRoute, seedMockAgentWorkspace } from "./helpers/mock-agent";

test.describe("Agent idle status", () => {
  test("does not render a completed agent as still running", async ({ page }) => {
    test.setTimeout(180_000);

    const session = await seedMockAgentWorkspace({
      repoPrefix: "agent-idle-status-e2e-",
      title: "Idle status e2e",
      initialPrompt: "你好",
      model: "ten-second-stream",
    });

    try {
      const finish = await session.client.waitForFinish(session.agentId, 60_000);
      expect(finish.status).toBe("idle");
      expect(finish.final?.lastError ?? null).toBeNull();

      await openAgentRoute(page, session);

      await expectComposerVisible(page, { timeout: 30_000 });
      await expectComposerEditable(page);
      await expectAgentIdle(page);
      await expect(page.getByTestId("turn-working-indicator")).toHaveCount(0);
      await expect(page.getByTestId("turn-working-elapsed")).toHaveCount(0);
      await expectTurnCopyButton(page);
    } finally {
      await session.cleanup();
    }
  });
});
