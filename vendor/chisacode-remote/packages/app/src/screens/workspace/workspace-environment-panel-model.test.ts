import { describe, expect, it } from "vitest";
import type { AgentToolCallItem, TodoEntry, TodoListItem } from "@/types/stream";
import {
  buildWorkspaceActivityItems,
  buildWorkspaceReviewCalloutModel,
  buildWorkspaceStatusStripAccessibilityLabel,
  buildWorkspaceStatusStripModel,
  buildWorkspacePullRequestPills,
  buildPullRequestLabel,
  buildTodoProgressSummary,
  findLatestTodoItems,
  parsePlanMarkdownToProgressItems,
  resolveAgentProgress,
  shouldEnableWorkspaceReviewArchiveAction,
  type WorkspacePullRequestRuntime,
} from "./workspace-environment-panel-model";
import type { Agent, WorkspaceDescriptor } from "@/stores/session-store";

const basePullRequest: WorkspacePullRequestRuntime = {
  url: "https://github.com/example/repo/pull/42",
  title: "Add cool feature",
  state: "open",
  baseRefName: "main",
  headRefName: "feat/cool",
  isMerged: false,
  mergeable: "MERGEABLE",
  checksStatus: "success",
  reviewDecision: "approved",
};

const baseWorkspace: WorkspaceDescriptor = {
  id: "workspace-1",
  projectId: "project-1",
  projectDisplayName: "ChisaCode",
  projectRootPath: "/repo",
  workspaceDirectory: "/repo/worktree",
  projectKind: "git",
  workspaceKind: "worktree",
  name: "feature/work",
  status: "running",
  archivingAt: null,
  diffStat: null,
  scripts: [],
};

const baseAgent: Pick<
  Agent,
  "status" | "pendingPermissions" | "title" | "runtimeInfo" | "persistence"
> = {
  status: "idle",
  pendingPermissions: [],
  title: "Ship the workspace flow",
  runtimeInfo: undefined,
  persistence: null,
};

describe("buildPullRequestLabel", () => {
  it("prepends the PR number when present", () => {
    expect(buildPullRequestLabel({ ...basePullRequest, number: 42 })).toBe("#42 Add cool feature");
  });

  it("falls back to the title when the number is missing", () => {
    expect(buildPullRequestLabel({ ...basePullRequest, number: undefined })).toBe(
      "Add cool feature",
    );
  });

  it("ignores invalid pull request numbers", () => {
    expect(buildPullRequestLabel({ ...basePullRequest, number: -1 })).toBe("Add cool feature");
    expect(buildPullRequestLabel({ ...basePullRequest, number: 4.2 })).toBe("Add cool feature");
  });

  it("normalizes blank pull request titles", () => {
    expect(buildPullRequestLabel({ ...basePullRequest, title: "   ", number: 42 })).toBe(
      "#42 Pull request",
    );
  });
});

function todoEntry(text: string, completed: boolean): TodoEntry {
  return { text, completed };
}

function todoListItem(items: TodoEntry[], timestamp: number): TodoListItem {
  return {
    kind: "todo_list",
    id: `todo-${timestamp}-${items.length}`,
    timestamp: new Date(timestamp),
    provider: "claude",
    items,
  };
}

describe("findLatestTodoItems", () => {
  it("returns null when no todo list is present", () => {
    expect(findLatestTodoItems({ head: [], tail: [] })).toBeNull();
  });

  it("returns the tail items when head has no todo", () => {
    const tail = todoListItem([todoEntry("Investigate", true)], 1_000);
    expect(findLatestTodoItems({ head: [], tail: [tail] })).toBe(tail.items);
  });

  it("prefers the most recent timestamp between head and tail", () => {
    const head = todoListItem([todoEntry("Head", false)], 2_000);
    const tail = todoListItem([todoEntry("Tail", true)], 1_000);
    expect(findLatestTodoItems({ head: [head], tail: [tail] })).toBe(head.items);
  });

  it("uses the tail when its todo is the most recent", () => {
    const head = todoListItem([todoEntry("Head", false)], 1_000);
    const tail = todoListItem([todoEntry("Tail", true)], 2_000);
    expect(findLatestTodoItems({ head: [head], tail: [tail] })).toBe(tail.items);
  });

  it("does not let invalid todo timestamps hide newer valid updates", () => {
    const head = todoListItem([todoEntry("Invalid head", false)], Number.NaN);
    const tail = todoListItem([todoEntry("Valid tail", true)], 2_000);

    expect(findLatestTodoItems({ head: [head], tail: [tail] })).toBe(tail.items);
  });
});

