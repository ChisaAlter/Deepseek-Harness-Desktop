/**
 * Wire types for the skill Settings Remote.
 * @module @deepseek-ai/dsh-host-skill-inventory/types
 */

/** Discovery root a Settings create may write. */
export type SkillCreateRoot = 'user-dsh' | 'project-dsh'

/** One catalog row for Settings. */
export interface SkillInventoryEntry {
  readonly name: string
  readonly description: string
  readonly whenToUse?: string
  /** User-assigned grouping labels; a skill repeats in every label's section. */
  readonly groups?: readonly string[]
  readonly source: string
  readonly provider: string
  /** Absolute path of the skill file, when the skill came from disk. */
  readonly path?: string
  /** Directory containing the skill file, for reveal-in-file-manager actions. */
  readonly directory?: string
  readonly writable: boolean
  readonly modelInvocable: boolean
  readonly userInvocable: boolean
}

/** Catalog snapshot. */
export interface SkillInventorySnapshot {
  readonly skills: readonly SkillInventoryEntry[]
  readonly cwd?: string
}

/** Optional workspace and live-session selector. */
export interface SkillInventoryScope {
  readonly cwd?: string
  readonly sessionId?: string
}

/** Load one skill body. */
export interface SkillInventoryGetRequest extends SkillInventoryScope {
  readonly name: string
}

/** Loaded skill for the editor. */
export interface SkillInventoryDetail {
  readonly name: string
  readonly description: string
  readonly whenToUse?: string
  /** User-assigned grouping labels; absent or empty means ungrouped. */
  readonly groups?: readonly string[]
  readonly source: string
  readonly path?: string
  readonly writable: boolean
  readonly modelInvocable: boolean
  readonly userInvocable: boolean
  readonly content: string
}

/** Create a user or project skill bundle. */
export interface SkillInventoryCreateRequest extends SkillInventoryScope {
  readonly name: string
  readonly description: string
  readonly whenToUse?: string
  /** User-assigned grouping labels; an empty list means ungrouped. */
  readonly groups?: readonly string[]
  readonly content: string
  readonly root: SkillCreateRoot
  readonly modelInvocable: boolean
  readonly userInvocable: boolean
}

/** Replace frontmatter and body of a writable skill. */
export interface SkillInventoryUpdateRequest extends SkillInventoryScope {
  readonly name: string
  readonly description: string
  readonly whenToUse?: string
  /** User-assigned grouping labels; an empty list clears every group. */
  readonly groups?: readonly string[]
  readonly content: string
  readonly modelInvocable: boolean
  readonly userInvocable: boolean
}

/** Delete a writable skill. */
export interface SkillInventoryRemoveRequest extends SkillInventoryScope {
  readonly name: string
}

/** Write invocation frontmatter. */
export interface SkillInventoryInvocationRequest extends SkillInventoryScope {
  readonly name: string
  readonly modelInvocable: boolean
  readonly userInvocable: boolean
}
