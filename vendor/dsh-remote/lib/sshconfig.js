// dsh-remote — ~/.ssh/config parser for the "import from ssh config" feature.
// Pure parsing (no auth material is ever read: only Host/HostName/User/Port/
// IdentityFile/ProxyJump). IdentityFile is imported as a PATH reference only —
// the plugin never auto-reads keys (v0.5.5 policy).
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

export const sshConfigPath = () => path.join(homedir(), '.ssh', 'config')

/** Read the user's ~/.ssh/config text ('' when absent/unreadable). */
export function readSshConfigText(filePath = sshConfigPath()) {
  try {
    return readFileSync(filePath, 'utf8')
  } catch {
    return ''
  }
}

/**
 * Parse OpenSSH config text into host entries.
 * @returns {Array<{host: string, hostName: string, user: string, port: number, identityFile: string, proxyJump: string}>}
 *   host = alias pattern (may be '*' / '!foo' / comma list — caller filters).
 */
export function parseSshConfig(text) {
  const entries = []
  let cur = null
  const lines = String(text || '').split('\n')
  for (const raw of lines) {
    const line = raw.trim()
    if (!line || line.startsWith('#') || line.startsWith('Include ')) continue
    const m = line.match(/^(\S+)\s+(.*)$/)
    if (!m) continue
    const key = m[1].toLowerCase()
    const val = m[2].trim()
    if (key === 'host') {
      cur = { host: val, hostName: '', user: '', port: 22, identityFile: '', proxyJump: '' }
      entries.push(cur)
      continue
    }
    if (!cur) continue
    if (key === 'hostname') cur.hostName = val
    else if (key === 'user') cur.user = val
    else if (key === 'port') cur.port = Number(val) || 22
    else if (key === 'identityfile') cur.identityFile = val
    else if (key === 'proxyjump') cur.proxyJump = val
  }
  return entries
}

/** Entries a user can actually import: concrete aliases (skip wildcards). */
export function importableEntries(text) {
  return parseSshConfig(text).filter((e) => {
    if (!e.host || e.host.includes('*') || e.host.includes('!') || e.host.includes(',')) return false
    return e.hostName || e.user || e.port !== 22 || e.identityFile || e.proxyJump
  })
}
