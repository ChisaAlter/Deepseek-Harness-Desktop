/**
 * User skill management service: lists the merged user-root/registry catalog
 * with ownership markers and owns create, update, and remove over the user
 * skill root. The user root is scanned directly rather than through the
 * registry so a write is visible to the next read without waiting on a
 * watcher, and so the web profile — whose presets mount their own providers —
 * still sees the user's own skills.
 *
 * @module @deepseek-ai/dsh-skill-admin
 */

import { Context, Service } from '@deepseek-ai/cordis'
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { isSkillName } from '@deepseek-ai/dsh-skill'
import type { SkillInvocationPolicy, SkillSource, SkillSummary } from '@deepseek-ai/dsh-skill'
import z from '@deepseek-ai/schemastery'
import type Schema from '@deepseek-ai/schemastery'
import { parse, stringify } from 'yaml'
import type { SkillAdminEntry, SkillSaveInput } from './types.ts'

export type { SkillAdminEntry, SkillSaveInput } from './types.ts'

/** Failure codes named by the management surface. */
export type SkillAdminErrorCode = 'invalid-name' | 'invalid-input' | 'shadowed' | 'not-owned' | 'not-found'

/** A management failure with a stable code for RPC mapping. */
export class SkillAdminError extends Error {
  constructor(readonly code: SkillAdminErrorCode, message: string) {
    super(message)
    this.name = 'SkillAdminError'
  }
}

/** Configuration of the skill-admin service. */
export interface Config {
  /** Explicit harness home override; defaults to `$DSH_HOME` then `~/.dsh`. */
  readonly dshHome?: string
  /** Shared agent config root; defaults to `$DSH_AGENTS_HOME` then `~/.agents`. */
  readonly agentsHome?: string
  /** Workspace used to resolve project skill roots; defaults to `process.cwd()`. */
  readonly projectCwd?: string
  /** Bundled skill root; defaults to `$DSH_BUNDLED_SKILL_DIR` when set. */
  readonly bundledSkillDir?: string
}

const USER_SKILL_SOURCE = 'user-dsh'
const USER_SKILL_PROVIDER = 'filesystem'
const SKILL_MARKDOWN = 'SKILL.md'

declare module '@deepseek-ai/cordis' {
  interface Context {
    skillAdmin: SkillAdminService
  }
}

/** One disk skill parsed for management, before the wire entry is built. */
interface ParsedDiskSkill {
  readonly name: string
  readonly description: string
  readonly whenToUse?: string
  readonly invocation: SkillInvocationPolicy
  readonly content: string
}

/**
 * Manage the user skill root.
 * @param ctx - Cordis context; the optional `skills` registry supplies the non-user catalog.
 * @param config - service configuration.
 */
export class SkillAdminService extends Service {
  static Config: Schema<Config> = z.object({
    dshHome: z.string(),
    agentsHome: z.string(),
    projectCwd: z.string(),
    bundledSkillDir: z.string(),
  })

