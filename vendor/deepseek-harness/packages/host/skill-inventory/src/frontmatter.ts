/**
 * YAML frontmatter read/write for Settings-owned skill files.
 * @module @deepseek-ai/dsh-host-skill-inventory/frontmatter
 */

import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'

const FENCE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/

/** Split a SKILL.md into frontmatter data and the instruction body. */
export interface SkillMarkdown {
  readonly data: Record<string, unknown>
  readonly body: string
}

/**
 * Parse optional YAML frontmatter from a skill file.
 * @param text - file contents.
 * @returns frontmatter data and the instruction body.
 */
export function parseSkillMarkdown(text: string): SkillMarkdown {
  const match = FENCE.exec(text)
  if (match === null) return { data: {}, body: text }
  const parsed: unknown = parseYaml(match[1] ?? '')
  const data = parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
    ? { ...(parsed as Record<string, unknown>) }
    : {}
  return { data, body: text.slice(match[0].length) }
}

/**
 * Render a skill file, replacing Settings-owned frontmatter while preserving
 * fields owned by other producers.
 * @param fields - frontmatter updates, optional existing data, and body.
 * @returns the serialized SKILL.md text.
 */
export function renderSkillMarkdown(fields: {
  readonly name: string
  readonly description: string
  readonly whenToUse?: string
  /** User-assigned grouping labels, stored under `metadata.group` as a YAML list; an empty list clears them. */
  readonly groups?: readonly string[]
  readonly modelInvocable: boolean
  readonly userInvocable: boolean
  readonly content: string
  readonly existingData?: Readonly<Record<string, unknown>>
}): string {
  const data: Record<string, unknown> = { ...fields.existingData }
  data.name = fields.name
  data.description = fields.description
  delete data.whenToUse
  if (fields.whenToUse !== undefined && fields.whenToUse.trim().length > 0) {
    data.whenToUse = fields.whenToUse
  }
  replaceGroups(data, fields.groups)
  replaceInvocation(data, fields.modelInvocable, fields.userInvocable)
  return renderMarkdownData(data, fields.content)
}

/**
 * Replace only invocation flags while retaining every other frontmatter field.
 * @param fields - existing frontmatter, invocation flags, and body.
 * @returns the serialized SKILL.md text.
 */
export function renderSkillInvocationMarkdown(fields: {
  readonly existingData: Readonly<Record<string, unknown>>
  readonly modelInvocable: boolean
  readonly userInvocable: boolean
  readonly content: string
}): string {
  const data: Record<string, unknown> = { ...fields.existingData }
  replaceInvocation(data, fields.modelInvocable, fields.userInvocable)
  return renderMarkdownData(data, fields.content)
}

function replaceInvocation(data: Record<string, unknown>, modelInvocable: boolean, userInvocable: boolean): void {
  delete data['disable-model-invocation']
  delete data['user-invocable']
  if (!modelInvocable) data['disable-model-invocation'] = true
  if (!userInvocable) data['user-invocable'] = false
}

/** Set or clear the `metadata.group` label list while leaving other metadata fields untouched. */
function replaceGroups(data: Record<string, unknown>, groups: readonly string[] | undefined): void {
  // An omitted field means "not part of this write"; only an explicit list write changes the labels.
  if (groups === undefined) return
  const normalized = normalizeGroups(groups)
  const existing = data.metadata
  const isObject = typeof existing === 'object' && existing !== null && !Array.isArray(existing)
  const base = isObject ? { ...(existing as Record<string, unknown>) } : {}
  if (normalized.length === 0) delete base.group
  else base.group = normalized
  // A non-object metadata value is not Settings-owned; leave it alone unless writing a group.
  if (!isObject && normalized.length === 0) return
  if (Object.keys(base).length === 0) delete data.metadata
  else data.metadata = base
}

/** Trim, drop empties, and dedupe group labels while keeping first-appearance order. */
function normalizeGroups(groups: readonly string[]): string[] {
  const seen = new Set<string>()
  const normalized: string[] = []
  for (const raw of groups) {
    const label = raw.trim()
    if (label.length === 0 || seen.has(label)) continue
    seen.add(label)
    normalized.push(label)
  }
  return normalized
}

function renderMarkdownData(data: Record<string, unknown>, content: string): string {
  const yaml = stringifyYaml(data).trimEnd()
  const body = content.replace(/^\uFEFF/, '').replace(/^\n+/, '')
  return `---\n${yaml}\n---\n\n${body.endsWith('\n') ? body : `${body}\n`}`
}
