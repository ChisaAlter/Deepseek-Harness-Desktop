import { describe, expect, it } from "vitest";
import type { ConfirmDialogInput } from "@/utils/confirm-dialog";
import {
  requestArchiveSubagent,
  resolveArchiveSubagentDialog,
  type ArchiveSubagentDeps,
  type ResolveArchiveSubagentDialogInput,
} from "./archive-subagent";

interface RecordedArchive {
  serverId: string;
  agentId: string;
}

interface FakeArchiveSubagentEnv {
  deps: ArchiveSubagentDeps;
  recordedArchives: RecordedArchive[];
  recordedConfirmInputs: ConfirmDialogInput[];
  setSubagent(id: string, snapshot: ResolveArchiveSubagentDialogInput | undefined): void;
}

function createFakeEnv(
  options: {
    confirmResult?: boolean;
    initialSubagents?: Array<{ id: string; snapshot: ResolveArchiveSubagentDialogInput }>;
  } = {},
): FakeArchiveSubagentEnv {
  const subagents = new Map<string, ResolveArchiveSubagentDialogInput | undefined>();
  for (const entry of options.initialSubagents ?? []) {
    subagents.set(entry.id, entry.snapshot);
  }
  const recordedArchives: RecordedArchive[] = [];
  const recordedConfirmInputs: ConfirmDialogInput[] = [];

  return {
    recordedArchives,
    recordedConfirmInputs,
    setSubagent(id, snapshot) {
      subagents.set(id, snapshot);
    },
    deps: {
      getSubagent: (id) => subagents.get(id),
      confirm: async (dialog) => {
        recordedConfirmInputs.push(dialog);
        return options.confirmResult ?? false;
      },
      archiveAgent: async (input) => {
        recordedArchives.push(input);
      },
    },
  };
}

describe("resolveArchiveSubagentDialog", () => {
  it("uses running copy for running subagents", () => {
    expect(
      resolveArchiveSubagentDialog({
        title: "Review branch",
        status: "running",
      }),
    ).toEqual({
      title: "归档运行中的子智能体？",
      message: "Review branch 仍在运行。归档会停止该子智能体，并将它从轨道中移除。",
      confirmLabel: "归档",
      cancelLabel: "取消",
      destructive: true,
    });
  });

  it("uses running copy for initializing subagents", () => {
    expect(
      resolveArchiveSubagentDialog({
        title: "Starting child",
        status: "initializing",
      }),
    ).toEqual({
      title: "归档运行中的子智能体？",
      message: "Starting child 仍在运行。归档会停止该子智能体，并将它从轨道中移除。",
      confirmLabel: "归档",
      cancelLabel: "取消",
      destructive: true,
    });
  });

  it("uses idle copy for non-running subagents", () => {
    expect(
      resolveArchiveSubagentDialog({
        title: "Review branch",
        status: "idle",
      }),
    ).toEqual({
      title: "归档子智能体？",
      message: "从轨道中移除 Review branch。该子智能体会被归档。",
      confirmLabel: "归档",
      cancelLabel: "取消",
      destructive: true,
    });
  });

  it("falls back to this subagent when the title is not displayable", () => {
    expect(
      resolveArchiveSubagentDialog({
        title: "New Agent",
        status: null,
      }),
    ).toEqual({
      title: "归档子智能体？",
      message: "从轨道中移除 这个子智能体。该子智能体会被归档。",
      confirmLabel: "归档",
      cancelLabel: "取消",
      destructive: true,
    });
  });
});

describe("requestArchiveSubagent", () => {
  it("archives the subagent with the server id when the user confirms", async () => {
    const env = createFakeEnv({
      confirmResult: true,
      initialSubagents: [
        {
          id: "child-agent",
          snapshot: { title: "Review branch", status: "running" },
        },
      ],
    });

    await requestArchiveSubagent({ serverId: "server-1", subagentId: "child-agent" }, env.deps);

    expect(env.recordedArchives).toEqual([{ serverId: "server-1", agentId: "child-agent" }]);
  });

  it("does not archive the subagent when the user cancels", async () => {
    const env = createFakeEnv({
      confirmResult: false,
      initialSubagents: [
        {
          id: "child-agent",
          snapshot: { title: "Review branch", status: "idle" },
        },
      ],
    });

    await requestArchiveSubagent({ serverId: "server-1", subagentId: "child-agent" }, env.deps);

    expect(env.recordedArchives).toEqual([]);
  });

  it("asks for confirmation using the resolved dialog for the subagent", async () => {
    const env = createFakeEnv({
      confirmResult: false,
      initialSubagents: [
        {
          id: "child-agent",
          snapshot: { title: "Review branch", status: "running" },
        },
      ],
    });

    await requestArchiveSubagent({ serverId: "server-1", subagentId: "child-agent" }, env.deps);

    expect(env.recordedConfirmInputs).toEqual([
      resolveArchiveSubagentDialog({ title: "Review branch", status: "running" }),
    ]);
  });

  it("asks with the missing-subagent dialog when the snapshot is unknown", async () => {
    const env = createFakeEnv({ confirmResult: false });

    await requestArchiveSubagent({ serverId: "server-1", subagentId: "missing" }, env.deps);

    expect(env.recordedConfirmInputs).toEqual([
      resolveArchiveSubagentDialog({ title: undefined, status: undefined }),
    ]);
    expect(env.recordedArchives).toEqual([]);
  });

  it("swallows archive errors so the caller never sees them", async () => {
    const env = createFakeEnv({
      confirmResult: true,
      initialSubagents: [
        {
          id: "child-agent",
          snapshot: { title: "Review branch", status: "running" },
        },
      ],
    });
    env.deps.archiveAgent = async () => {
      throw new Error("daemon offline");
    };

    await expect(
      requestArchiveSubagent({ serverId: "server-1", subagentId: "child-agent" }, env.deps),
    ).resolves.toBeUndefined();
  });
});
