/** Workspace archive and directory UI capability. */

import { Service, type Context } from '@deepseek-ai/cordis'
import type { ClientRemote, DirectoryListing, RemoteFailure } from '@deepseek-ai/dsh-api-remotes/client'
import type {
  ISessions,
  SessionReference,
  SessionTarget,
  SessionListState,
  SessionSummary,
} from '@deepseek-ai/dsh-api-session-controller/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SubagentAddress } from '@deepseek-ai/dsh-subagent/client'
import type {
  IWorkspaces, WorkspaceId, WorkspaceView,
} from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'

interface MainSelection {
  readonly sessionId?: SessionId
  readonly subagentAddress?: SubagentAddress
}

/** Workspace archive and directory operations consumed by Client UI domains. */
export interface UiWorkspace {
  /**
   * Select a Session and show its Conversation as one UI navigation action.
   * @param target - known Session identity or durable direct-parent subagent address to display.
   */
  openSession(target: SessionTarget): void
  /**
   * Connect a Workspace and open its Session unless a later navigation supersedes it.
   * @param workspaceId - target Workspace.
   * @param beforeOpen - optional synchronous preparation for the selected Session, skipped after supersession.
   * @returns completion; a superseded request may create a Session but does not open it.
   */
  openWorkspace(workspaceId: WorkspaceId, beforeOpen?: (sessionId: SessionId) => void): Promise<void>
  /**
   * Connect a scratch Session and open it unless a later navigation supersedes it.
   * @param beforeOpen - optional synchronous preparation run after the target is retained.
   */
  openNoDirectory(beforeOpen?: (sessionId: SessionId) => void): Promise<void>
  /**
   * Fork a Session and open the child unless a later navigation supersedes it.
   * @param sessionId - source Session.
   * @returns completion; a superseded request leaves its child available without selecting it.
   */
  forkSession(sessionId: SessionId): Promise<void>
  /**
   * Resolve the reusable or newly created blank Session for a Workspace.
   * @param workspaceId - target Workspace.
   * @returns a Session already addressable through the Session Controller.
   */
  connectWorkspace(workspaceId: WorkspaceId): Promise<SessionId>
  /**
   * Start a New Session flow and navigate to its Session.
   * @param workspaceId - explicit target; absent inherits the current or most recent Workspace.
   */
  startSession(workspaceId?: WorkspaceId): void
  /**
   * Archive a Session and clear it when it is the current selection.
   * @param sessionId - Session to archive.
   */
  archiveSession(sessionId: SessionId): Promise<void>
  /**
   * Unarchive a Session, restoring it to its recorded Workspace position.
   * @param sessionId - Session to unarchive.
   */
  unarchiveSession(sessionId: SessionId): Promise<void>
  /**
   * Permanently destroy an archived Session's conversation log.
   * @param sessionId - archived Session to delete.
   */
  deleteSession(sessionId: SessionId): Promise<void>
  /**
   * Connect a Session that is not a Workspace member: reuse the blank Session
   * living in the Host scratch cwd, else create one there. Never registers a
   * Workspace.
   * @returns the connected Session id.
   */
  connectNoDirectory(): Promise<SessionId>
  /**
   * Delete a Workspace registration. Its Sessions leave every grouping
   * surface until the same directory is registered again; when the current
   * Session was one of them the selection clears into the New Session view.
   * @param workspaceId - Workspace registration to remove.
   */
  deleteWorkspace(workspaceId: WorkspaceId): Promise<void>
  /**
   * Open the Host-native directory picker.
   * @returns the selected directory, or null when cancelled.
   */
  pickDirectory(): Promise<string | null>
  /**
   * List one Host directory level.
   * @param path - directory path; absent selects the Host home.
   * @param signal - cancellation for a superseded scan.
   * @returns directory entries and breadcrumb ancestry.
   */
  listDirectory(path?: string, signal?: AbortSignal): Promise<DirectoryListing>
  /**
   * Create a child directory.
   * @param path - existing parent directory.
   * @param name - child directory name.
   * @returns created absolute path.
   */
  createDirectory(path: string, name: string): Promise<string>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Cross-Controller Workspace navigation and directory UI capability. */
    uiWorkspace: UiWorkspace
  }
}

/** Structured directory failure exposed to directory UI consumers. */
export class DirectoryBrowseError extends Error {
  override readonly name = 'DirectoryBrowseError'

