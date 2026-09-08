import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [tsconfigPaths({ projects: [fileURLToPath(new URL('../../../../../tsconfig.base.json', import.meta.url))] })],
  esbuild: { jsx: 'automatic' },
  server: { host: '127.0.0.1', port: 5178, strictPort: true },
})
