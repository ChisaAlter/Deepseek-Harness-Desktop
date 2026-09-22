import equal from "fast-deep-equal";
import type pino from "pino";
import type { SessionOutboundMessage, WorkspaceDescriptorPayload } from "./messages.js";
import type { WorkspaceUpdatesFilter } from "./workspace-directory.js";
import type { PersistedWorkspaceRecord } from "./workspace-registry.js";

export type WorkspaceUpdatePayload = Extract<
  SessionOutboundMessage,
  { type: "workspace_update" }
>["payload"];

export interface WorkspaceUpdatesSubscriptionState {
  subscriptionId: string;
  filter?: WorkspaceUpdatesFilter;
  isBootstrapping: boolean;
  pendingUpdatesByWorkspaceId: Map<string, WorkspaceUpdatePayload>;
  lastEmittedByWorkspaceId: Map<string, WorkspaceUpdatePayload>;
}

interface WorkspaceUpdateControllerOptions {
  sessionLogger: pino.Logger;
  emit(message: SessionOutboundMessage): void;
  buildDescriptorMap(options: {
    includeGitData: boolean;
    workspaceIds?: Iterable<string>;
  }): Promise<Map<string, WorkspaceDescriptorPayload>>;
  listWorkspaceRecords(): Promise<PersistedWorkspaceRecord[]>;
  resolveWorkspaceIdForCwd(cwd: string, workspaces: PersistedWorkspaceRecord[]): string;
  matchesFilter(input: {
    workspace: WorkspaceDescriptorPayload;
    filter: WorkspaceUpdatesFilter | undefined;
  }): boolean;
  shouldSkipGitState(workspaceId: string, workspace: WorkspaceDescriptorPayload | null): boolean;
  recordGitState(workspaceId: string, workspace: WorkspaceDescriptorPayload | null): void;
  reconcileWorkspaceRecords(): Promise<Set<string>>;
}

/** Owns one session's workspace subscription state and incremental update projection. */
export class WorkspaceUpdateController {
  private subscription: WorkspaceUpdatesSubscriptionState | null = null;

  constructor(private readonly options: WorkspaceUpdateControllerOptions) {}

  startSubscription(subscriptionId: string, filter?: WorkspaceUpdatesFilter): void {
    this.subscription = {
      subscriptionId,
      filter,
      isBootstrapping: true,
      pendingUpdatesByWorkspaceId: new Map(),
      lastEmittedByWorkspaceId: new Map(),
    };
  }

  cancelSubscription(subscriptionId?: string): void {
    if (subscriptionId && this.subscription?.subscriptionId !== subscriptionId) {
      return;
    }
    this.subscription = null;
  }

  getSubscription(): WorkspaceUpdatesSubscriptionState | null {
    return this.subscription;
  }

  setSubscription(subscription: WorkspaceUpdatesSubscriptionState | null): void {
    this.subscription = subscription;
  }

  completeBootstrap(
    subscriptionId: string,
    snapshotEntries: Iterable<WorkspaceDescriptorPayload>,
  ): boolean {
    const subscription = this.subscription;
    if (
      !subscription ||
      subscription.subscriptionId !== subscriptionId ||
      !subscription.isBootstrapping
    ) {
      return false;
    }

    const snapshotLatestActivityByWorkspaceId = new Map<string, number>();
    for (const workspace of snapshotEntries) {
      subscription.lastEmittedByWorkspaceId.set(workspace.id, {
        kind: "upsert",
        workspace,
      });
      const latestActivity = workspace.activityAt
        ? Date.parse(workspace.activityAt)
        : Number.NEGATIVE_INFINITY;
      if (!Number.isNaN(latestActivity)) {
        snapshotLatestActivityByWorkspaceId.set(workspace.id, latestActivity);
      }
    }

    subscription.isBootstrapping = false;
    const pending = Array.from(subscription.pendingUpdatesByWorkspaceId.values());
    subscription.pendingUpdatesByWorkspaceId.clear();

    for (const payload of pending) {
      if (this.shouldSkipPendingSnapshotUpdate(payload, snapshotLatestActivityByWorkspaceId)) {
        continue;
      }
      this.emitPayload(subscription, payload);
    }

    void this.reconcileAndEmitUpdates();
    return true;
  }