describe("buildTodoProgressSummary", () => {
  it("returns null when no items are provided", () => {
    expect(buildTodoProgressSummary(null)).toBeNull();
    expect(buildTodoProgressSummary([])).toBeNull();
  });

  it("computes progress and respects max visible items", () => {
    const items = [
      todoEntry("First", true),
      todoEntry("Second", false),
      todoEntry("Third", true),
      todoEntry("Fourth", false),
    ];
    const summary = buildTodoProgressSummary(items, 2);
    expect(summary).toEqual({
      completedCount: 2,
      totalCount: 4,
      progress: 0.5,
      visibleItems: [items[0], items[1]],
      hiddenCount: 2,
    });
  });

  it("treats every item as visible when count is below the cap", () => {
    const items = [todoEntry("First", true)];
    const summary = buildTodoProgressSummary(items, 5);
    expect(summary?.hiddenCount).toBe(0);
    expect(summary?.progress).toBe(1);
  });
});

function planToolCall(text: string, timestamp: number): AgentToolCallItem {
  return {
    kind: "tool_call",
    id: `plan-${timestamp}`,
    timestamp: new Date(timestamp),
    payload: {
      source: "agent",
      data: {
        provider: "codex",
        callId: `plan-call-${timestamp}`,
        name: "plan",
        status: "completed",
        error: null,
        detail: { type: "plan", text },
      },
    },
  };
}

describe("parsePlanMarkdownToProgressItems", () => {
  it("parses bullets, numbered steps, and checkboxes", () => {
    const items = parsePlanMarkdownToProgressItems(
      ["# Login", "- [x] Design form", "- Wire auth", "1. Add tests"].join("\n"),
    );
    expect(items.map((item) => ({ text: item.text, completed: item.completed }))).toEqual([
      { text: "Design form", completed: true },
      { text: "Wire auth", completed: false },
      { text: "Add tests", completed: false },
    ]);
  });

  it("returns empty when the plan has no list steps", () => {
    expect(parsePlanMarkdownToProgressItems("Just a prose paragraph.")).toEqual([]);
  });
});

describe("resolveAgentProgress", () => {
  it("returns null when the agent has no todos or plans", () => {
    expect(resolveAgentProgress({ head: [], tail: [] })).toBeNull();
  });

  it("uses Claude-style todo_list items", () => {
    const todos = todoListItem([todoEntry("Ship UI", false), todoEntry("Tests", true)], 1_000);
    const model = resolveAgentProgress({ head: [], tail: [todos] });
    expect(model?.source).toBe("todo_list");
    expect(model?.completedCount).toBe(1);
    expect(model?.totalCount).toBe(2);
    expect(model?.visibleItems.map((item) => item.text)).toEqual(["Ship UI", "Tests"]);
  });

  it("uses Codex-style plan tool calls when no todo list exists", () => {
    const plan = planToolCall("- Outline\n- Implement\n- Verify", 2_000);
    const model = resolveAgentProgress({ head: [plan], tail: [] });
    expect(model?.source).toBe("plan");
    expect(model?.totalCount).toBe(3);
    expect(model?.visibleItems.map((item) => item.text)).toEqual([
      "Outline",
      "Implement",
      "Verify",
    ]);
  });

  it("prefers the newer progress source between todos and plans", () => {
    const todos = todoListItem([todoEntry("Old todo", false)], 1_000);
    const plan = planToolCall("- Newer plan step", 3_000);
    const model = resolveAgentProgress({ head: [todos], tail: [plan] });
    expect(model?.source).toBe("plan");
    expect(model?.visibleItems[0]?.text).toBe("Newer plan step");
  });

  it("prefers a newer todo list over an older plan", () => {
    const plan = planToolCall("- Stale plan", 1_000);
    const todos = todoListItem([todoEntry("Fresh todo", true)], 4_000);
    const model = resolveAgentProgress({ head: [plan, todos], tail: [] });
    expect(model?.source).toBe("todo_list");
    expect(model?.visibleItems[0]?.text).toBe("Fresh todo");
  });
});

