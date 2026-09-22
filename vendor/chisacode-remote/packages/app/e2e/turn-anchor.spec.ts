import { expect, test, type Page } from "./fixtures";
import {
  expectNearBottom,
  readScrollMetrics,
  waitForContentGrowth,
} from "./helpers/agent-bottom-anchor";
import { expectScrollFollowsNewContent } from "./helpers/agent-stream";
import {
  expectQueuedMessageButton,
  fillComposerDraft,
  sendDraftToQueue,
  sendQueuedMessageNow,
  startRunningMockAgent,
} from "./helpers/composer";

async function userMessageRowTop(page: Page): Promise<number> {
  return page
    .getByTestId("user-message")
    .last()
    .evaluate((el) => el.getBoundingClientRect().top);
}

/** Anchoring pins the sent row in the upper half of the viewport. */
async function sentRowIsInUpperHalf(page: Page): Promise<boolean> {
  const rowTop = await userMessageRowTop(page);
  const { viewportHeight } = await readScrollMetrics(page);
  return rowTop >= 0 && rowTop <= viewportHeight / 2;
}

test.describe("Turn anchor scroll", () => {
  test("sending a message pins the sent row near the top while the reply streams", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const { client, repo } = await startRunningMockAgent(page, {
      prefix: "turn-anchor-a-",
      model: "one-minute-stream",
      prompt: "Stream for turn-anchor pin test.",
    });
    try {
      // The agent is already streaming; the composer queues while running, so
      // queue then flush to dispatch a real optimistic user message.
      await fillComposerDraft(page, "Pin this turn.");
      await sendDraftToQueue(page);
      await sendQueuedMessageNow(page);

      // Wait for the in-flight reply to keep growing below the sent row.
      const { contentHeight } = await readScrollMetrics(page);
      await waitForContentGrowth(page, contentHeight);

      // Anchoring keeps the sent row in the upper half of the viewport; a
      // sticky-bottom list would have scrolled it off the top by now.
      await expect.poll(() => sentRowIsInUpperHalf(page), { timeout: 15_000 }).toBe(true);

      // The projection ack released composer busy: a second message can be
      // queued while the turn still streams (the daemon echoed the optimistic
      // message id, so hasServerAdopted… resolves).
      await fillComposerDraft(page, "Second message while streaming.");
      await sendDraftToQueue(page);
      await expectQueuedMessageButton(page);
    } finally {
      await client.close();
      await repo.cleanup();
    }
  });

  test("wheel away detaches anchoring and returning to the bottom resumes following", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const { client, repo } = await startRunningMockAgent(page, {
      prefix: "turn-anchor-b-",
      model: "one-minute-stream",
      prompt: "Stream for turn-anchor detach test.",
    });
    try {
      await fillComposerDraft(page, "Anchor for detach.");
      await sendDraftToQueue(page);
      await sendQueuedMessageNow(page);

      // Wait for the anchor to land, then wheel up: anchoring must detach into
      // free-scrolling instead of forcing the viewport back down.
      await expect.poll(() => sentRowIsInUpperHalf(page), { timeout: 15_000 }).toBe(true);
      await page.getByTestId("agent-chat-scroll").hover();
      await page.mouse.wheel(0, -300);

      // Free-scrolling: distance from the bottom stays large while content
      // keeps growing (no automatic re-following).
      const before = await readScrollMetrics(page);
      await expect
        .poll(
          async () => {
            const metrics = await readScrollMetrics(page);
            return metrics.distanceFromBottom;
          },
          { timeout: 10_000 },
        )
        .toBeGreaterThan(200);
      await waitForContentGrowth(page, before.contentHeight);
      const after = await readScrollMetrics(page);
      expect(after.distanceFromBottom).toBeGreaterThan(200);

      // Jumping to the bottom resumes following-end: subsequent growth keeps
      // the list at the live edge.
      await page.getByTestId("scroll-to-bottom-button").click();
      await expectNearBottom(page);
      await expectScrollFollowsNewContent(page);
    } finally {
      await client.close();
      await repo.cleanup();
    }
  });
});