  private readonly root: string
  private readonly agentsRoot: string
  private readonly projectCwd: string
  private readonly bundledRoot: string | undefined

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'skillAdmin')
    this.root = join(resolveDshHome(config.dshHome), 'skills')
    this.agentsRoot = join(resolve(config.agentsHome ?? process.env.DSH_AGENTS_HOME ?? join(homedir(), '.agents')), 'skills')
    this.projectCwd = resolve(config.projectCwd ?? process.cwd())
    const bundled = config.bundledSkillDir ?? process.env.DSH_BUNDLED_SKILL_DIR
    this.bundledRoot = bundled === undefined || bundled.length === 0 ? undefined : resolve(bundled)
  }

  /**
   * List the merged catalog: registry summaries plus every parseable skill
   * under the writable user root and the read-only user-agents, project, and
   * bundled roots. Same-name entries from different sources are all kept;
   * a disk read wins over a registry row of the same source.
   * @returns sorted management entries.
   */
  async list(): Promise<SkillAdminEntry[]> {
    const byKey = new Map<string, SkillAdminEntry>()
    const put = (entry: SkillAdminEntry): void => {
      byKey.set(`${entry.source}:${entry.name}`, entry)
    }
    for (const entry of await this.registryEntries()) put(entry)
    for (const entry of await this.scanForeignRoots()) put(entry)
    for (const entry of await this.scanRoot()) put(entry)
    return [...byKey.values()].sort((left, right) => {
      if (left.name !== right.name) return left.name < right.name ? -1 : 1
      return left.source < right.source ? -1 : left.source > right.source ? 1 : 0
    })
  }

  /**
   * Read one owned skill's body, or `undefined` when the name does not name a
   * parseable skill in the user root.
   * @param name - kebab-case skill name.
   * @returns the entry and body, or `undefined`.
   */
  async read(name: string): Promise<{ entry: SkillAdminEntry; content: string } | undefined> {
    if (!isSkillName(name)) return undefined
    const path = await this.findOnDisk(name)
    if (path === undefined) return undefined
    const parsed = await this.parseSkillFile(path)
    if (parsed === undefined) return undefined
    return { entry: this.entryOf(parsed, path), content: parsed.content }
  }

  /**
   * Create or overwrite one user skill. An existing owned skill of the same
   * name is replaced in place; a same-name skill provided by any other source
   * is refused so the write cannot land where sessions would never see it.
   * @param input - validated save payload.
   * @returns the entry as stored.
   * @throws SkillAdminError naming the refused condition.
   */
  async save(input: SkillSaveInput): Promise<SkillAdminEntry> {
    if (!isSkillName(input.name)) throw new SkillAdminError('invalid-name', `invalid skill name "${input.name}"`)
    if (input.description.trim().length === 0) {
      throw new SkillAdminError('invalid-input', 'skill description must not be empty')
    }
    await this.assertNotShadowed(input.name)
    const directory = join(this.root, input.name)
    await mkdir(directory, { recursive: true })
    const frontmatter: Record<string, unknown> = { name: input.name, description: input.description }
    if (input.whenToUse !== undefined && input.whenToUse.trim().length > 0) frontmatter.whenToUse = input.whenToUse
    // Only non-default invocation switches are written, mirroring the
    // filesystem provider's read defaults (both true).
    if (!input.modelInvocable) frontmatter['disable-model-invocation'] = true
    if (!input.userInvocable) frontmatter['user-invocable'] = false
    const file = join(directory, SKILL_MARKDOWN)
    await writeFile(file, `---\n${stringify(frontmatter)}---\n\n${input.content}`, 'utf8')
    return this.entryOf({
      name: input.name,
      description: input.description,
      ...input.whenToUse !== undefined && input.whenToUse.trim().length > 0 ? { whenToUse: input.whenToUse } : {},
      invocation: { modelInvocable: input.modelInvocable, userInvocable: input.userInvocable },
      content: input.content,
    }, file)
  }

  /**
   * Remove one owned skill's directory (or flat file) recursively.
   * @param name - kebab-case skill name.
   * @throws SkillAdminError naming the refused condition.
   */
  async remove(name: string): Promise<void> {
    if (!isSkillName(name)) throw new SkillAdminError('invalid-name', `invalid skill name "${name}"`)
    const path = await this.findOnDisk(name)
    if (path !== undefined) {
      const target = path.endsWith(`${sep}${SKILL_MARKDOWN}`) ? dirname(path) : path
      await rm(target, { recursive: true, force: false })
      return
    }
    const summary = await this.registrySummary(name)
    if (summary !== undefined) {
      throw new SkillAdminError('not-owned', `skill "${name}" is provided by source "${summary.source}" and cannot be removed here`)
    }
    throw new SkillAdminError('not-found', `skill "${name}" not found`)
  }

  /** Every registry summary mapped to a management entry. */
  private async registryEntries(): Promise<SkillAdminEntry[]> {
    const skills = this.ctx.get('skills')
    if (skills === undefined) return []
    return (await skills.list()).map(summary => ({
      name: summary.name,
      description: summary.description,
      ...summary.whenToUse === undefined ? {} : { whenToUse: summary.whenToUse },
      invocation: summary.invocation,
      source: summary.source,
      provider: summary.provider,
      owned: summary.source === USER_SKILL_SOURCE,
    }))
  }

  /** The winning registry summary for one name, if any. */
  private async registrySummary(name: string): Promise<SkillSummary | undefined> {
    const skills = this.ctx.get('skills')
    if (skills === undefined) return undefined
    return (await skills.list()).find(summary => summary.name === name)
  }

  /** Refuse a save whose name another source already wins. */
  private async assertNotShadowed(name: string): Promise<void> {
    const winner = await this.registrySummary(name)
    if (winner !== undefined && winner.source !== USER_SKILL_SOURCE) {
      throw new SkillAdminError('shadowed', `skill "${name}" is already provided by source "${winner.source}"`)
    }
  }

  /** Every parseable skill under the writable user root, fresh from disk. */
  private async scanRoot(): Promise<SkillAdminEntry[]> {
    return this.scanRootAt(this.root, USER_SKILL_SOURCE, true)
  }

  /**
   * Read-only roots the settings page still shows: user-agents, the project
   * pair around `projectCwd`, and the bundled directory when one is configured.
   */
  private async scanForeignRoots(): Promise<SkillAdminEntry[]> {
    const projectRoot = await findProjectRoot(this.projectCwd)
    const roots: Array<{ path: string; source: SkillSource }> = [
      { path: join(projectRoot, '.dsh', 'skills'), source: 'project-dsh' },
      { path: join(projectRoot, '.agents', 'skills'), source: 'project-agents' },
      { path: this.agentsRoot, source: 'user-agents' },
    ]
    if (this.bundledRoot !== undefined) roots.push({ path: this.bundledRoot, source: 'bundled' })
    const result: SkillAdminEntry[] = []
    for (const root of roots) result.push(...await this.scanRootAt(root.path, root.source, false))
    return result
  }

  /** Every parseable skill under one disk root. */
  private async scanRootAt(root: string, source: SkillSource, owned: boolean): Promise<SkillAdminEntry[]> {
    let entries
    try {
      entries = await readdir(root, { withFileTypes: true, encoding: 'utf8' })
    } catch (error) {
      if (isAbsentError(error)) return []
      throw error
    }
    const result: SkillAdminEntry[] = []
    for (const entry of entries) {
      if (owned && entry.name === '.system') continue
      const base = entry.name.endsWith('.md') ? entry.name.slice(0, -3) : entry.name
      if (!isSkillName(base)) continue
      const candidate = entry.isDirectory()
        ? join(root, entry.name, SKILL_MARKDOWN)
        : entry.isFile() && entry.name.endsWith('.md')
          ? join(root, entry.name)
          : undefined
      if (candidate === undefined) continue
      const parsed = await this.parseSkillFile(candidate)
      if (parsed !== undefined) result.push(this.entryOf(parsed, candidate, source, owned))
    }
    return result
  }

  /** The on-disk skill file for one name: the directory bundle or a flat `.md`. */
  private async findOnDisk(name: string): Promise<string | undefined> {
    const directory = join(this.root, name)
    try {
      const info = await stat(directory)
      if (info.isDirectory()) return join(directory, SKILL_MARKDOWN)
    } catch (error) {
      if (!isAbsentError(error)) throw error
    }
    const flat = join(this.root, `${name}.md`)
    try {
      const info = await stat(flat)
      if (info.isFile()) return flat
    } catch (error) {
      if (!isAbsentError(error)) throw error
    }
    return undefined
  }

  /**
   * Parse one skill file with the filesystem provider's frontmatter grammar;
   * entries the provider itself would ignore (bad YAML, missing fields,
   * invalid invocation) are skipped here the same way.
   * @param path - absolute skill file path.
   * @returns the parsed skill, or `undefined` when the file is not a valid skill.
   */
  private async parseSkillFile(path: string): Promise<ParsedDiskSkill | undefined> {
    let raw: string
    try {
      raw = await readFile(path, 'utf8')
    } catch (error) {
      if (isAbsentError(error)) return undefined
      throw error
    }
    const frontmatter = parseFrontmatter(raw)
    if (frontmatter === undefined) return undefined
    const name = stringField(frontmatter.data, 'name')
    const description = stringField(frontmatter.data, 'description')
    if (name === undefined || description === undefined || !isSkillName(name)) return undefined
    const invocation = parseInvocation(frontmatter.data)
    if (invocation === undefined) return undefined
    return {
      name,
      description,
      ...optionalString(frontmatter.data, 'whenToUse'),
      invocation,
      content: frontmatter.body.trim(),
    }
  }

  /** Build a management entry for one parsed disk skill. */
  private entryOf(
    parsed: ParsedDiskSkill,
    path: string,
    source: SkillSource = USER_SKILL_SOURCE,
    owned = true,
  ): SkillAdminEntry {
    return {
      name: parsed.name,
      description: parsed.description,
      ...parsed.whenToUse === undefined ? {} : { whenToUse: parsed.whenToUse },
      invocation: parsed.invocation,
      source,
      provider: USER_SKILL_PROVIDER,
      owned,
      path,
    }
  }
}