describe("buildWorkspaceStatusStripModel", () => {
  it("summarizes agent, changes, PR, and todos", () => {
    const model = buildWorkspaceStatusStripModel({
      activeAgent: { ...baseAgent, status: "running", pendingPermissions: [{} as never] },
      workspace: {
        ...baseWorkspace,
        diffStat: { additions: 12, deletions: 3 },
        githubRuntime: { pullRequest: { ...basePullRequest, checksStatus: "pending" } },
      },
      todoItems: [todoEntry("First", true), todoEntry("Second", false)],
    });

    expect(model.taskTitle).toBe("Ship the workspace flow");
    expect(model.items.map((item) => item.key)).toEqual([
      "agent",
      "permissions",
      "changes",
      "pr",
      "todos",
    ]);
    expect(model.items.find((item) => item.key === "agent")).toMatchObject({
      labelKey: "workspace.environment.agentStatus.running",
    });
    expect(model.items.find((item) => item.key === "permissions")).toMatchObject({
      labelKey: "workspace.statusStrip.pendingPermissions",
      labelParams: { count: 1 },
    });
    expect(model.items.find((item) => item.key === "pr")).toMatchObject({
      labelKey: "workspace.pullRequestStatus.checksPending",
    });
    expect(model.items.find((item) => item.key === "todos")).toMatchObject({
      labelKey: "workspace.statusStrip.todoProgress",
      labelParams: { completed: 1, total: 2 },
    });
    expect(model.hasActionableState).toBe(true);
  });

  it("falls back to branch when there is no agent title", () => {
    const model = buildWorkspaceStatusStripModel({
      activeAgent: null,
      workspace: { ...baseWorkspace, name: "" },
      currentBranchName: "feature/status-strip",
    });
    expect(model.taskTitle).toBe("feature/status-strip");
    expect(model.items).toEqual([
      { key: "branch", label: "feature/status-strip", tone: "neutral" },
    ]);
  });

  it("keeps a neutral workspace status when there is no actionable state", () => {
    const model = buildWorkspaceStatusStripModel({
      activeAgent: null,
      workspace: { ...baseWorkspace, name: "Clean workspace" },
      currentBranchName: null,
    });

    expect(model.taskTitle).toBe("Clean workspace");
    expect(model.items).toEqual([
      {
        key: "workspace",
        label: "Workspace ready",
        labelKey: "workspace.statusStrip.workspaceReady",
        tone: "neutral",
      },
    ]);
    expect(model.hasActionableState).toBe(false);
  });

  it("ignores blank branch names when choosing a status fallback", () => {
    const model = buildWorkspaceStatusStripModel({
      activeAgent: null,
      workspace: { ...baseWorkspace, name: "Clean workspace" },
      currentBranchName: "   ",
    });

    expect(model.items.map((item) => item.key)).toEqual(["workspace"]);
  });

  it("marks blocked pull request status as actionable", () => {
    const model = buildWorkspaceStatusStripModel({
      activeAgent: { ...baseAgent, status: "idle" },
      workspace: {
        ...baseWorkspace,
        githubRuntime: {
          pullRequest: {
            ...basePullRequest,
            checksStatus: "failure",
            reviewDecision: "changes_requested",
          },
        },
      },
    });

    expect(model.items.find((item) => item.key === "pr")).toMatchObject({
      labelKey: "workspace.pullRequestStatus.checksFailed",
      tone: "danger",
    });
    expect(model.hasActionableState).toBe(true);
  });

  it("lets pull request terminal states override stale checks and review tones", () => {
    const merged = buildWorkspaceStatusStripModel({
      activeAgent: null,
      workspace: {
        ...baseWorkspace,
        githubRuntime: {
          pullRequest: {
            ...basePullRequest,
            isMerged: true,
            checksStatus: "failure",
            reviewDecision: "changes_requested",
          },
        },
      },
    });
    const closed = buildWorkspaceStatusStripModel({
      activeAgent: null,
      workspace: {
        ...baseWorkspace,
        githubRuntime: {
          pullRequest: {
            ...basePullRequest,
            state: "closed",
            checksStatus: "pending",
            reviewDecision: "pending",
          },
        },
      },
    });

    expect(merged.items.find((item) => item.key === "pr")).toMatchObject({
      labelKey: "workspace.pullRequestStatus.merged",
      tone: "success",
    });
    expect(merged.hasActionableState).toBe(false);
    expect(closed.items.find((item) => item.key === "pr")).toMatchObject({
      labelKey: "workspace.pullRequestStatus.closed",
      tone: "neutral",
    });
    expect(closed.hasActionableState).toBe(false);
  });

  it("normalizes invalid diff stats in the status strip", () => {
    const model = buildWorkspaceStatusStripModel({
      activeAgent: null,
      workspace: {
        ...baseWorkspace,
        diffStat: { additions: Number.POSITIVE_INFINITY, deletions: 2.8 },
      },
    });

    expect(model.items.find((item) => item.key === "changes")).toMatchObject({
      label: "+0 -2",
    });
  });
});

