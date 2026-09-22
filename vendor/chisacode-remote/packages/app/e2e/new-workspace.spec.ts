import { buildHostWorkspaceRoute } from "@/utils/host-routes";
import { expect, test } from "./fixtures";
import { composerInput, gotoAppShell } from "./helpers/app";
import {
  archiveWorkspaceFromDaemon,
  archiveLocalWorkspaceFromDaemon,
  assertNewWorkspaceSidebarAndHeader,
  clickNewWorkspaceButton,
  closeBranchPicker,
  connectNewWorkspaceDaemonClient,
  createWorktreeViaDaemon,
  delayBrowserAgentCreatedStatus,
  expectComposerGithubAttachmentPill,
  expectPickerClosed,
  expectPickerOpen,
  expectPickerSelected,
  expectStartingRefPickerTriggerPr,
  openBranchPicker,
  openNewWorkspaceComposer,
  openProjectViaDaemon,
  openStartingRefPicker,
  selectBranchInPicker,
  selectGitHubPrInPicker,
  selectPickerOptionByKeyboard,
} from "./helpers/new-workspace";
import { createTempGitRepo, readWorktreeBranchInfo } from "./helpers/workspace";
import { getServerId } from "./helpers/server-id";
import {
  expectNewWorkspaceHeader,
  expectSidebarThreadActive,
  expectWorkspaceHeader,
  switchAgentViaSidebar,
  waitForSidebarHydration,
  waitForThreadInSidebar,
} from "./helpers/workspace-ui";
import { createIdleAgent } from "./helpers/archive-tab";
import { hasGithubAuth } from "./helpers/github-fixtures";

