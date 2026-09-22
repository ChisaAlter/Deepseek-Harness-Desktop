/** GitHub CLI bridge for searching and installing Agent Skills. */

import { execFile } from 'node:child_process'

const SEARCH_FIELDS = 'description,namespace,path,repo,skillName,stars'
const MAX_OUTPUT = 1024 * 1024

export interface GithubSkillResult {
  readonly description: string
  readonly namespace: string
  readonly path: string
  readonly repo: string
  readonly skillName: string
  readonly stars: number
}

export type GhRunner = (args: readonly string[], timeout: number) => Promise<string>

/** Search public GitHub repositories through the official `gh skill` extension. */
export async function searchGithubSkills(
  query: string,
  limit: number,
  run: GhRunner = runGh,
): Promise<readonly GithubSkillResult[]> {
  const normalizedQuery = validateQuery(query)
  const normalizedLimit = Number.isInteger(limit) ? Math.min(Math.max(limit, 1), 30) : 15
  const stdout = await run([
    'skill', 'search', normalizedQuery,
    '--limit', String(normalizedLimit),
    '--json', SEARCH_FIELDS,
  ], 30_000)
  let parsed: unknown
  try {
    parsed = JSON.parse(stdout)
  } catch {
    throw new Error('skillInventory: GitHub skill search returned invalid JSON')
  }
  if (!Array.isArray(parsed)) {
    throw new Error('skillInventory: GitHub skill search returned an invalid result list')
  }
  return parsed.slice(0, normalizedLimit).map(parseResult)
}

/** Install one exact search result into a caller-resolved skills directory. */
export async function installGithubSkill(
  repo: string,
  path: string,
  targetDirectory: string,
  run: GhRunner = runGh,
): Promise<string> {
  const normalizedRepo = validateRepo(repo)
  const normalizedPath = validatePath(path)
  if (targetDirectory.trim().length === 0) {
    throw new Error('skillInventory: install target directory is required')
  }
  const pin = (await run([
    'api', `repos/${normalizedRepo}/commits/HEAD`, '--jq', '.sha',
  ], 30_000)).trim()
  if (!/^[0-9a-f]{40}$/i.test(pin)) {
    throw new Error('skillInventory: GitHub repository HEAD did not resolve to a commit SHA')
  }
  await run([
    'skill', 'install', normalizedRepo, normalizedPath,
    '--dir', targetDirectory,
    '--allow-hidden-dirs',
    '--pin', pin,
  ], 120_000)
  return pin.toLowerCase()
}

function parseResult(value: unknown): GithubSkillResult {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('skillInventory: GitHub skill search returned an invalid row')
  }
  const row = value as Record<string, unknown>
  const repo = validateRepo(stringField(row, 'repo'))
  const path = validatePath(stringField(row, 'path'))
  const skillName = stringField(row, 'skillName').trim()
  if (skillName.length === 0 || skillName.length > 200) {
    throw new Error('skillInventory: GitHub skill search returned an invalid skill name')
  }
  const stars = typeof row.stars === 'number' && Number.isFinite(row.stars) && row.stars >= 0
    ? Math.floor(row.stars)
    : 0
  return {
    repo,
    path,
    skillName,
    description: optionalString(row.description),
    namespace: optionalString(row.namespace),
    stars,
  }
}

function stringField(row: Record<string, unknown>, key: string): string {
  const value = row[key]
  if (typeof value !== 'string') {
    throw new Error(`skillInventory: GitHub skill search returned an invalid ${key}`)
  }
  return value
}

function optionalString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function validateQuery(query: string): string {
  const normalized = query.trim()
  if (normalized.length === 0) throw new Error('skillInventory: search query is required')
  if (normalized.length > 200 || /[\u0000-\u001f\u007f]/.test(normalized)) {
    throw new Error('skillInventory: search query is invalid')
  }
  return normalized
}

function validateRepo(repo: string): string {
  const normalized = repo.trim()
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(normalized)) {
    throw new Error('skillInventory: GitHub repository must use OWNER/REPO')
  }
  return normalized
}

function validatePath(path: string): string {
  const normalized = path.trim().replace(/\\/g, '/')
  if (
    normalized.length === 0
    || normalized.length > 500
    || normalized.startsWith('/')
    || normalized.startsWith('-')
    || normalized.split('/').some(part => part.length === 0 || part === '..')
    || /[\u0000-\u001f\u007f]/.test(normalized)
  ) {
    throw new Error('skillInventory: GitHub skill path is invalid')
  }
  return normalized
}

function runGh(args: readonly string[], timeout: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('gh', [...args], {
      encoding: 'utf8',
      timeout,
      maxBuffer: MAX_OUTPUT,
      windowsHide: true,
    }, (error, stdout, stderr) => {
      if (error === null) {
        resolve(stdout)
        return
      }
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOENT') {
        reject(new Error('skillInventory: GitHub CLI (gh) is required for Skill Hub search and install'))
        return
      }
      const detail = stderr.trim() || error.message
      if (/unknown command.*skill|unknown flag.*skill/i.test(detail)) {
        reject(new Error('skillInventory: update GitHub CLI (gh) to a version that supports `gh skill`'))
        return
      }
      reject(new Error(`skillInventory: GitHub CLI failed: ${detail}`))
    })
  })
}
