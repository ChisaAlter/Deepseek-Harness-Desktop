/**
 * Types of the skill-admin service, split from the runtime module so a
 * configuration client names them without importing host code.
 * @module @deepseek-ai/dsh-skill-admin/types
 */

import type { SkillInvocationPolicy, SkillSource } from '@deepseek-ai/dsh-skill'

/**
 * One skill as the management surface sees it: the winning registry summary
 * plus whether this service owns its files and may edit or remove them.
 */
export interface SkillAdminEntry {
  /** Kebab-case identifier used to address the skill. */
  readonly name: string
  /** Short routing description. */
  readonly description: string
  /** Optional extra routing guidance. */
  readonly whenToUse?: string
  /** Resolved model and user invocation controls. */
  readonly invocation: SkillInvocationPolicy
  /** Discovery source that produced this skill. */
  readonly source: SkillSource
  /** Provider that owns the skill body. */
  readonly provider: string
  /** Whether the skill lives in this service's writable user root. */
  readonly owned: boolean
  /** Absolute path of the skill file when the entry has one. */
  readonly path?: string
}

/** Create or update payload for one user skill. */
export interface SkillSaveInput {
  /** Kebab-case name; the write refuses names outside the skill grammar. */
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