export default SkillAdminService

/** The provider's frontmatter delimiters and field grammar, mirrored here. */
function parseFrontmatter(raw: string): { data: Record<string, unknown>; body: string } | undefined {
  const firstLineEnd = raw.indexOf('\n')
  if (firstLineEnd < 0) return undefined
  const firstLine = raw.slice(0, firstLineEnd).replace(/\r$/, '')
  if (firstLine !== '---') return undefined
  const start = firstLineEnd + 1
  const closing = findClosingFrontmatter(raw, start)
  if (closing === undefined) return undefined
  const parsed = parse(raw.slice(start, closing.start)) as unknown
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined
  return { data: parsed as Record<string, unknown>, body: raw.slice(closing.bodyStart) }
}

function findClosingFrontmatter(raw: string, start: number): { start: number; bodyStart: number } | undefined {
  let lineStart = start
  while (lineStart <= raw.length) {
    const nextNewline = raw.indexOf('\n', lineStart)
    const lineEnd = nextNewline < 0 ? raw.length : nextNewline
    const line = raw.slice(lineStart, lineEnd).replace(/\r$/, '')
    if (line === '---') {
      return { start: lineStart, bodyStart: nextNewline < 0 ? raw.length : nextNewline + 1 }
    }
    if (nextNewline < 0) return undefined
    lineStart = nextNewline + 1
  }
  return undefined
}

