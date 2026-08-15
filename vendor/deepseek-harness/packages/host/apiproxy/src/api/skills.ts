/**
 * skills domain contract: read-only skill catalog lookup addressed by session,
 * plus the management surface served by `@deepseek-ai/dsh-skill-admin` for
 * the settings page — catalog (all sources), read, save, and remove over the
 * user skill root. The session's header cwd resolves to the canonical project
 * root host-side — the client never submits a raw path, and skill lookup never
 * creates or resumes an Agent.
 */

import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { RpcRequest, RpcResponse } from './rpc.ts'

/** Skill catalog row (wire projection of the host SkillSummary; provider/source vocabulary stays host-side). */
export interface SkillEntry {
  /** Kebab-case identifier the user references as `/name` in the composer. */
  readonly name: string
  /** Short routing description. */
  readonly description: string
  /** Optional extra routing guidance. */
  readonly whenToUse?: string
  /** False marks a user-only skill (`disable-model-invocation`): invocable here, absent from the model catalog. */
  readonly modelInvocable: boolean
}

/**
 * Management row: a skill as the settings surface renders it, with the
 * invocation switches flattened and the ownership marker the page's edit and
 * remove affordances are gated on.
 */
export interface SkillAdminView {
  /** Kebab-case identifier used to address the skill. */
  readonly name: string
  /** Short routing description. */
  readonly description: string
  /** Optional extra routing guidance. */
  readonly whenToUse?: string
  /** Whether model-facing catalogs may list and load the skill. */
  readonly modelInvocable: boolean
  /** Whether human-facing command catalogs may list and load the skill. */
  readonly userInvocable: boolean
  /** Discovery source that produced this skill (`user-dsh`, `project-dsh`, `bundled`, ...). */
  readonly source: string
  /** Provider that owns the skill body. */
  readonly provider: string
  /** Whether the skill lives in the user root and may be edited or removed here. */
  readonly owned: boolean
  /** Absolute file path of the skill when the entry has one. */
  readonly path?: string
}

/** Create or update payload of the management surface. */
export interface SkillSaveRequest {
  /** Kebab-case name; the host refuses names outside the skill grammar. */
  readonly name: string
  /** Short routing description; must not be empty. */
  readonly description: string
  /** Optional extra routing guidance. */
  readonly whenToUse?: string
  /** Markdown instruction body written after the frontmatter. */
  readonly content: string
  /** Whether model-facing catalogs may list and load the skill. */
  readonly modelInvocable: boolean
  /** Whether human-facing command catalogs may list and load the skill. */
  readonly userInvocable: boolean
}

/**
 * Skill-domain unary methods (the map key skill.* of RpcMethodMap). Listing
 * is the only read-only RPC: invocation itself is a plain `session.prompt`
 * whose leading `/name` token the host recognizes at the pre-step boundary
 * (`dsh-tool-skill` injects the rendered body there), so every client shares
 * one deterministic path with no dedicated invocation wire. The management
 * methods are session-independent and answered by the host `skillAdmin`
 * service; their absence is reported as `skill-admin-absent`, never 500.
 */
export interface SkillsApi {
  /** Lists the user-invocable skill catalog for the session's project. */
  list(request: RpcRequest<{ sessionId: SessionId }>): Promise<RpcResponse<{ skills: readonly SkillEntry[] }>>
  /** Lists every skill the management surface sees, with ownership markers. */
  catalog(request: RpcRequest<{}>): Promise<RpcResponse<{ skills: readonly SkillAdminView[] }>>
  /** Reads one owned skill's entry and body for the edit form. */
  read(request: RpcRequest<{ name: string }>): Promise<RpcResponse<{ entry: SkillAdminView; content: string }>>
  /** Creates or updates one user skill. */
  save(request: RpcRequest<SkillSaveRequest>): Promise<RpcResponse<{ entry: SkillAdminView }>>
  /** Removes one owned user skill. */
  remove(request: RpcRequest<{ name: string }>): Promise<RpcResponse<{}>>
}