  /** @param rpcError - Host directory business failure. */
  constructor(readonly rpcError: RemoteFailure) {
    super(`directory browse failed: ${rpcError.code}: ${rpcError.message}`)
  }
}

/** Implements Workspace archive and directory UI operations. */
class UiWorkspaceService extends Service implements UiWorkspace {
  private readonly connecting = new Map<WorkspaceId, Promise<SessionId>>()
  /** In-flight no-directory inspection and create; callers share one Session. */
  private connectingNoDirectory: Promise<SessionId> | undefined
  private readonly lifetime = new AbortController()
  private readonly selection = createSnapshotStore<MainSelection>(
    {}, { persist: { name: 'dsh.sessions.current' } },
  )
  private mainReference: SessionReference | undefined

  /**
   * @param ctx - Client root Context.
   * @param directoryPicker - the directory-picking Remote namespace.
   * @param workspaces - pure Workspace Controller.
   * @param sessions - pure Session Controller.
   */
  constructor(
    ctx: Context,
    private readonly directoryPicker: ClientRemote['directoryPicker'],
    private readonly workspaces: IWorkspaces,
    private readonly sessions: ISessions,
  ) {
    super(ctx, 'uiWorkspace')
    ctx.effect(() => {
      const stop = this.watchNavigation()
      return () => {
        stop()
        this.lifetime.abort()
        const reference = this.mainReference
        this.mainReference = undefined
        reference?.release()
      }
    }, 'ui-workspace: Workspace navigation policy')
  }

  async connectWorkspace(workspaceId: WorkspaceId): Promise<SessionId> {
    this.lifetime.signal.throwIfAborted()
    const inflight = this.connecting.get(workspaceId)
    if (inflight !== undefined) return inflight
    const pending = Promise.withResolvers<SessionId>()
    const attempt = pending.promise
      .finally(() => { this.connecting.delete(workspaceId) })
    this.connecting.set(workspaceId, attempt)
    void this.resolveWorkspace(workspaceId).then(pending.resolve, pending.reject)
    return attempt
  }

  /** Inspect candidates without allowing concurrent callers to race creation. */
  private async resolveWorkspace(workspaceId: WorkspaceId): Promise<SessionId> {
    const eligible = (id: SessionId): boolean => {
      const state = this.workspaces.list.getSnapshot()
      const workspace = state.items.find(item => item.workspaceId === workspaceId)
      if (workspace === undefined) {
        throw new Error(`uiWorkspace.connectWorkspace: unknown workspace ${workspaceId}`)
      }
      const summary = this.sessions.list.getSnapshot().byId[id]
      return isOrdinaryBlank(summary) && summary.cwd === workspace.path
        && workspace.sessionIds.includes(id) && !state.archivedSessionIds.includes(id)
    }
    for (const id of this.sessions.list.getSnapshot().ids) {
      if (!eligible(id)) continue
      const reusable = await this.sessions.canReuseBlank(id, this.lifetime.signal)
      this.lifetime.signal.throwIfAborted()
      if (eligible(id) && reusable) return id
    }
    this.lifetime.signal.throwIfAborted()
    if (!this.workspaces.list.getSnapshot().items.some(item => item.workspaceId === workspaceId)) {
      throw new Error(`uiWorkspace.connectWorkspace: unknown workspace ${workspaceId}`)
    }
    return this.sessions.create({ workspaceId })
  }

  openSession(target: SessionTarget): void {
    this.replaceMain(target, this.lifetime.signal)
  }

  async openWorkspace(workspaceId: WorkspaceId, beforeOpen?: (sessionId: SessionId) => void): Promise<void> {
    const navigation = AbortSignal.any([this.ctx.layout.beginNavigation(), this.lifetime.signal])
    const sessionId = await this.connectWorkspace(workspaceId)
    if (navigation.aborted) return
    this.replaceMain(sessionId, navigation, beforeOpen)
  }

  async openNoDirectory(beforeOpen?: (sessionId: SessionId) => void): Promise<void> {
    const navigation = AbortSignal.any([this.ctx.layout.beginNavigation(), this.lifetime.signal])
    const sessionId = await this.connectNoDirectory()
    if (navigation.aborted) return
    this.replaceMain(sessionId, navigation, beforeOpen)
  }

  async forkSession(sessionId: SessionId): Promise<void> {
    const navigation = AbortSignal.any([this.ctx.layout.beginNavigation(), this.lifetime.signal])
    const childId = await this.sessions.fork({ sessionId, increaseTitle: true })
    if (!navigation.aborted) this.replaceMain(childId, navigation)
  }

