import { expect, it } from 'vitest'
import { formatBalance } from '../src/client/formatBalance.ts'

it.each([
  ['0.000000', '¥0.00'], ['12.34000000', '¥12.34'], ['1234.56999', '¥1,234.56'],
  ['0.00000001', '<¥0.01'], ['0.01', '¥0.01'], ['-0.000001', '-¥0.01'],
  ['-12.345', '-¥12.35'], ['-0.0000', '¥0.00'],
])('formats %s using Platform currency rules', (amount, expected) => {
  expect(formatBalance(amount, '¥')).toBe(expected)
})
