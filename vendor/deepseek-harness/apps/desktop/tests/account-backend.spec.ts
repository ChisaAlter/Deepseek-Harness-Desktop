import { expect, it } from 'vitest'
import { accountView, desktopAccountBackend } from '../src/account-backend.ts'

it('projects only safe account fields and refuses non-browser authorization schemes', () => {
  const state = { links: { usageUrl: 'http://localhost/usage', topUpUrl: 'http://localhost/top_up' }, status: 'signed-out', token: 'not-for-the-renderer',
    attempt: { id: 'test', phase: 'waiting-browser', authorizeUrl: 'https://platform.deepseek.com/dsh/authorize', codeVerifier: 'private' } }
  expect(accountView(state)).toEqual({ links: { usageUrl: 'http://localhost/usage', topUpUrl: 'http://localhost/top_up' }, status: 'signed-out', attempt: {
    id: 'test', phase: 'waiting-browser', authorizeUrl: 'https://platform.deepseek.com/dsh/authorize',
  } })
  for (const authorizeUrl of ['file:///tmp/example', 'javascript:alert(1)', 'http://example.com/login']) {
    expect(() => accountView({ ...state, attempt: { ...state.attempt, authorizeUrl } })).toThrow()
  }
  expect(() => accountView({ ...state, links: { usageUrl: 'file:///tmp/example', topUpUrl: 'https://example.com/top_up' } })).toThrow()
  expect(() => accountView({ ...state, attempt: { ...state.attempt, expiresAt: 'tomorrow' } })).toThrow()
  expect(() => accountView({ ...state, attempt: { ...state.attempt, errorCode: 'raw-server-message' } })).toThrow()
})

it('uses account Remote commands without returning additional wire fields', async () => {
  const requests: unknown[] = []
  const backend = desktopAccountBackend('http://127.0.0.1:1234', (request) => {
    requests.push(request)
    return Promise.resolve({ links: { usageUrl: 'http://localhost/usage', topUpUrl: 'http://localhost/top_up' }, status: 'signed-out', attempt: null, token: 'private' })
  }, () => Promise.resolve(''))
  expect(await backend.start('en')).toEqual({ links: { usageUrl: 'http://localhost/usage', topUpUrl: 'http://localhost/top_up' }, status: 'signed-out', attempt: null })
  expect(requests).toEqual([{ namespace: 'account', method: 'startSignIn', args: { locale: 'en', callbackOrigin: 'http://127.0.0.1:1234', loginSource: 'desktop' } }])
})