  startSession(workspaceId?: WorkspaceId): void {
    const workspace = this.workspaces.list.getSnapshot()
    const sessions = this.sessions.list.getSnapshot()
    const current = this.mainReference?.sessionId
    const currentWorkspaceId = current === undefined
      ? undefined
      : workspace.items.find(item => item.sessionIds.includes(current))?.workspaceId
    const recent = workspace.phase === 'ready' && sessions.phase === 'ready'
      ? recentWorkspace(workspace.items, sessions.byId)
      : undefined
    const target = workspaceId ?? currentWorkspaceId ?? recent
    if (target === undefined) {
      this.clearMain()
      return
    }
    void this.openWorkspace(target).catch(
      (reason: unknown) => { console.warn('new session failed:', reason) },
    )
  }

  async archiveSession(sessionId: SessionId): Promise<void> {
    await this.workspaces.archiveSession(sessionId)
    if (this.mainReference?.sessionId === sessionId) this.clearMain()
  }

  async unarchiveSession(sessionId: SessionId): Promise<void> {
    await this.workspaces.unarchiveSession(sessionId)
  }

  async deleteSession(sessionId: SessionId): Promise<void> {
    const value = await this.sessions.delete(sessionId)
    this.workspaces.applyArchivedEcho(value.archivedSessionIds)
  }

  async connectNoDirectory(): Promise<SessionId> {
    this.lifetime.signal.throwIfAborted()
    const inflight = this.connectingNoDirectory
    if (inflight !== undefined) return inflight
    const pending = Promise.withResolvers<SessionId>()
    const attempt = pending.promise
      .finally(() => { this.connectingNoDirectory = undefined })
    this.connectingNoDirectory = attempt
    void this.resolveNoDirectory().then(pending.resolve, pending.reject)
    return attempt
  }

  /** Recheck the live grouping after the Host has inspected durable history. */
  private async resolveNoDirectory(): Promise<SessionId> {
    const scratch = (): string => {
      const cwd = this.workspaces.list.getSnapshot().scratchCwd
      if (cwd === undefined) {
        throw new Error('uiWorkspace.connectNoDirectory: the Workspace baseline has not arrived yet')
      }
      return cwd
    }
    const eligible = (id: SessionId): boolean => {
      const cwd = scratch()
      const workspace = this.workspaces.list.getSnapshot()
      const summary = this.sessions.list.getSnapshot().byId[id]
      return isOrdinaryBlank(summary) && summary.cwd === cwd
        && !workspace.items.some(item => item.sessionIds.includes(id))
        && !workspace.archivedSessionIds.includes(id)
    }
    for (const id of this.sessions.list.getSnapshot().ids) {
      if (!eligible(id)) continue
      const reusable = await this.sessions.canReuseBlank(id, this.lifetime.signal)
      this.lifetime.signal.throwIfAborted()
      if (eligible(id) && reusable) return id
    }
    this.lifetime.signal.throwIfAborted()
    return this.sessions.create({ cwd: scratch() })
  }

  async deleteWorkspace(workspaceId: WorkspaceId): Promise<void> {
    const workspace = this.workspaces.list.getSnapshot().items
      .find(item => item.workspaceId === workspaceId)
    const current = this.mainReference?.sessionId
    await this.workspaces.delete(workspaceId)
    if (current !== undefined && workspace?.sessionIds.includes(current) === true
      && this.mainReference?.sessionId === current) {
      this.clearMain()
    }
  }

  async pickDirectory(): Promise<string | null> {
    const result = await this.directoryPicker.pick()
    if (!result.ok) throw new Error(`directory picker failed: ${result.error.message}`)
    return result.value
  }

  async listDirectory(path?: string, signal?: AbortSignal): Promise<DirectoryListing> {
    const result = await this.directoryPicker.list(path, signal)
    if (!result.ok) throw new DirectoryBrowseError(result.error)
    return result.value
  }

  async createDirectory(path: string, name: string): Promise<string> {
    const result = await this.directoryPicker.createDirectory(path, name)
    if (!result.ok) throw new DirectoryBrowseError(result.error)
    return result.value
  }

