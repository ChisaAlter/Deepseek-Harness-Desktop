import type {
  PermissionOption,
  RequestPermissionRequest,
  ToolCallUpdate,
} from "@agentclientprotocol/sdk";
import { describe, expect, test } from "vitest";

import {
  mapACPPermissionRequest,
  mapACPPlanToTimeline,
  mapACPToolDetail,
  mapACPToolSnapshotToTimeline,
  mergeACPToolSnapshot,
  selectACPPermissionOption,
  type ACPToolSnapshot,
} from "./tool-call-mapper.js";

describe("ACP tool call mapper", () => {
  test("merges partial tool updates without dropping prior fields", () => {
    const previous: ACPToolSnapshot = {
      toolCallId: "tool-1",
      title: "Run command",
      kind: "execute",
      status: "pending",
      rawInput: { command: "npm", args: ["test"] },
    };

    expect(
      mergeACPToolSnapshot(
        "tool-1",
        { status: "completed", rawOutput: { output: "ok" } } as ToolCallUpdate,
        previous,
      ),
    ).toEqual({
      ...previous,
      status: "completed",
      content: null,
      locations: null,
      rawOutput: { output: "ok" },
    });
  });

  test("maps read tool content and range metadata", () => {
    expect(
      mapACPToolDetail({
        toolCallId: "read-1",
        title: "Read file",
        kind: "read",
        status: "completed",
        content: [{ type: "content", content: { type: "text", text: "const value = 1;" } }],
        rawInput: { path: "src/value.ts", offset: 4, limit: 20 },
      }),
    ).toEqual({
      type: "read",
      filePath: "src/value.ts",
      content: "const value = 1;",
      offset: 4,
      limit: 20,
    });
  });

  test("maps tracked terminal output into shell timeline details", () => {
    const snapshot: ACPToolSnapshot = {
      toolCallId: "shell-1",
      title: "Run tests",
      kind: "execute",
      status: "completed",
      content: [{ type: "terminal", terminalId: "terminal-1" }],
      rawInput: { command: "npm", args: ["test"], cwd: "/repo" },
    };
    const terminals = new Map([["terminal-1", { output: "passed\n", exit: { exitCode: 0 } }]]);

    expect(mapACPToolSnapshotToTimeline(snapshot, terminals)).toMatchObject({
      type: "tool_call",
      callId: "shell-1",
      status: "completed",
      detail: {
        type: "shell",
        command: "npm test",
        cwd: "/repo",
        output: "passed\n",
        exitCode: 0,
      },
    });
  });

  test("preserves ACP failure messages", () => {
    expect(
      mapACPToolSnapshotToTimeline(
        {
          toolCallId: "failed-1",
          title: "Fetch data",
          kind: "fetch",
          status: "failed",
          rawInput: { url: "https://example.com" },
          rawOutput: { message: "request failed" },
        },
        new Map(),
      ),
    ).toMatchObject({
      status: "failed",
      error: { message: "request failed" },
    });
  });

  test("maps plans and permission requests to shared contracts", () => {
    expect(
      mapACPPlanToTimeline({
        entries: [
          { content: "Inspect code", priority: "high", status: "completed" },
          { content: "Apply fix", priority: "medium", status: "pending" },
        ],
      }),
    ).toEqual({
      type: "todo",
      items: [
        { text: "Inspect code", completed: true },
        { text: "Apply fix", completed: false },
      ],
    });

    const options: PermissionOption[] = [
      { optionId: "allow-once", name: "Allow", kind: "allow_once" },
      { optionId: "reject-once", name: "Reject", kind: "reject_once" },
    ];
    const params = {
      sessionId: "session-1",
      toolCall: {
        toolCallId: "edit-1",
        title: "Edit file",
        kind: "edit",
        status: "pending",
      },
      options,
    } satisfies RequestPermissionRequest;
    const request = mapACPPermissionRequest("kimi", "permission-1", params, {
      toolCallId: "edit-1",
      title: "Edit file",
      kind: "edit",
      status: "pending",
      rawInput: { path: "src/app.ts" },
    });

    expect(request).toMatchObject({
      id: "permission-1",
      provider: "kimi",
      kind: "tool",
      title: "Edit file",
      detail: { type: "edit", filePath: "src/app.ts" },
    });
    expect(selectACPPermissionOption(options, { behavior: "allow" })?.optionId).toBe("allow-once");
    expect(selectACPPermissionOption(options, { behavior: "deny" })?.optionId).toBe("reject-once");
  });
});