function stringField(data: Record<string, unknown>, key: string): string | undefined {
  const value = data[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function optionalString(data: Record<string, unknown>, key: string): { whenToUse?: string } {
  const value = data[key]
  return typeof value === 'string' && value.length > 0 ? { whenToUse: value } : {}
}

/** The provider's invocation frontmatter, or `undefined` when malformed. */
function parseInvocation(data: Record<string, unknown>): SkillInvocationPolicy | undefined {
  try {
    const disableModelInvocation = frontmatterBoolean(data, 'disable-model-invocation')
    const userInvocable = frontmatterBoolean(data, 'user-invocable')
    return {
      modelInvocable: disableModelInvocation !== true,
      userInvocable: userInvocable !== false,
    }
  } catch {
    return undefined
  }
}

function frontmatterBoolean(data: Record<string, unknown>, key: string): boolean | undefined {
  if (!Object.hasOwn(data, key)) return undefined
  const value = data[key]
  if (typeof value === 'boolean') return value
  if (value === 1 || value === '1') return true
  if (value === 0 || value === '0') return false
  if (typeof value === 'string') {
    switch (value.toLowerCase()) {
      case 'true':
      case 'yes':
      case 'on':
        return true
      case 'false':
      case 'no':
      case 'off':
        return false
    }
  }
  throw new TypeError(`frontmatter field "${key}" must be a boolean`)
}

function isAbsentError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code
  return code === 'ENOENT' || code === 'ENOTDIR'
}

/** Nearest `.git` ancestor of `cwd`, or `cwd` itself when none exists. */
async function findProjectRoot(cwd: string): Promise<string> {
  let current = cwd
  while (true) {
    try {
      const info = await stat(join(current, '.git'))
      if (info.isDirectory() || info.isFile()) return current
    } catch (error) {
      if (!isAbsentError(error)) throw error
    }
    const parent = dirname(current)
    if (parent === current) return cwd
    current = parent
  }
}
