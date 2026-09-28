import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** Validate the built radius contract after the vendor build, not in source-only unit jobs. */
export function assertBuiltShell(frame, theme) {
  const radius = theme.match(/--dsw-radius-xl:\s*([^;]+);/)?.[1]
  assert.equal(radius, '20px', 'built theme must keep the 20px frame token')
  const resolved = frame.replaceAll('var(--dsw-radius-xl)', radius)
  assert.match(resolved, /\{[^}]*border-radius:20px;[^}]*corner-shape:round|\{[^}]*corner-shape:round;[^}]*border-radius:20px/)
  assert.match(resolved, /--dsh-windows-content-radius:20px/)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const client = path.join(root, 'vendor/deepseek-harness/packages/client')
  assertBuiltShell(
    fs.readFileSync(path.join(client, 'ui-layout/lib/client.js'), 'utf8'),
    fs.readFileSync(path.join(client, 'ui-theme/lib/client.js'), 'utf8'),
  )
  console.log('built shell silhouette: verified')
}
