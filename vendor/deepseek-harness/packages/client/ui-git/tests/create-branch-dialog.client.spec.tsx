// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { CreateBranchDialog, type CreateBranchDialogProps } from '../src/client/CreateBranchDialog.tsx'
import { en } from '../src/client/locales.ts'

const t: CreateBranchDialogProps['t'] = (key, params) => {
  const template = (en as Record<string, string>)[key] ?? key
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (
    name in params ? String(params[name]) : match
  ))
}

afterEach(cleanup)

function mount(overrides: Partial<CreateBranchDialogProps> = {}) {
  const props: CreateBranchDialogProps = {
    open: true,
    name: '',
    taken: false,
    t,
    onClose: vi.fn(),
    onName: vi.fn(),
    onSubmit: vi.fn(),
    ...overrides,
  }
  render(<CreateBranchDialog {...props} />)
  return props
}

describe('CreateBranchDialog', () => {
  it('shows the create-and-checkout copy and disables submit until a name is typed', () => {
    mount()
    expect(screen.getByRole('dialog', { name: 'Create and checkout new branch' })).toBeTruthy()
    expect(screen.getByText('Create a new local branch from the current HEAD and switch to it immediately.')).toBeTruthy()
    expect(screen.getByText('This version only creates and switches from the current HEAD.')).toBeTruthy()
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Create and switch' }).disabled).toBe(true)
  })

  it('forwards the name and submits when the draft is unique', () => {
    const onName = vi.fn()
    const onSubmit = vi.fn()
    mount({ name: 'feature/git-branch-switcher', onName, onSubmit })
    fireEvent.change(screen.getByRole('textbox', { name: 'Branch name' }), {
      target: { value: 'feature/x' },
    })
    expect(onName).toHaveBeenCalledWith('feature/x')
    fireEvent.click(screen.getByRole('button', { name: 'Create and switch' }))
    expect(onSubmit).toHaveBeenCalled()
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Branch name' }), { key: 'Enter' })
    expect(onSubmit).toHaveBeenCalledTimes(2)
  })

  it('disables submit when the name is already taken', () => {
    mount({ name: 'main', taken: true })
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Create and switch' }).disabled).toBe(true)
  })
})