test.describe("New workspace flow", () => {
  let client: Awaited<ReturnType<typeof connectNewWorkspaceDaemonClient>>;
  const localWorkspaceIds = new Set<string>();
  const createdWorktreeIds = new Set<string>();

  test.describe.configure({ timeout: 240_000 });

  test.beforeEach(async () => {
    client = await connectNewWorkspaceDaemonClient();
  });

  test.afterEach(async () => {
    if (client) {
      for (const workspaceId of createdWorktreeIds) {
        await archiveWorkspaceFromDaemon(client, workspaceId).catch(() => undefined);
      }
      for (const workspaceId of localWorkspaceIds) {
        await archiveLocalWorkspaceFromDaemon(client, workspaceId).catch(() => undefined);
      }
    }
    createdWorktreeIds.clear();
    localWorkspaceIds.clear();
    await client?.close().catch(() => undefined);
  });

  test("sidebar workspace navigation updates URL and header", async ({ page }) => {
    const firstRepo = await createTempGitRepo("workspace-nav-a-");
    const secondRepo = await createTempGitRepo("workspace-nav-b-");
    try {
      const firstWorkspace = await openProjectViaDaemon(client, firstRepo.path);
      const secondWorkspace = await openProjectViaDaemon(client, secondRepo.path);
      localWorkspaceIds.add(firstWorkspace.workspaceId);
      localWorkspaceIds.add(secondWorkspace.workspaceId);
      const firstAgentTitle = `workspace-nav-a-${Date.now()}`;
      const secondAgentTitle = `workspace-nav-b-${Date.now()}`;
      const firstAgent = await createIdleAgent(client, {
        cwd: firstRepo.path,
        title: firstAgentTitle,
      });
      const secondAgent = await createIdleAgent(client, {
        cwd: secondRepo.path,
        title: secondAgentTitle,
      });
      await gotoAppShell(page);
      await waitForSidebarHydration(page);
      await switchAgentViaSidebar(page, firstAgent.id);
      await expectWorkspaceHeader(page, {
        title: firstAgentTitle,
        subtitle: firstWorkspace.projectDisplayName,
      });
      await switchAgentViaSidebar(page, secondAgent.id);
      await waitForThreadInSidebar(page, secondAgent.id);
      await expectWorkspaceHeader(page, {
        title: secondAgentTitle,
        subtitle: secondWorkspace.projectDisplayName,
      });
      await switchAgentViaSidebar(page, firstAgent.id);
      await expectWorkspaceHeader(page, {
        title: firstAgentTitle,
        subtitle: firstWorkspace.projectDisplayName,
      });
    } finally {
      await secondRepo.cleanup();
      await firstRepo.cleanup();
    }
  });

  test("same-project workspaces switch content without requiring refresh", async ({ page }) => {
    const repo = await createTempGitRepo("workspace-nav-same-project-");
    try {
      const rootWorkspace = await openProjectViaDaemon(client, repo.path);
      const worktreeWorkspace = await createWorktreeViaDaemon(client, {
        cwd: repo.path,
        slug: `nav-${Date.now()}`,
      });
      localWorkspaceIds.add(rootWorkspace.workspaceId);
      createdWorktreeIds.add(worktreeWorkspace.workspaceId);
      const rootAgentTitle = `workspace-nav-root-${Date.now()}`;
      const worktreeAgentTitle = `workspace-nav-worktree-${Date.now()}`;
      const rootAgent = await createIdleAgent(client, {
        cwd: repo.path,
        title: rootAgentTitle,
      });
      const worktreeAgent = await createIdleAgent(client, {
        cwd: worktreeWorkspace.workspaceDirectory,
        title: worktreeAgentTitle,
      });
      await gotoAppShell(page);
      await waitForSidebarHydration(page);
      await switchAgentViaSidebar(page, rootAgent.id);
      await expectWorkspaceHeader(page, {
        title: rootAgentTitle,
        subtitle: rootWorkspace.projectDisplayName,
      });
      await expectSidebarThreadActive({ page, agentId: rootAgent.id });
      await switchAgentViaSidebar(page, worktreeAgent.id);
      await expectWorkspaceHeader(page, {
        title: worktreeAgentTitle,
        subtitle: worktreeWorkspace.projectDisplayName,
      });
      await expectSidebarThreadActive({ page, agentId: worktreeAgent.id });
      await expectSidebarThreadActive({ page, agentId: rootAgent.id, selected: false });
      await switchAgentViaSidebar(page, rootAgent.id);
      await expectWorkspaceHeader(page, {
        title: rootAgentTitle,
        subtitle: rootWorkspace.projectDisplayName,
      });
      await expectSidebarThreadActive({ page, agentId: rootAgent.id });
      await expectSidebarThreadActive({ page, agentId: worktreeAgent.id, selected: false });
    } finally {
      await repo.cleanup();
    }
  });

  test("clicking new workspace redirects, renders header, shows sidebar row, and keeps one agent tab", async ({
    page,
  }) => {
    const serverId = getServerId();
    const tempRepo = await createTempGitRepo("new-workspace-entry-");
    try {
      const openedProject = await openProjectViaDaemon(client, tempRepo.path);
      localWorkspaceIds.add(openedProject.workspaceId);
      const openedAgentTitle = `new-workspace-entry-${Date.now()}`;
      const openedAgent = await createIdleAgent(client, {
        cwd: tempRepo.path,
        title: openedAgentTitle,
      });
      await gotoAppShell(page);
      await waitForSidebarHydration(page);
      await switchAgentViaSidebar(page, openedAgent.id);
      await expectWorkspaceHeader(page, {
        title: openedAgentTitle,
        subtitle: openedProject.projectDisplayName,
      });
      await clickNewWorkspaceButton(page, {
        workspaceDirectory: openedProject.workspaceDirectory,
      });
      const createdWorkspace = await assertNewWorkspaceSidebarAndHeader(page, {
        serverId,
        previousWorkspaceId: openedProject.workspaceId,
        previousAgentIds: [openedAgent.id],
        projectDisplayName: openedProject.projectDisplayName,
      });
      createdWorktreeIds.add(createdWorkspace.workspaceId);
      expect(createdWorkspace.workspaceId).not.toBe(openedProject.workspaceId);
      await expect(page).toHaveURL(
        buildHostWorkspaceRoute(serverId, createdWorkspace.workspaceId),
        {
          timeout: 30_000,
        },
      );
      await expectNewWorkspaceHeader(page, openedProject.projectDisplayName);
    } finally {
      await tempRepo.cleanup();
    }
  });

  test("redirects to the optimistic draft tab before agent creation resolves", async ({ page }) => {
    const serverId = getServerId();
    const tempRepo = await createTempGitRepo("new-workspace-optimistic-");
    const agentCreatedDelay = await delayBrowserAgentCreatedStatus(page);
    try {
      const openedProject = await openProjectViaDaemon(client, tempRepo.path);
      localWorkspaceIds.add(openedProject.workspaceId);
      const openedAgentTitle = `new-workspace-optimistic-${Date.now()}`;
      const openedAgent = await createIdleAgent(client, {
        cwd: tempRepo.path,
        title: openedAgentTitle,
      });
      await gotoAppShell(page);
      await waitForSidebarHydration(page);
      await switchAgentViaSidebar(page, openedAgent.id);
      await expectWorkspaceHeader(page, {
        title: openedAgentTitle,
        subtitle: openedProject.projectDisplayName,
      });
      await openNewWorkspaceComposer(page, {
        workspaceDirectory: openedProject.workspaceDirectory,
      });
      const composer = composerInput(page);
      await expect(composer).toBeVisible({ timeout: 30_000 });
      await composer.fill("Hello from e2e");
      const createButton = page
        .getByTestId("message-input-root")
        .getByRole("button", { name: /^(Create|创建)$/ });
      await expect(createButton).toBeVisible({ timeout: 30_000 });
      await createButton.click();
      await agentCreatedDelay.waitForCreateRequest();
      await agentCreatedDelay.waitForDelayedCreatedStatus();
      const createdWorkspace = await assertNewWorkspaceSidebarAndHeader(page, {
        serverId,
        previousWorkspaceId: openedProject.workspaceId,
        previousAgentIds: [openedAgent.id],
        projectDisplayName: openedProject.projectDisplayName,
      });
      createdWorktreeIds.add(createdWorkspace.workspaceId);
      await expect(page).toHaveURL(
        buildHostWorkspaceRoute(serverId, createdWorkspace.workspaceId),
        {
          timeout: 30_000,
        },
      );
      await expect(composerInput(page)).toBeVisible({ timeout: 30_000 });
      agentCreatedDelay.release();
      await expect(page.getByText("Hello from e2e", { exact: true }).first()).toBeVisible({
        timeout: 30_000,
      });
    } finally {
      agentCreatedDelay.release();
      await tempRepo.cleanup();
    }
  });

  test("selected branch becomes the base of a new workspace worktree", async ({ page }) => {
    const serverId = getServerId();
    const tempRepo = await createTempGitRepo("new-workspace-ref-", { branches: ["main", "dev"] });
    try {
      const openedProject = await openProjectViaDaemon(client, tempRepo.path);
      localWorkspaceIds.add(openedProject.workspaceId);
      const openedAgentTitle = `new-workspace-ref-${Date.now()}`;
      const openedAgent = await createIdleAgent(client, {
        cwd: tempRepo.path,
        title: openedAgentTitle,
      });
      await gotoAppShell(page);
      await waitForSidebarHydration(page);
      await switchAgentViaSidebar(page, openedAgent.id);
      await expectWorkspaceHeader(page, {
        title: openedAgentTitle,
        subtitle: openedProject.projectDisplayName,
      });
      await openNewWorkspaceComposer(page, {
        workspaceDirectory: openedProject.workspaceDirectory,
      });
      await openStartingRefPicker(page);
      await selectBranchInPicker(page, "dev");
      const composer = composerInput(page);
      await expect(composer).toBeVisible({ timeout: 30_000 });
      await composer.fill("Hello from e2e branch");
      const createButton = page
        .getByTestId("message-input-root")
        .getByRole("button", { name: /^(Create|创建)$/ });
      await expect(createButton).toBeVisible({ timeout: 30_000 });
      await createButton.click();
      const createdWorkspace = await assertNewWorkspaceSidebarAndHeader(page, {
        serverId,
        previousWorkspaceId: openedProject.workspaceId,
        previousAgentIds: [openedAgent.id],
        projectDisplayName: openedProject.projectDisplayName,
      });
      createdWorktreeIds.add(createdWorkspace.workspaceId);
      const branchInfo = await readWorktreeBranchInfo({
        worktreePath: createdWorkspace.workspaceId,
      });
      expect(branchInfo.currentBranch).not.toBeNull();
    } finally {
      await tempRepo.cleanup();
    }
  });

  test("branch picker opens via keyboard, navigates options, and selects on Enter", async ({
    page,
  }) => {
    const tempRepo = await createTempGitRepo("picker-keyboard-", { branches: ["main", "dev"] });
    try {
      const openedProject = await openProjectViaDaemon(client, tempRepo.path);
      localWorkspaceIds.add(openedProject.workspaceId);
      await gotoAppShell(page);
      await waitForSidebarHydration(page);
      await openNewWorkspaceComposer(page, {
        workspaceDirectory: openedProject.workspaceDirectory,
      });
      await openBranchPicker(page);
      await expectPickerOpen(page);
      await selectPickerOptionByKeyboard(page, "dev");
      await expectPickerSelected(page, "dev");
      await expectPickerClosed(page);
    } finally {
      await tempRepo.cleanup();
    }
  });

  test("branch picker closes on Escape without selecting an option", async ({ page }) => {
    const tempRepo = await createTempGitRepo("picker-escape-", { branches: ["main", "dev"] });
    try {
      const openedProject = await openProjectViaDaemon(client, tempRepo.path);
      localWorkspaceIds.add(openedProject.workspaceId);
      await gotoAppShell(page);
      await waitForSidebarHydration(page);
      await openNewWorkspaceComposer(page, {
        workspaceDirectory: openedProject.workspaceDirectory,
      });
      await openBranchPicker(page);
      await expectPickerOpen(page);
      await closeBranchPicker(page);
      await expectPickerClosed(page);
    } finally {
      await tempRepo.cleanup();
    }
  });

  test("selected GitHub PR shows PR context in the trigger and composer", async ({ page }) => {
    if (!hasGithubAuth()) {
      test.skip(true, "GitHub auth not available in this environment");
    }
    const tempRepo = await createTempGitRepo("new-workspace-pr-ref-");
    try {
      const openedProject = await openProjectViaDaemon(client, tempRepo.path);
      localWorkspaceIds.add(openedProject.workspaceId);
      await gotoAppShell(page);
      await waitForSidebarHydration(page);
      await openNewWorkspaceComposer(page, {
        workspaceDirectory: openedProject.workspaceDirectory,
      });
      await openStartingRefPicker(page);
      await selectGitHubPrInPicker(page, 515);
      await expectStartingRefPickerTriggerPr(page, {
        number: 515,
        title: "Review selected start ref",
        headRef: "feature/start-from-pr",
      });
      await expectComposerGithubAttachmentPill(page, {
        number: 515,
        title: "Review selected start ref",
      });
    } finally {
      await tempRepo.cleanup();
    }
  });
});