describe("buildWorkspaceStatusStripAccessibilityLabel", () => {
  it("omits empty translated item labels", () => {
    const label = buildWorkspaceStatusStripAccessibilityLabel({
      actionLabel: "Open workspace status",
      taskTitle: "Ship status polish",
      itemLabels: ["Running", " ", "", "Checks pending"],
    });

    expect(label).toBe("Open workspace status: Ship status polish, Running, Checks pending");
  });

  it("falls back to the action label when every detail is empty", () => {
    const label = buildWorkspaceStatusStripAccessibilityLabel({
      actionLabel: " ",
      taskTitle: " ",
      itemLabels: ["", "   "],
    });

    expect(label).toBe("Open workspace status");
  });
});

describe("buildWorkspaceReviewCalloutModel", () => {
  it("shows review callout when an idle agent has changes", () => {
    const model = buildWorkspaceReviewCalloutModel({
      activeAgent: {
        ...baseAgent,
        runtimeInfo: {
          provider: "codex",
          sessionId: "session-1",
        },
      },
      workspace: { ...baseWorkspace, diffStat: { additions: 1, deletions: 2 } },
    });
    expect(model).toEqual({
      title: "Review completed work",
      titleKey: "workspace.reviewCallout.completedTitle",
      description: "+1 -2 changes",
      descriptionParts: [
        {
          key: "changes",
          label: "+1 -2 changes",
          labelKey: "workspace.reviewCallout.changeSummary",
          labelParams: { additions: 1, deletions: 2 },
        },
      ],
      showViewChanges: true,
      showOpenPullRequest: false,
      showCopyResume: false,
    });
  });

  it("adds pull request status to the localized review callout description", () => {
    const model = buildWorkspaceReviewCalloutModel({
      activeAgent: baseAgent,
      workspace: {
        ...baseWorkspace,
        diffStat: { additions: 1, deletions: 0 },
        githubRuntime: { pullRequest: { ...basePullRequest, checksStatus: "pending" } },
      },
    });

    expect(model?.descriptionParts).toEqual([
      {
        key: "changes",
        label: "+1 -0 changes",
        labelKey: "workspace.reviewCallout.changeSummary",
        labelParams: { additions: 1, deletions: 0 },
      },
      {
        key: "pr",
        label: "Checks pending",
        labelKey: "workspace.pullRequestStatus.checksPending",
      },
    ]);
  });

  it("normalizes invalid diff stats in the review callout", () => {
    const model = buildWorkspaceReviewCalloutModel({
      activeAgent: baseAgent,
      workspace: {
        ...baseWorkspace,
        diffStat: { additions: 3.9, deletions: Number.NaN },
      },
    });

    expect(model?.descriptionParts).toEqual([
      {
        key: "changes",
        label: "+3 -0 changes",
        labelKey: "workspace.reviewCallout.changeSummary",
        labelParams: { additions: 3, deletions: 0 },
      },
    ]);
  });

  it("uses the interrupted callout title key for errored agents", () => {
    const model = buildWorkspaceReviewCalloutModel({
      activeAgent: { ...baseAgent, status: "error" },
      workspace: { ...baseWorkspace, diffStat: { additions: 1, deletions: 0 } },
    });

    expect(model).toMatchObject({
      title: "Review interrupted work",
      titleKey: "workspace.reviewCallout.interruptedTitle",
    });
  });

  it("does not show review callout while agent is running", () => {
    expect(
      buildWorkspaceReviewCalloutModel({
        activeAgent: { ...baseAgent, status: "running" },
        workspace: { ...baseWorkspace, diffStat: { additions: 1, deletions: 0 } },
      }),
    ).toBeNull();
  });
});

