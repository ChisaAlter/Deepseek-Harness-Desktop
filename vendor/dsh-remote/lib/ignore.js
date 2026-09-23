// dsh-remote — gitignore-style ignore matcher for mirror sync / remote search.
import { readFileSync } from 'node:fs'
//
// Deliberately a SUBSET of gitignore semantics (documented, no surprises):
//   - blank lines and `#` comments are skipped
//   - `!` negation is NOT supported (later rules never un-ignore)
//   - a trailing `/` matches directories only (and everything under them)
//   - a pattern containing `/` (or starting with `/`) is anchored to the
//     workspace root; otherwise it matches the basename at ANY depth
//   - `*` matches any run of chars except `/`; `**` matches any run incl. `/`;
//     `?` matches one char except `/`
//   - character classes (`[abc]`) are not supported (treated literally)

/** Convert one glob segment to a regex source (no `/` crossing). A leading
 * double-star-slash (`**` + `/`) matches zero or more directories (gitignore). */
function globToRe(glob) {
  let out = ''
  let i = 0
  const s = String(glob)
  if (s.startsWith('**/')) { out = '(?:.*/)?'; i = 3 }
  while (i < s.length) {
    const c = s[i]
    if (c === '*') {
      if (s[i + 1] === '*') { out += '.*'; i += 2; continue }
      out += '[^/]*'; i++; continue
    }
    if (c === '?') { out += '[^/]'; i++; continue }
    if ('\\^$+{}[]()|.'.includes(c)) out += '\\' + c
    else out += c
    i++
  }
  return out
}

/**
 * Compile a list of ignore patterns into a matcher.
 * @param {string[]|string} patterns lines or an array of lines
 * @returns {(relPath: string, isDir?: boolean) => boolean} true = ignored.
 *   `relPath` is POSIX-style ('/' separated, no leading '/').
 */
export function compileIgnore(patterns) {
  const rules = []
  const lines = Array.isArray(patterns) ? patterns : String(patterns || '').split('\n')
  for (let raw of lines) {
    let line = String(raw || '').trim()
    if (!line || line.startsWith('#')) continue
    let dirOnly = false
    if (line.endsWith('/')) { dirOnly = true; line = line.slice(0, -1) }
    let anchored = line.startsWith('/')
    if (anchored) line = line.slice(1)
    if (!line) continue
    const hasSlash = line.includes('/')
    const isAnchored = anchored || hasSlash
    const segRe = globToRe(line)
    let re
    if (isAnchored) {
      // Root-anchored: match the full path from the root.
      re = dirOnly
        ? new RegExp('^' + segRe + '(/.*)?$')
        : new RegExp('^' + segRe + '$')
    } else {
      // Basename at any depth; a dir pattern also covers everything under it.
      re = dirOnly
        ? new RegExp('(^|/)' + segRe + '(/|$)')
        : new RegExp('(^|/)' + segRe + '$')
    }
    rules.push({ re, dirOnly })
  }
  return function isIgnored(relPath, isDir) {
    const rel = String(relPath || '').replace(/^\/+/, '').replace(/\\/g, '/')
    if (!rel) return false
    for (const r of rules) {
      if (r.re.test(rel)) return true
    }
    return false
  }
}

/** Built-in defaults: never pull/push these into/from a mirror. */
export const DEFAULT_IGNORE = [
  '.git/',
  '.svn/',
  '.hg/',
  'node_modules/',
  'target/',
  'dist/',
  'build/',
  '.venv/',
  'venv/',
  '__pycache__/',
  '.idea/',
  '.vscode/',
  '*.o',
  '*.a',
  '*.so',
  '*.dylib',
  '*.exe',
  '*.dll',
  '*.class',
  '*.jar',
  '*.log',
  '*.tmp',
  '.DS_Store',
  'Thumbs.db',
  '.dsh-remote-meta.json',
  '.dsh-remote-sync-state.json',
]

/**
 * Load the user ignore file (gitignore syntax) and merge with defaults.
 * Returns `{ patterns, fromFile }`.
 */
export function loadIgnore(ignoreFile) {
  let fromFile = []
  if (ignoreFile) {
    try {
      const text = readFileSync(ignoreFile, 'utf8')
      fromFile = text.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
    } catch { /* missing file → defaults only */ }
  }
  const patterns = DEFAULT_IGNORE.concat(fromFile)
  return { patterns, fromFile, matcher: compileIgnore(patterns) }
}
