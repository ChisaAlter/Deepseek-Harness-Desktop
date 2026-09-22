import { expect, test } from "./fixtures";
import { composerInput } from "./helpers/app";
import { clickNewChat, clickNewTerminal } from "./helpers/launcher";
import { captureWsSessionFrames } from "./helpers/rename";
import {
  expectTerminalSurfaceVisible,
  focusTerminalSurface,
  typeInTerminal,
  setupDeterministicPrompt,
  waitForTerminalContent,
} from "./helpers/terminal-perf";

interface CreateAgentFrame {
  initialPrompt: string | null;
  cwd: string | null;
}

function normalizePath(value: string): string {
  return value.replaceAll("\\", "/").replace(/\/$/, "").toLocaleLowerCase();
}

function cwdForPrompt(frames: CreateAgentFrame[], prompt: string): string | null {
  return frames.find((frame) => frame.initialPrompt === prompt)?.cwd ?? null;
}

test.describe("Workspace cwd correctness", () => {
  test("main checkout workspace opens terminals in the project root", async ({
    page,
    withWorkspace,
  }) => {
    test.setTimeout(60_000);

    const workspace = await withWorkspace({ prefix: "workspace-cwd-main-" });
    await workspace.navigateTo();
    await clickNewTerminal(page);

    await expectTerminalSurfaceVisible(page);
    await focusTerminalSurface(page);
    await setupDeterministicPrompt(page, `PWD_READY_${Date.now()}`);
    await typeInTerminal(page, "pwd\n");
    await waitForTerminalContent(page, (text) => text.includes(workspace.repoPath), 10_000);
  });

  test("draft tab creates an agent in the workspace cwd", async ({ page, withWorkspace }) => {
    test.setTimeout(60_000);

    const createAgentFrames = captureWsSessionFrames(page, "create_agent_request", (inner) => {
      const config = (inner.config ?? {}) as Record<string, unknown>;
      return {
        initialPrompt: typeof inner.initialPrompt === "string" ? inner.initialPrompt : null,
        cwd: typeof config.cwd === "string" ? config.cwd : null,
      };
    });

    const workspace = await withWorkspace({ prefix: "workspace-cwd-draft-agent-" });
    await workspace.navigateTo();

    await clickNewChat(page);
    const composer = composerInput(page);
    const message = `cwd draft create ${Date.now()}`;
    await expect(composer).toBeEditable({ timeout: 15_000 });
    await composer.fill(message);
    await composer.press("Enter");
    await expect(page.getByText(message, { exact: true }).first()).toBeVisible({
      timeout: 30_000,
    });

    await expect(page.locator('[data-testid^="agent-panel-"]').first()).toBeVisible({
      timeout: 30_000,
    });

    await expect
      .poll(
        () => {
          const cwd = cwdForPrompt(createAgentFrames, message);
          return cwd ? normalizePath(cwd) : null;
        },
        { timeout: 30_000 },
      )
      .toBe(normalizePath(workspace.repoPath));
  });

  test("worktree workspace opens terminals in the worktree directory", async ({
    page,
    withWorkspace,
  }) => {
    test.setTimeout(90_000);

    const workspace = await withWorkspace({ worktree: true, prefix: "workspace-cwd-worktree-" });
    await workspace.navigateTo();
    await clickNewTerminal(page);

    await expectTerminalSurfaceVisible(page);
    await focusTerminalSurface(page);
    await setupDeterministicPrompt(page, `PWD_READY_${Date.now()}`);
    await typeInTerminal(page, "pwd\n");
    await waitForTerminalContent(page, (text) => text.includes(workspace.repoPath), 10_000);
  });
});