describe("shouldEnableWorkspaceReviewArchiveAction", () => {
  it("enables archive action for git worktrees with local changes", () => {
    expect(
      shouldEnableWorkspaceReviewArchiveAction({
        workspace: { ...baseWorkspace, diffStat: { additions: 1, deletions: 0 } },
        workspaceDirectory: "/repo/worktree",
      }),
    ).toBe(true);
  });

  it("enables archive action for git worktrees with a pull request", () => {
    expect(
      shouldEnableWorkspaceReviewArchiveAction({
        workspace: { ...baseWorkspace, githubRuntime: { pullRequest: basePullRequest } },
        workspaceDirectory: "/repo/worktree",
      }),
    ).toBe(true);
  });

  it("requires a resolved workspace directory", () => {
    expect(
      shouldEnableWorkspaceReviewArchiveAction({
        workspace: { ...baseWorkspace, diffStat: { additions: 1, deletions: 0 } },
        workspaceDirectory: "",
      }),
    ).toBe(false);
  });

  it("does not enable archive for plain git workspaces", () => {
    expect(
      shouldEnableWorkspaceReviewArchiveAction({
        workspace: {
          ...baseWorkspace,
          workspaceKind: "local_checkout",
          diffStat: { additions: 1, deletions: 0 },
        },
        workspaceDirectory: "/repo",
      }),
    ).toBe(false);
  });

  it("does not enable archive for non-git workspaces", () => {
    expect(
      shouldEnableWorkspaceReviewArchiveAction({
        workspace: {
          ...baseWorkspace,
          projectKind: "directory",
          diffStat: { additions: 1, deletions: 0 },
        },
        workspaceDirectory: "/repo",
      }),
    ).toBe(false);
  });

  it("does not enable archive without reviewable work", () => {
    expect(
      shouldEnableWorkspaceReviewArchiveAction({
        workspace: baseWorkspace,
        workspaceDirectory: "/repo/worktree",
      }),
    ).toBe(false);
  });

  it("does not enable archive for invalid diff stats without real changes", () => {
    expect(
      shouldEnableWorkspaceReviewArchiveAction({
        workspace: {
          ...baseWorkspace,
          diffStat: { additions: -1, deletions: Number.NaN },
        },
        workspaceDirectory: "/repo/worktree",
      }),
    ).toBe(false);
  });
});

