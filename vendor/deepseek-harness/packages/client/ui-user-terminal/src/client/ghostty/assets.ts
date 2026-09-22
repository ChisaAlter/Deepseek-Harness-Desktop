/**
 * Plugin-hosted Ghostty artifacts. The desktop host loads these with Vite `?url`;
 * dsh serves the same bytes at `/plugins/<id>/assets/<file>`.
 */

const PLUGIN_ID = '@deepseek-ai/dsh-client-ui-user-terminal'

function ghosttyAssetUrl(filename: string): string {
  return `/plugins/${PLUGIN_ID}/assets/${filename}`
}

/** libghostty-vt wasm, same artifact this adapter vendors. */
export const ghosttyWasmUrl = ghosttyAssetUrl('ghostty-vt.wasm')
/** 112-byte PTY callback trampoline, same artifact this adapter vendors. */
export const ghosttyWritePtyWasmUrl = ghosttyAssetUrl('ghostty-write-pty.wasm')
/** Symbols-only Nerd Font the adapter registers lazily for prompt glyphs. */
export const symbolsFontUrl = ghosttyAssetUrl('SymbolsNerdFontMono-Regular.woff2')
