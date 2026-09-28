import test from 'node:test'
import assert from 'node:assert/strict'
import { assertBuiltShell } from './check-built-shell.mjs'

const frame = '.frame{border-radius:var(--dsw-radius-xl);corner-shape:round}.caption{--dsh-windows-content-radius:20px;}'
const theme = ':root{--dsw-radius-xl:20px;}'

test('built check resolves the emitted token without assuming declaration order', () => {
  assert.doesNotThrow(() => assertBuiltShell(frame, theme))
  assert.doesNotThrow(() => assertBuiltShell(frame.replace('border-radius:var(--dsw-radius-xl);corner-shape:round', 'corner-shape:round;border-radius:var(--dsw-radius-xl)'), theme))
})

test('built check rejects stale radius, missing token and changed corner geometry', () => {
  assert.throws(() => assertBuiltShell(frame, theme.replace('20px', '16px')))
  assert.throws(() => assertBuiltShell(frame, ''))
  assert.throws(() => assertBuiltShell(frame.replace('round', 'superellipse(1.5)'), theme))
  assert.throws(() => assertBuiltShell(frame.replace('--dsh-windows-content-radius:20px', '--dsh-windows-content-radius:16px'), theme))
})
