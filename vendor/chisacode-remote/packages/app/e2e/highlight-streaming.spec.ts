import { expect, test } from "./fixtures";
import { awaitAssistantMessage } from "./helpers/agent-stream";
import { openAgentRoute, seedMockAgentWorkspace } from "./helpers/mock-agent";
import { expectComposerEditable, submitMessage } from "./helpers/composer";

test.describe("Streaming highlight fence", () => {
  test("renders a streamed fenced code block through HighlightedCodeBlock", async ({ page }) => {
    test.setTimeout(120_000);
    const workspace = await seedMockAgentWorkspace({
      repoPrefix: "highlight-fence-",
      title: "Highlight fence",
      model: "one-minute-stream",
    });
    try {
      await openAgentRoute(page, { cwd: workspace.cwd, agentId: workspace.agentId });
      await expectComposerEditable(page);

      // Mock "stream a code fence" mode drains a short queue ending on a fenced
      // TypeScript block — the same observable the desktop Slice E gate asserts.
      await submitMessage(page, "Stream a code fence for highlight cache.");
      await awaitAssistantMessage(page, /NEAR_BOTTOM_PX/);

      await expect(page.getByText("const anchorRef = useRef<FlatList>(null);")).toBeVisible({
        timeout: 30_000,
      });
      await expect(page.getByText("const NEAR_BOTTOM_PX = 160;")).toBeVisible({
        timeout: 15_000,
      });
    } finally {
      await workspace.cleanup();
    }
  });
});