  private watchNavigation(): () => void {
    let initial: 'waiting' | 'connecting' | 'done' = 'waiting'
    const reconcile = (): void => {
      if (this.lifetime.signal.aborted) return
      if (this.clearArchivedCurrent()) return
      if (initial !== 'waiting') return
      const workspace = this.workspaces.list.getSnapshot()
      const sessions = this.sessions.list.getSnapshot()
      if (workspace.phase !== 'ready' || sessions.phase !== 'ready') return
      if (this.mainReference !== undefined) {
        initial = 'done'
        return
      }
      const saved = this.selection.getSnapshot()
      const savedTarget = saved.subagentAddress
        ?? (saved.sessionId !== undefined && sessions.byId[saved.sessionId] !== undefined
          ? saved.sessionId
          : undefined)
      if (savedTarget !== undefined) {
        initial = 'connecting'
        try {
          if (saved.subagentAddress !== undefined) {
            void this.sessions.refreshSubagents(saved.subagentAddress.parentSessionId)
          }
          this.openSession(savedTarget)
          initial = 'done'
        } catch (reason: unknown) {
          initial = 'waiting'
          console.warn('initial Session restoration failed:', reason)
        }
        return
      }
      const target = recentWorkspace(workspace.items, sessions.byId)
      if (target === undefined) {
        initial = 'done'
        return
      }
      initial = 'connecting'
      void this.connectWorkspace(target).then(
        (sessionId) => {
          if (this.mainReference === undefined) this.openSession(sessionId)
        },
      ).then(
        () => { initial = 'done' },
        (reason: unknown) => {
          if (this.lifetime.signal.aborted) return
          initial = 'waiting'
          console.warn('initial workspace selection failed:', reason)
        },
      )
    }
    const disposeWorkspaces = this.workspaces.list.subscribe(reconcile)
    const disposeSessions = this.sessions.list.subscribe(reconcile)
    reconcile()
    return () => {
      this.lifetime.abort()
      disposeSessions()
      disposeWorkspaces()
    }
  }

  /** @returns true when an archived current selection was cleared. */
  private clearArchivedCurrent(): boolean {
    const current = this.mainReference?.sessionId
    if (current === undefined
      || !this.workspaces.list.getSnapshot().archivedSessionIds.includes(current)) return false
    this.clearMain()
    return true
  }

  private clearMain(): void {
    const previous = this.mainReference
    this.mainReference = undefined
    this.selection.set({})
    previous?.release()
    this.ctx.layout.selectPanel(null)
  }

  private replaceMain(
    target: SessionTarget,
    signal: AbortSignal,
    beforeOpen?: (sessionId: SessionId) => void,
  ): void {
    signal.throwIfAborted()
    const reference = this.sessions.retain(target, { source: 'mainView' })
    try {
      signal.throwIfAborted()
      beforeOpen?.(reference.sessionId)
      if (signal.aborted) {
        reference.release()
        return
      }
      const subagentAddress = typeof target === 'string'
        ? this.sessions.subagentAddress(reference.sessionId)
        : target
      this.selection.set({
        sessionId: reference.sessionId,
        ...(subagentAddress === undefined ? {} : { subagentAddress }),
      })
    } catch (error: unknown) {
      reference.release()
      throw error
    }
    const previous = this.mainReference
    this.mainReference = reference
    previous?.release()
    void this.sessions.refreshSubagents(reference.sessionId)
    this.ctx.layout.selectPanel(null)
  }

}

/** List metadata can reject a candidate, but only Host history can confirm it. */
function isOrdinaryBlank(summary: SessionSummary | undefined): summary is SessionSummary {
  return summary !== undefined && summary.blank && !summary.running
    && summary.title === undefined && summary.parentId === undefined
    && summary.origin === undefined && summary.presentation === undefined
}

/** Stable tie-breaking follows Host Workspace order. */
function recentWorkspace(
  workspaces: readonly WorkspaceView[],
  sessions: SessionListState['byId'],
): WorkspaceId | undefined {
  let selected: WorkspaceId | undefined
  let selectedTime = Number.NEGATIVE_INFINITY
  for (const workspace of workspaces) {
    let latest = Number.NEGATIVE_INFINITY
    for (const sessionId of workspace.sessionIds) {
      const session = sessions[sessionId]
      if (session !== undefined && session.presentation === undefined) {
        latest = Math.max(latest, session.updatedAt)
      }
    }
    if (latest === Number.NEGATIVE_INFINITY) latest = Date.parse(workspace.createdAt)
    if (selected === undefined || latest > selectedTime) {
      selected = workspace.workspaceId
      selectedTime = latest
    }
  }
  return selected
}

export { UiWorkspaceService }
