import { describe, expect, it, vi } from 'vitest'
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mkdtemp } from 'node:fs/promises'
import { hubInstallationStatus } from '../src/index.ts'
import { installGithubSkill, searchGithubSkills } from '../src/hub.ts'

describe('GitHub Skill Hub bridge', () => {
  it('searches with bounded structured output and normalizes results', async () => {
    const run = vi.fn(async () => JSON.stringify([{
      description: ' Browse sites ',
      namespace: '',
      path: 'browser/SKILL.md',
      repo: 'owner/skills',
      skillName: 'browser',
      stars: 12.8,
    }]))

    await expect(searchGithubSkills(' browser ', 99, run)).resolves.toEqual([{
      description: 'Browse sites',
      namespace: '',
      path: 'browser/SKILL.md',
      repo: 'owner/skills',
      skillName: 'browser',
      stars: 12,
    }])
    expect(run).toHaveBeenCalledWith([
      'skill', 'search', 'browser', '--limit', '30',
      '--json', 'description,namespace,path,repo,skillName,stars',
    ], 30_000)
  })

  it('rejects empty queries and malformed search output', async () => {
    const run = vi.fn(async () => '{}')
    await expect(searchGithubSkills(' ', 15, run)).rejects.toThrow(/query is required/)
    await expect(searchGithubSkills('browser', 15, run)).rejects.toThrow(/invalid result list/)
    run.mockResolvedValueOnce('[{"repo":"bad","path":"skill/SKILL.md","skillName":"skill"}]')
    await expect(searchGithubSkills('browser', 15, run)).rejects.toThrow(/OWNER\/REPO/)
  })

  it('installs one exact result without shell or overwrite flags', async () => {
    const run = vi.fn()
      .mockResolvedValueOnce('0123456789abcdef0123456789abcdef01234567\n')
      .mockResolvedValueOnce('')
    await expect(installGithubSkill(' owner/skills ', '.github/skills/browser/SKILL.md', 'C:/dsh/skills', run))
      .resolves.toBe('0123456789abcdef0123456789abcdef01234567')
    expect(run).toHaveBeenNthCalledWith(1, [
      'api', 'repos/owner/skills/commits/HEAD', '--jq', '.sha',
    ], 30_000)
    expect(run).toHaveBeenNthCalledWith(2, [
      'skill', 'install', 'owner/skills', '.github/skills/browser/SKILL.md',
      '--dir', 'C:/dsh/skills', '--allow-hidden-dirs',
      '--pin', '0123456789abcdef0123456789abcdef01234567',
    ], 120_000)
  })

  it('rejects an unresolved repository HEAD before installation', async () => {
    const run = vi.fn(async () => 'main\n')
    await expect(installGithubSkill('owner/repo', 'skills/demo/SKILL.md', 'target', run))
      .rejects.toThrow(/commit SHA/)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('rejects traversal and malformed repositories before running gh', async () => {
    const run = vi.fn(async () => '')
    await expect(installGithubSkill('owner', 'skills/demo/SKILL.md', 'target', run)).rejects.toThrow(/OWNER\/REPO/)
    await expect(installGithubSkill('owner/repo', '../SKILL.md', 'target', run)).rejects.toThrow(/path is invalid/)
    expect(run).not.toHaveBeenCalled()
  })

  it('restores installed provenance and refuses an unknown same-name directory', async () => {
    const target = await mkdtemp(join(tmpdir(), 'dsh-skill-hub-state-'))
    const result = { repo: 'owner/skills', path: 'browser/SKILL.md', skillName: 'browser' }
    await expect(hubInstallationStatus(target, result)).resolves.toBe('available')
    const directory = join(target, 'browser')
    await mkdir(directory)
    await writeFile(join(directory, 'SKILL.md'), '# browser\n')
    await expect(hubInstallationStatus(target, result)).resolves.toBe('conflict')
    await writeFile(join(directory, '.dsh-github-source.json'), JSON.stringify({
      repo: result.repo, path: result.path, commit: '1'.repeat(40),
    }))
    await expect(hubInstallationStatus(target, result)).resolves.toBe('installed')
    await expect(hubInstallationStatus(target, { ...result, repo: 'other/skills' })).resolves.toBe('conflict')
  })
})
