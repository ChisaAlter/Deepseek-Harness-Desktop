import { copyFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const pkg = dirname(fileURLToPath(new URL('.', import.meta.url)))
const dest = join(pkg, 'lib', 'assets')
mkdirSync(dest, { recursive: true })
copyFileSync(
  join(pkg, 'src/client/ghostty/vendor/ghostty-vt.wasm'),
  join(dest, 'ghostty-vt.wasm'),
)
copyFileSync(
  join(pkg, 'src/client/ghostty/vendor/ghostty-write-pty.wasm'),
  join(dest, 'ghostty-write-pty.wasm'),
)
copyFileSync(
  join(pkg, 'src/client/ghostty/fonts/SymbolsNerdFontMono-Regular.woff2'),
  join(dest, 'SymbolsNerdFontMono-Regular.woff2'),
)