describe("buildWorkspaceActivityItems", () => {
  it("builds a compact recent activity list", () => {
    const items = buildWorkspaceActivityItems({
      activeAgent: { ...baseAgent, pendingPermissions: [{} as never] },
      workspace: {
        ...baseWorkspace,
        diffStat: { additions: 4, deletions: 0 },
        githubRuntime: { pullRequest: { ...basePullRequest, reviewDecision: "approved" } },
      },
      currentBranchName: "feature/activity",
    });
    expect(items.map((item) => item.key)).toEqual([
      "agent",
      "permissions",
      "changes",
      "pr",
      "branch",
    ]);
    expect(items.find((item) => item.key === "permissions")).toMatchObject({
      labelKey: "workspace.activity.pendingPermissions",
      labelParams: { count: 1 },
    });
    expect(items.find((item) => item.key === "agent")).toMatchObject({
      labelKey: "workspace.activity.agent.idle",
    });
    expect(items.find((item) => item.key === "pr")).toMatchObject({
      labelKey: "workspace.activity.pullRequest.approved",
    });
  });

  it("keeps a neutral activity item for clean workspaces", () => {
    const items = buildWorkspaceActivityItems({
      activeAgent: null,
      workspace: baseWorkspace,
      currentBranchName: null,
    });

    expect(items).toEqual([
      {
        key: "workspace",
        label: "Workspace ready",
        labelKey: "workspace.activity.workspaceReady",
        tone: "neutral",
      },
    ]);
  });

  it("normalizes invalid diff stats in recent activity", () => {
    const items = buildWorkspaceActivityItems({
      activeAgent: null,
      workspace: {
        ...baseWorkspace,
        diffStat: { additions: 4.6, deletions: Number.NEGATIVE_INFINITY },
      },
      currentBranchName: null,
    });

    expect(items.find((item) => item.key === "changes")).toMatchObject({
      label: "Workspace has +4 -0 changes",
      labelParams: { additions: 4, deletions: 0 },
    });
  });

  it("normalizes invalid activity item caps", () => {
    const baseInput = {
      activeAgent: { ...baseAgent, pendingPermissions: [{} as never] },
      workspace: {
        ...baseWorkspace,
        diffStat: { additions: 1, deletions: 0 },
      },
      currentBranchName: "feature/activity",
    };

    expect(buildWorkspaceActivityItems({ ...baseInput, maxItems: -1 })).toEqual([]);
    expect(
      buildWorkspaceActivityItems({ ...baseInput, maxItems: 2.8 }).map((item) => item.key),
    ).toEqual(["agent", "permissions"]);
    expect(
      buildWorkspaceActivityItems({
        ...baseInput,
        maxItems: Number.POSITIVE_INFINITY,
      }).map((item) => item.key),
    ).toEqual(["agent", "permissions", "changes", "branch"]);
  });
});

describe("buildWorkspacePullRequestPills", () => {
  it("builds checks and review pills for active pull requests", () => {
    expect(
      buildWorkspacePullRequestPills({
        ...basePullRequest,
        checksStatus: "failure",
        reviewDecision: "changes_requested",
      }),
    ).toEqual([
      {
        key: "checks",
        label: "Checks failed",
        labelKey: "workspace.environment.checksStatus.failure",
        tone: "danger",
      },
      {
        key: "review",
        label: "Changes requested",
        labelKey: "workspace.environment.reviewDecision.changes_requested",
        tone: "danger",
      },
    ]);
  });

  it("uses terminal pull request pills instead of stale checks and review state", () => {
    expect(
      buildWorkspacePullRequestPills({
        ...basePullRequest,
        isMerged: true,
        checksStatus: "failure",
        reviewDecision: "changes_requested",
      }),
    ).toEqual([
      {
        key: "pr-merged",
        label: "PR merged",
        labelKey: "workspace.pullRequestStatus.merged",
        tone: "success",
      },
    ]);
    expect(
      buildWorkspacePullRequestPills({
        ...basePullRequest,
        state: "closed",
        checksStatus: "pending",
        reviewDecision: "pending",
      }),
    ).toEqual([
      {
        key: "pr-closed",
        label: "PR closed",
        labelKey: "workspace.pullRequestStatus.closed",
        tone: "neutral",
      },
    ]);
  });
});
