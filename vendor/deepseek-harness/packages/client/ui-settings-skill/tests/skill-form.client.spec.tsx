// @vitest-environment jsdom
/** The create/edit skill form: validation gates, invocation switches, and save wiring. */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { IApiClient } from '@deepseek-ai/dsh-api-remotes/client'
import { SkillForm } from '../src/client/SkillForm.tsx'
import { en, type SkillKey } from '../src/client/locales.ts'

afterEach(cleanup)

const t = ((key: SkillKey): string => en[key]) as (key: SkillKey) => string

function formApi(overrides: Record<string, ReturnType<typeof vi.fn>> = {}) {
  return {
    skills: {
      save: vi.fn(async () => ({ result: { ok: true as const, value: { entry: {} } } })),
      ...overrides,
    },
  }
}

function renderForm(overrides: { api?: unknown; initialName?: string; initialContent?: string } = {}) {
  const props = {
    mode: 'create' as const,
    api: formApi() as unknown as Pick<IApiClient, 'skills'>,
    t,
    onClose: vi.fn(),
    ...overrides,
  }
  render(<SkillForm {...props} />)
  return props
}

function fillRequired(name: string, description: string, content: string): void {
  fireEvent.change(screen.getByRole('textbox', { name: en.name }), { target: { value: name } })
  fireEvent.change(screen.getByRole('textbox', { name: en.description }), { target: { value: description } })
  fireEvent.change(screen.getByRole('textbox', { name: en.content }), { target: { value: content } })
}

describe('SkillForm', () => {
  it('refuses an invalid name with an inline error and a disabled submit', async () => {
    renderForm()
    fillRequired('Bad Name', 'Desc', 'Body.')
    expect(await screen.findByText(en.nameInvalid)).toBeTruthy()
    expect((screen.getByRole('button', { name: en.save }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('requires a description before submitting', async () => {
    renderForm()
    fireEvent.change(screen.getByRole('textbox', { name: en.name }), { target: { value: 'ok-name' } })
    fireEvent.change(screen.getByRole('textbox', { name: en.content }), { target: { value: 'Body.' } })
    expect((screen.getByRole('button', { name: en.save }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('sends the invocation switches, defaulting both to true', async () => {
    const props = renderForm()
    fillRequired('ok-name', 'Desc', 'Body.')
    fireEvent.click(screen.getByRole('checkbox', { name: en.userInvocable }))
    fireEvent.click(screen.getByRole('button', { name: en.save }))
    await vi.waitFor(() => {
      expect(props.api.skills.save).toHaveBeenCalledWith(expect.objectContaining({
        name: 'ok-name',
        modelInvocable: true,
        userInvocable: false,
      }))
    })
    expect(props.onClose).toHaveBeenCalledWith(true)
  })

  it('includes the when-to-use field only when filled', async () => {
    const props = renderForm()
    fillRequired('ok-name', 'Desc', 'Body.')
    fireEvent.change(screen.getByRole('textbox', { name: en.whenToUse }), { target: { value: 'Only on Fridays' } })
    fireEvent.click(screen.getByRole('button', { name: en.save }))
    await vi.waitFor(() => {
      expect(props.api.skills.save).toHaveBeenCalledWith(expect.objectContaining({ whenToUse: 'Only on Fridays' }))
    })
  })

  it('prefills an edit and omits nothing', async () => {
    renderForm({
      mode: 'edit',
      initialName: 'existing',
      initial: {
        name: 'existing',
        description: 'Existing desc',
        whenToUse: 'Existing hint',
        modelInvocable: false,
        userInvocable: true,
        source: 'user-dsh',
        provider: 'filesystem',
        owned: true,
      },
      initialContent: 'Existing body.',
    })
    expect((screen.getByRole('textbox', { name: en.name }) as HTMLInputElement).value).toBe('existing')
    expect((screen.getByRole('textbox', { name: en.description }) as HTMLInputElement).value).toBe('Existing desc')
    expect((screen.getByRole('textbox', { name: en.content }) as HTMLTextAreaElement).value).toBe('Existing body.')
    expect((screen.getByRole('checkbox', { name: en.modelInvocable }) as HTMLInputElement).checked).toBe(false)
    expect((screen.getByRole('checkbox', { name: en.userInvocable }) as HTMLInputElement).checked).toBe(true)
  })

  it('shows the refusal message and stays open when save fails', async () => {
    const api = formApi({
      save: vi.fn(async () => ({
        result: { ok: false as const, error: { code: 'skill-shadowed', message: 'taken by memory', details: {} } },
      })),
    })
    const props = renderForm({ api })
    fillRequired('taken', 'Desc', 'Body.')
    fireEvent.click(screen.getByRole('button', { name: en.save }))
    expect(await screen.findByText('taken by memory')).toBeTruthy()
    expect(screen.getByRole('textbox', { name: en.name })).toBeTruthy()
    expect(props.onClose).not.toHaveBeenCalled()
  })
})
