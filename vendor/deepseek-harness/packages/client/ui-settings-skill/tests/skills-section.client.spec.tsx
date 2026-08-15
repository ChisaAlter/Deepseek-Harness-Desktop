// @vitest-environment jsdom
/** Skills settings section: grouped catalog, ownership-gated actions, and the create/edit/delete flows. */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { IApiClient, SkillAdminView } from '@deepseek-ai/dsh-api-remotes/client'
import { SkillsSection } from '../src/client/SkillsSection.tsx'
import type { SkillsSectionInjected } from '../src/client/SkillsSection.tsx'
import { en, type SkillKey } from '../src/client/locales.ts'

afterEach(cleanup)

const t = ((key: SkillKey): string => en[key]) as SkillsSectionInjected['t']

const OWNED: SkillAdminView = {
  name: 'my-skill', description: 'Mine', modelInvocable: true, userInvocable: true,
  source: 'user-dsh', provider: 'filesystem', owned: true,
}
const FOREIGN: SkillAdminView = {
  name: 'bundled-skill', description: 'Bundled', modelInvocable: true, userInvocable: true,
  source: 'bundled', provider: 'bundled', owned: false,
}

function skillsApi(overrides: Partial<Record<'catalog' | 'read' | 'save' | 'remove', ReturnType<typeof vi.fn>>> = {}) {
  return {
    skills: {
      catalog: vi.fn(async () => ({ result: { ok: true as const, value: { skills: [OWNED, FOREIGN] } } })),
      read: vi.fn(async () => ({ result: { ok: true as const, value: { entry: OWNED, content: 'Body.' } } })),
      save: vi.fn(async (payload: { name: string }) => ({
        result: { ok: true as const, value: { entry: { ...OWNED, name: payload.name } } },
      })),
      remove: vi.fn(async () => ({ result: { ok: true as const, value: {} } })),
      ...overrides,
    },
  }
}

function renderSection(overrides: Partial<SkillsSectionInjected> = {}) {
  const injected: SkillsSectionInjected = {
    api: skillsApi() as unknown as Pick<IApiClient, 'skills'>,
    t,
    ...overrides,
  }
  render(<SkillsSection close={() => {}} {...injected} />)
  return injected
}

describe('SkillsSection', () => {
  it('groups owned and foreign skills and gates row actions on ownership', async () => {
    renderSection()
    expect(await screen.findByText('my-skill')).toBeTruthy()
    expect(screen.getByText('bundled-skill')).toBeTruthy()
    expect(screen.getByText(en.groupUser)).toBeTruthy()
    expect(screen.getByText(en.groupOthers)).toBeTruthy()
    // The owned row offers edit and delete; the foreign row offers neither.
    expect(screen.getAllByRole('button', { name: en.edit })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: en.remove })).toHaveLength(1)
  })

  it('shows the load failure instead of rows when the catalog rejects', async () => {
    const api = skillsApi({
      catalog: vi.fn(async () => ({ result: { ok: false as const, error: { code: 'internal', message: 'boom', details: {} } } })),
    })
    renderSection({ api: api as unknown as Pick<IApiClient, 'skills'> })
    expect(await screen.findByText(en.loadFailed)).toBeTruthy()
  })

  it('creates a skill through the form and refreshes the catalog', async () => {
    const injected = renderSection()
    fireEvent.click(await screen.findByRole('button', { name: en.create }))
    const name = await screen.findByRole('textbox', { name: en.name })
    fireEvent.change(name, { target: { value: 'brand-new' } })
    fireEvent.change(screen.getByRole('textbox', { name: en.description }), { target: { value: 'A brand new skill' } })
    fireEvent.change(screen.getByRole('textbox', { name: en.content }), { target: { value: 'New body.' } })
    fireEvent.click(screen.getByRole('button', { name: en.save }))
    await waitFor(() => {
      expect(injected.api.skills.save).toHaveBeenCalledWith(expect.objectContaining({
        name: 'brand-new',
        description: 'A brand new skill',
        content: 'New body.',
        modelInvocable: true,
        userInvocable: true,
      }))
    })
    // The dialog closes and the catalog is refetched.
    await waitFor(() => { expect(injected.api.skills.catalog).toHaveBeenCalledTimes(2) })
    expect(screen.queryByRole('textbox', { name: en.name })).toBeNull()
  })

  it('edits an owned skill with its stored body prefilled', async () => {
    const injected = renderSection()
    fireEvent.click(await screen.findByRole('button', { name: en.edit }))
    const name = await screen.findByRole('textbox', { name: en.name })
    await waitFor(() => { expect(injected.api.skills.read).toHaveBeenCalledWith({ name: 'my-skill' }) })
    expect((name as HTMLInputElement).value).toBe('my-skill')
    expect((screen.getByRole('textbox', { name: en.content }) as HTMLTextAreaElement).value).toBe('Body.')

    fireEvent.change(screen.getByRole('textbox', { name: en.description }), { target: { value: 'Updated description' } })
    fireEvent.click(screen.getByRole('button', { name: en.save }))
    await waitFor(() => {
      expect(injected.api.skills.save).toHaveBeenCalledWith(expect.objectContaining({ description: 'Updated description' }))
    })
    expect(injected.api.skills.save).toHaveBeenCalledWith(expect.objectContaining({ name: 'my-skill', content: 'Body.' }))
  })

  it('deletes an owned skill only after confirmation', async () => {
    const injected = renderSection()
    fireEvent.click(await screen.findByRole('button', { name: en.remove }))
    // The confirm dialog is open; the removal has not happened yet.
    expect(await screen.findByText(en.deleteDescription)).toBeTruthy()
    expect(injected.api.skills.remove).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: en.deleteConfirm }))
    await waitFor(() => { expect(injected.api.skills.remove).toHaveBeenCalledWith({ name: 'my-skill' }) })
    await waitFor(() => { expect(injected.api.skills.catalog).toHaveBeenCalledTimes(2) })
  })

  it('keeps the dialog open and shows the refusal when save fails', async () => {
    const api = skillsApi({
      save: vi.fn(async () => ({
        result: { ok: false as const, error: { code: 'skill-shadowed', message: 'taken by memory', details: {} } },
      })),
    })
    renderSection({ api: api as unknown as Pick<IApiClient, 'skills'> })
    fireEvent.click(await screen.findByRole('button', { name: en.create }))
    fireEvent.change(await screen.findByRole('textbox', { name: en.name }), { target: { value: 'taken' } })
    fireEvent.change(screen.getByRole('textbox', { name: en.description }), { target: { value: 'Dup' } })
    fireEvent.change(screen.getByRole('textbox', { name: en.content }), { target: { value: 'Body.' } })
    fireEvent.click(screen.getByRole('button', { name: en.save }))
    expect(await screen.findByText('taken by memory')).toBeTruthy()
    expect(screen.getByRole('textbox', { name: en.name })).toBeTruthy()
  })
})
