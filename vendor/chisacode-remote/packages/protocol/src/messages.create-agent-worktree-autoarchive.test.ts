import { describe, expect, test } from "vitest";

import { readAgentRelation } from "./agent-labels.js";
import { SessionInboundMessageSchema } from "./messages.js";

describe("create_agent_request worktree and autoArchive fields", () => {
  test("accepts optional worktree branch-off target and autoArchive", () => {
    const parsed = SessionInboundMessageSchema.parse({
      type: "create_agent_request",
      requestId: "create-agent-worktree",
      config: {
        provider: "codex",
        cwd: "/repo/app",
      },
      worktree: {
        mode: "branch-off",
        newBranch: "agent-lifecycle-dispatch",
        base: "main",
      },
      autoArchive: true,
      relationKind: "handoff",
    });

    expect(parsed).toEqual({
      type: "create_agent_request",
      requestId: "create-agent-worktree",
      config: {
        provider: "codex",
        cwd: "/repo/app",
      },
      worktree: {
        mode: "branch-off",
        newBranch: "agent-lifecycle-dispatch",
        base: "main",
      },
      autoArchive: true,
      relationKind: "handoff",
      labels: {},
    });
  });

  test("keeps legacy create_agent_request defaults unchanged", () => {
    const parsed = SessionInboundMessageSchema.parse({
      type: "create_agent_request",
      requestId: "legacy-create-agent",
      config: {
        provider: "codex",
        cwd: "/repo/app",
      },
    });

    expect(parsed).toEqual({
      type: "create_agent_request",
      requestId: "legacy-create-agent",
      config: {
        provider: "codex",
        cwd: "/repo/app",
      },
      labels: {},
    });
  });

  test("derives a legacy subagent relation from the parent label", () => {
    expect(
      readAgentRelation({
        "chisacode.parent-agent-id": " parent-agent ",
      }),
    ).toEqual({
      kind: "subagent",
      parentAgentId: "parent-agent",
    });
  });

  test("merges compatibility labels into partial relation records", () => {
    expect(
      readAgentRelation(
        {
          "chisacode.parent-agent-id": "parent-agent",
          "chisacode.delegation-task-id": "task-1",
        },
        {
          kind: "handoff",
          source: "mcp",
        },
      ),
    ).toEqual({
      kind: "handoff",
      parentAgentId: "parent-agent",
      taskId: "task-1",
      source: "mcp",
    });
  });
});
