import type { Agent } from "@/stores/session-store";
import type { ConfirmDialogInput } from "@/utils/confirm-dialog";

export interface ResolveArchiveSubagentDialogInput {
  title: Agent["title"] | null | undefined;
  status: Agent["status"] | null | undefined;
}

function resolveSubagentLabel(title: Agent["title"] | null | undefined): string | null {
  if (typeof title !== "string") {
    return null;
  }
  const normalized = title.trim();
  if (!normalized) {
    return null;
  }
  if (normalized.toLowerCase() === "new agent") {
    return null;
  }
  return normalized;
}

export function resolveArchiveSubagentDialog(
  input: ResolveArchiveSubagentDialogInput,
): ConfirmDialogInput {
  const subagentLabel = resolveSubagentLabel(input.title) ?? "这个子智能体";
  const isRunning = input.status === "running" || input.status === "initializing";

  return {
    title: isRunning ? "归档运行中的子智能体？" : "归档子智能体？",
    message: isRunning
      ? `${subagentLabel} 仍在运行。归档会停止该子智能体，并将它从轨道中移除。`
      : `从轨道中移除 ${subagentLabel}。该子智能体会被归档。`,
    confirmLabel: "归档",
    cancelLabel: "取消",
    destructive: true,
  };
}

export interface ArchiveSubagentDeps {
  getSubagent: (subagentId: string) => ResolveArchiveSubagentDialogInput | undefined;
  confirm: (input: ConfirmDialogInput) => Promise<boolean>;
  archiveAgent: (input: { serverId: string; agentId: string }) => Promise<void>;
}

export interface RequestArchiveSubagentInput {
  serverId: string;
  subagentId: string;
}

export async function requestArchiveSubagent(
  input: RequestArchiveSubagentInput,
  deps: ArchiveSubagentDeps,
): Promise<void> {
  const subagent = deps.getSubagent(input.subagentId);
  const confirmed = await deps.confirm(
    resolveArchiveSubagentDialog({
      title: subagent?.title,
      status: subagent?.status,
    }),
  );
  if (!confirmed) {
    return;
  }
  void deps.archiveAgent({ serverId: input.serverId, agentId: input.subagentId }).catch(() => {});
}
