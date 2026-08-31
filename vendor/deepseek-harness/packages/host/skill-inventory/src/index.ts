/**
 * Host Remote for listing and mutating filesystem-backed skills.
 * @module @deepseek-ai/dsh-host-skill-inventory
 */

import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { isSkillName, type SkillDefinition, type SkillRegistry, type SkillSummary, type SkillViewOptions } from '@deepseek-ai/dsh-skill'
import type {} from '@deepseek-ai/dsh-skill'
import { RemoteError, TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'
import type {} from 'zod'
import { parseSkillMarkdown, renderSkillInvocationMarkdown, renderSkillMarkdown } from './frontmatter.ts'
import type {
  SkillInventoryCreateRequest,
  SkillInventoryDetail,
  SkillInventoryEntry,
  SkillInventoryGetRequest,
  SkillInventoryInvocationRequest,
  SkillInventoryRemoveRequest,
  SkillInventoryScope,
  SkillInventorySnapshot,
  SkillInventoryUpdateRequest,
} from './types.ts'

export type * from './types.ts'
export { parseSkillMarkdown, renderSkillMarkdown } from './frontmatter.ts'

const WRITABLE_ALWAYS = new Set(['user-dsh', 'user-agents'])
const WRITABLE_WITH_CWD = new Set(['project-dsh', 'project-agents'])

interface ResolvedSkillView {
  readonly registry: SkillRegistry
  readonly options: SkillViewOptions
}

/** Remote-only skill catalog and file mutations for Settings. */
export class SkillInventoryGateway extends TypertRemoteService {
  static inject = ['agents', 'skills']

  /**
   * @param ctx - host context carrying the skill registry.
   */
  constructor(ctx: Context) {
    super(ctx, 'skillInventory')
  }

  /**
   * List every discovered skill, including non-user-invocable ones.
   * @param request - optional project cwd.
   * @returns the catalog snapshot for Settings.
   */
  @Remote('list')
  async list(request: SkillInventoryScope): Promise<SkillInventorySnapshot> {
    const view = this.resolveView(request)
    const skills = await view.registry.list(view.options)
    const entries: SkillInventoryEntry[] = []
    for (const summary of skills) {
      const detail = await view.registry.get(summary.name, view.options)
      entries.push(toEntry(summary, detail, view.options.cwd))
    }
    return { skills: entries, ...view.options.cwd === undefined ? {} : { cwd: view.options.cwd } }
  }

  /**
   * Load one skill body for the editor.
   * @param request - name and optional cwd.
   * @returns the skill detail for the editor.
   */
  @Remote('get')
  async get(request: SkillInventoryGetRequest): Promise<SkillInventoryDetail> {
    const view = this.resolveView(request)
    const definition = await this.requireSkill(request.name, view)
    const groups = metadataGroups(definition)
    return {
      name: definition.name,
      description: definition.description,
      ...definition.whenToUse === undefined ? {} : { whenToUse: definition.whenToUse },
      ...groups === undefined ? {} : { groups },
      source: definition.source,
      ...definition.path === undefined ? {} : { path: definition.path },
      writable: isWritable(definition.source, view.options.cwd, definition.path),
      modelInvocable: definition.invocation.modelInvocable,
      userInvocable: definition.invocation.userInvocable,
      content: definition.content,
    }
  }

  /**
   * Create a new directory-bundle skill.
   * @param request - name, copy, body, and root.
   */
  @Remote('create')
  async create(request: SkillInventoryCreateRequest): Promise<void> {
    if (!isSkillName(request.name)) {
      throw new Error(`skillInventory: name "${request.name}" is not kebab-case`)
    }
    const view = this.resolveView(request)
    const existing = await view.registry.get(request.name, view.options)
    if (existing !== undefined) {
      throw new Error(`skillInventory: skill "${request.name}" already exists`)
    }
    const path = await createPath(request.root, request.name, view.options.cwd)
    await mkdir(dirname(path), { recursive: true, mode: 0o700 })
    await writeFile(path, renderSkillMarkdown({
      name: request.name,
      description: request.description,
      ...optionalWhenToUse(request.whenToUse),
      groups: request.groups ?? [],
      modelInvocable: request.modelInvocable,
      userInvocable: request.userInvocable,
      content: request.content,
    }), { encoding: 'utf8', mode: 0o600 })
    view.registry.invalidate()
  }

  /**
   * Replace the body and invocation flags of a writable skill.
   * @param request - name, copy, body, and flags.
   */
  @Remote('update')
  async update(request: SkillInventoryUpdateRequest): Promise<void> {
    const view = this.resolveView(request)
    const definition = await this.requireWritable(request.name, view)
    const current = parseSkillMarkdown(await readFile(definition.path, 'utf8'))
    await writeFile(definition.path, renderSkillMarkdown({
      name: definition.name,
      description: request.description,
      ...optionalWhenToUse(request.whenToUse),
      ...request.groups === undefined ? {} : { groups: request.groups },
      modelInvocable: request.modelInvocable,
      userInvocable: request.userInvocable,
      content: request.content,
      existingData: current.data,
    }), 'utf8')
    view.registry.invalidate()
  }

  /**
   * Delete a writable skill file or bundle directory.
   * @param request - name and optional cwd.
   */
  @Remote('delete')
  async delete(request: SkillInventoryRemoveRequest): Promise<void> {
    const view = this.resolveView(request)
    const definition = await this.requireWritable(request.name, view)
    await rm(bundleRoot(definition.path), { recursive: true, force: true })
    view.registry.invalidate()
  }

  /**
   * Write only the invocation frontmatter of a writable skill.
   * @param request - name and flags.
   */
  @Remote('setInvocation')
  async setInvocation(request: SkillInventoryInvocationRequest): Promise<void> {
    const view = this.resolveView(request)
    const definition = await this.requireWritable(request.name, view)
    const current = await readFile(definition.path, 'utf8')
    const parsed = parseSkillMarkdown(current)
    await writeFile(definition.path, renderSkillInvocationMarkdown({
      existingData: parsed.data,
      modelInvocable: request.modelInvocable,
      userInvocable: request.userInvocable,
      content: parsed.body,
    }), 'utf8')
    view.registry.invalidate()
  }

  private resolveView(request: SkillInventoryScope): ResolvedSkillView {
    const cwd = emptyToUndefined(request.cwd)
    const agent = this.sessionAgent(request.sessionId)
    const presets = this.ctx.get('agentPresets') as {
      serviceFor(agent: object, name: 'skills'): SkillRegistry | undefined
    } | undefined
    const registry = agent === undefined ? this.ctx.skills : presets?.serviceFor(agent, 'skills') ?? this.ctx.skills
    const options: SkillViewOptions = {
      ...cwd === undefined ? {} : { cwd },
      ...agent === undefined ? {} : { scope: agent },
    }
    return { registry, options }
  }

  private sessionAgent(sessionId: string | undefined): object | undefined {
    if (sessionId === undefined) return undefined
    const agents = this.ctx.get('agents') as { get(id: string): object | undefined } | undefined
    const agent = agents?.get(sessionId)
    if (agent === undefined) {
      throw new RemoteError(
        'session/not-found',
        `session "${sessionId}" not found (not attached)`,
        { sessionId: sessionId as SessionId },
      )
    }
    return agent
  }

  private async requireSkill(name: string, view: ResolvedSkillView): Promise<SkillDefinition> {
    if (!isSkillName(name)) throw new Error(`skillInventory: name "${name}" is not kebab-case`)
    const definition = await view.registry.get(name, view.options)
    if (definition === undefined) throw new Error(`skillInventory: skill "${name}" was not found`)
    return definition
  }

  private async requireWritable(name: string, view: ResolvedSkillView): Promise<SkillDefinition & { path: string }> {
    const definition = await this.requireSkill(name, view)
    if (definition.path === undefined || !isWritable(definition.source, view.options.cwd, definition.path)) {
      throw new Error(`skillInventory: skill "${name}" is read-only`)
    }
    return definition as SkillDefinition & { path: string }
  }
}

export default SkillInventoryGateway

function toEntry(summary: SkillSummary, detail: SkillDefinition | undefined, cwd: string | undefined): SkillInventoryEntry {
  const path = detail?.path
  const groups = metadataGroups(detail)
  return {
    name: summary.name,
    description: summary.description,
    ...summary.whenToUse === undefined ? {} : { whenToUse: summary.whenToUse },
    ...groups === undefined ? {} : { groups },
    source: summary.source,
    provider: summary.provider,
    ...path === undefined ? {} : { path, directory: dirname(path) },
    writable: isWritable(summary.source, cwd, path),
    modelInvocable: summary.invocation.modelInvocable,
    userInvocable: summary.invocation.userInvocable,
  }
}

/** Read the Settings-owned grouping labels from provider metadata. */
function metadataGroups(definition: SkillDefinition | undefined): readonly string[] | undefined {
  const metadata = definition?.metadata
  if (metadata === undefined) return undefined
  return normalizeMetadataGroups(metadata.group)
}

/**
 * Normalize the stored `metadata.group` value at the durable-file boundary:
 * a scalar label or a list of labels, trimmed, deduped, order-preserving;
 * no labels yields undefined so the wire field stays omitted.
 */
function normalizeMetadataGroups(value: unknown): readonly string[] | undefined {
  const raw = typeof value === 'string' ? [value] : Array.isArray(value) ? value : []
  const seen = new Set<string>()
  const groups: string[] = []
  for (const item of raw) {
    if (typeof item !== 'string') continue
    const label = item.trim()
    if (label.length === 0 || seen.has(label)) continue
    seen.add(label)
    groups.push(label)
  }
  return groups.length === 0 ? undefined : groups
}

function isWritable(source: string, cwd: string | undefined, path: string | undefined): boolean {
  if (path === undefined) return false
  if (WRITABLE_ALWAYS.has(source)) return true
  return cwd !== undefined && WRITABLE_WITH_CWD.has(source)
}

async function createPath(
  root: SkillInventoryCreateRequest['root'],
  name: string,
  cwd: string | undefined,
): Promise<string> {
  if (root === 'user-dsh') return join(resolveDshHome(), 'skills', name, 'SKILL.md')
  if (cwd === undefined || cwd.trim().length === 0) {
    throw new Error('skillInventory: creating a project skill requires cwd')
  }
  const projectRoot = await findProjectRoot(cwd)
  return join(projectRoot, '.dsh', 'skills', name, 'SKILL.md')
}

async function findProjectRoot(cwd: string): Promise<string> {
  const fallback = resolve(cwd)
  let current = fallback
  while (true) {
    try {
      await access(join(current, '.git'))
      return current
    } catch {
      const parent = dirname(current)
      if (parent === current) return fallback
      current = parent
    }
  }
}

function bundleRoot(path: string): string {
  const normalized = path.replace(/\\/g, '/').toLowerCase()
  return normalized.endsWith('/skill.md') ? dirname(path) : path
}

function emptyToUndefined(value: string | undefined): string | undefined {
  return value === undefined || value.trim().length === 0 ? undefined : value
}

function optionalWhenToUse(value: string | undefined): { whenToUse: string } | object {
  return value === undefined || value.trim().length === 0 ? {} : { whenToUse: value }
}