  async emitUpdatesForWorkspaceIds(
    workspaceIds: Iterable<string>,
    options?: { skipReconcile?: boolean; dedupeGitState?: boolean },
  ): Promise<void> {
    const subscription = this.subscription;
    if (!subscription) {
      return;
    }

    const uniqueWorkspaceIds = new Set(workspaceIds);
    if (uniqueWorkspaceIds.size === 0) {
      return;
    }

    const descriptorsByWorkspaceId = await this.options.buildDescriptorMap({
      workspaceIds: uniqueWorkspaceIds,
      includeGitData: true,
    });

    for (const workspaceId of uniqueWorkspaceIds) {
      const workspace = descriptorsByWorkspaceId.get(workspaceId);
      const nextWorkspace =
        workspace && this.options.matchesFilter({ workspace, filter: subscription.filter })
          ? workspace
          : null;
      if (options?.dedupeGitState && this.options.shouldSkipGitState(workspaceId, nextWorkspace)) {
        continue;
      }
      this.options.recordGitState(workspaceId, nextWorkspace);

      const nextPayload: WorkspaceUpdatePayload = nextWorkspace
        ? { kind: "upsert", workspace: nextWorkspace }
        : { kind: "remove", id: workspaceId };
      const lastEmitted = subscription.lastEmittedByWorkspaceId.get(workspaceId);
      if (this.payloadsEqual(lastEmitted, nextPayload)) {
        continue;
      }
      this.bufferOrEmit(subscription, nextPayload);
    }

    if (!options?.skipReconcile) {
      void this.reconcileAndEmitUpdates();
    }
  }

  async emitUpdateForCwd(
    cwd: string,
    options?: { skipReconcile?: boolean; dedupeGitState?: boolean },
  ): Promise<void> {
    const workspaces = await this.options.listWorkspaceRecords();
    const workspaceId = this.options.resolveWorkspaceIdForCwd(cwd, workspaces);
    await this.emitUpdatesForWorkspaceIds([workspaceId], options);
  }

  async reconcileAndEmitUpdates(): Promise<void> {
    if (!this.subscription) {
      return;
    }
    try {
      const changedWorkspaceIds = await this.options.reconcileWorkspaceRecords();
      if (changedWorkspaceIds.size > 0) {
        await this.emitUpdatesForWorkspaceIds(changedWorkspaceIds, { skipReconcile: true });
      }
    } catch (error) {
      this.options.sessionLogger.error(
        { err: error },
        "Background workspace reconciliation failed",
      );
    }
  }

  dispose(): void {
    this.subscription = null;
  }

  private bufferOrEmit(
    subscription: WorkspaceUpdatesSubscriptionState,
    payload: WorkspaceUpdatePayload,
  ): void {
    if (subscription.isBootstrapping) {
      subscription.pendingUpdatesByWorkspaceId.set(this.payloadWorkspaceId(payload), payload);
      return;
    }
    this.emitPayload(subscription, payload);
  }

  private emitPayload(
    subscription: WorkspaceUpdatesSubscriptionState,
    payload: WorkspaceUpdatePayload,
  ): void {
    const workspaceId = this.payloadWorkspaceId(payload);
    subscription.lastEmittedByWorkspaceId.set(workspaceId, payload);

    this.options.emit({ type: "workspace_update", payload });
  }

  private shouldSkipPendingSnapshotUpdate(
    payload: WorkspaceUpdatePayload,
    snapshotLatestActivityByWorkspaceId: Map<string, number>,
  ): boolean {
    if (payload.kind !== "upsert") {
      return false;
    }
    const baseline = this.subscription?.lastEmittedByWorkspaceId.get(payload.workspace.id);
    if (this.payloadsEqual(baseline, payload)) {
      return true;
    }
    const snapshotLatestActivity = snapshotLatestActivityByWorkspaceId.get(payload.workspace.id);
    if (typeof snapshotLatestActivity !== "number") {
      return false;
    }
    const updateLatestActivity = payload.workspace.activityAt
      ? Date.parse(payload.workspace.activityAt)
      : Number.NEGATIVE_INFINITY;
    return !Number.isNaN(updateLatestActivity) && updateLatestActivity <= snapshotLatestActivity;
  }

  private payloadsEqual(
    left: WorkspaceUpdatePayload | undefined,
    right: WorkspaceUpdatePayload,
  ): boolean {
    if (!left || left.kind !== right.kind) {
      return false;
    }
    if (left.kind === "remove") {
      return right.kind === "remove" && left.id === right.id;
    }
    return right.kind === "upsert" && equal(left.workspace, right.workspace);
  }

  private payloadWorkspaceId(payload: WorkspaceUpdatePayload): string {
    return payload.kind === "upsert" ? payload.workspace.id : payload.id;
  }
}
