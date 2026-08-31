/**
 * Browser-safe request, result, and state-stream vocabulary for the Workspace
 * and directory-picking Remote namespaces this package owns. The picking seam
 * declares its own listing types, so they are re-exported here rather than
 * restated: a browser consumer reads the very declaration the backend answers.
 */

import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import type { z as zCore } from 'zod'

type ZodIssue = zCore.core.$ZodIssue

export type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
export type { DirectoryEntry, DirectoryListing } from '@deepseek-ai/dsh-host-directory-picker/types'

/** One durable Workspace projected for browser consumers. */
export interface WorkspaceView {
  readonly workspaceId: WorkspaceId
  /** Canonical host directory path. */
  readonly path: string
  /** User-visible title. */
  readonly title: string
  /** Sessions accounted to this Workspace in manual order. */
  readonly sessionIds: readonly SessionId[]
  /** ISO-8601 creation instant. */
  readonly createdAt: string
  /** ISO-8601 last-mutation instant. */
  readonly updatedAt: string
}

/** Stable Workspace failure details returned by unary methods. */
export interface WorkspaceErrorDetailsMap {
  'bad-request': Record<never, never>
  'workspace-invalid-path': { readonly path: string }
  'workspace-not-found': { readonly workspaceId: WorkspaceId }
  'workspace-name-conflict': { readonly name: string }
  'workspace-move-invalid': {
    readonly workspaceId: WorkspaceId
    readonly sessionId: SessionId
    readonly beforeSessionId?: SessionId
  }
  'session-not-found': { readonly sessionId: SessionId }
}

/** Workspace business failure returned without throwing a carrier error. */
export type WorkspaceError = {
  [Code in keyof WorkspaceErrorDetailsMap]: {
    readonly code: Code
    readonly message: string
    readonly details: WorkspaceErrorDetailsMap[Code]
  }
}[keyof WorkspaceErrorDetailsMap]

/** Stable directory-picking failure details returned by the picking wire verbs. */
export interface DirectoryPickerErrorDetailsMap {
  /** The directory creation request violates its semantic input constraints. */
  'bad-request': { readonly issues: ZodIssue[] }
  /** The verb needs an interaction the composed backend does not serve. */
  'directory-picker-unavailable': { readonly capability: string }
  /** The target is not fully qualified, or the backend cannot list it. */
  'directory-unreadable': { readonly path: string }
  /** A child of that name is already there. */
  'directory-exists': { readonly path: string }
  /** The parent is not fully qualified, the name is not one segment, or creation failed. */
  'directory-create-failed': { readonly path: string }
  /** The caller's own timeout or disconnect ended the chooser or the scan. */
  cancelled: Record<never, never>
  /** A backend failure with no seam code of its own. */
  internal: Record<never, never>
}

/** Existing directory requested for Workspace adoption. */
export interface WorkspaceCreateRequest {
  readonly path: string
}

/** Created or previously registered Workspace. */
export interface WorkspaceCreateValue {
  readonly workspace: WorkspaceView
  readonly created: boolean
}

/** Workspace title mutation. */
export interface WorkspaceRenameRequest {
  readonly workspaceId: WorkspaceId
  readonly title: string
}

/** Workspace mutation returning the complete changed row. */
export interface WorkspaceValue {
  readonly workspace: WorkspaceView
}

/** Workspace registration deletion. */
export interface WorkspaceDeleteRequest {
  readonly workspaceId: WorkspaceId
}

/** Receipt after one Workspace registration is deleted. */
export interface WorkspaceDeleteValue {
  readonly deleted: true
}

/** DOM-insertBefore-like Workspace order mutation. */
export interface WorkspaceInsertBeforeRequest {
  readonly workspaceId: WorkspaceId
  readonly beforeWorkspaceId?: WorkspaceId
}

/** Complete Workspace registry order after a mutation. */
export interface WorkspaceOrderValue {
  readonly workspaceIds: readonly WorkspaceId[]
}

/** DOM-insertBefore-like Session membership order mutation. */
export interface WorkspaceInsertSessionBeforeRequest {
  readonly workspaceId: WorkspaceId
  readonly sessionId: SessionId
  readonly beforeSessionId?: SessionId
}

/** Session requested for archival from Workspace grouping surfaces. */
export interface WorkspaceArchiveSessionRequest {
  readonly sessionId: SessionId
}

/** Complete archived Session set after a mutation. */
export interface WorkspaceArchiveValue {
  readonly archivedSessionIds: readonly SessionId[]
}

/** Complete reconnect baseline for Workspace browser state. */
export interface WorkspaceBaseline {
  readonly items: readonly WorkspaceView[]
  readonly archivedSessionIds: readonly SessionId[]
}

/** One ordered Workspace change after a generation's baseline. */
export type WorkspaceFollowIncrement =
  | { readonly type: 'upsert'; readonly workspace: WorkspaceView }
  | { readonly type: 'remove'; readonly workspaceId: WorkspaceId }
  | { readonly type: 'order'; readonly workspaceIds: readonly WorkspaceId[] }
  | { readonly type: 'archived'; readonly archivedSessionIds: readonly SessionId[] }

/** Workspace state stream; every generation starts with exactly one baseline. */
export type WorkspaceFollowFrame =
  | { readonly type: 'baseline'; readonly value: WorkspaceBaseline }
  | WorkspaceFollowIncrement
