import { defineConfig } from 'tsdown'
import { build } from 'vite'
import { fileURLToPath } from 'node:url'
import { readFile } from 'node:fs/promises'

export default defineConfig([
  {
    entry: ['lib/types/main.js'],
    onSuccess: async () => {
      await build({
        configFile: false,
        plugins: [{
          name: 'desktop-brand-font',
          async generateBundle() {
            for (const name of ['brand-font.css', 'montserrat-regular.woff2', 'montserrat-light.woff2', 'montserrat-medium.woff2', 'Montserrat-OFL.txt']) {
              this.emitFile({
                type: 'asset',
                fileName: name,
                source: await readFile(new URL(`../../packages/client/ui-theme/src/styles/${name}`, import.meta.url)),
              })
            }
          },
        }],
        root: fileURLToPath(new URL('.', import.meta.url)),
        esbuild: { jsx: 'automatic' },
        define: { 'process.env.NODE_ENV': JSON.stringify('production') },
        build: {
          outDir: 'lib/welcome',
          emptyOutDir: true,
          lib: {
            entry: 'src/client/welcome.tsx',
            formats: ['iife'],
            name: 'DesktopWelcome',
            fileName: () => 'welcome.js',
            cssFileName: 'welcome',
          },
        },
      })
    },
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
    deps: { neverBundle: ['electron'] },
  },
  ...(['preload-app', 'preload-welcome', 'preload-platform-account', 'preload-mandatory', 'preload-update-dialog'] as const).map(name => ({
    // Sandboxed Electron preloads run as CommonJS even though the application package is ESM.
    entry: { [name]: `lib/types/${name}.js` },
    outDir: 'lib',
    format: 'cjs' as const,
    codeSplitting: false,
    platform: 'node' as const,
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
    deps: { neverBundle: ['electron'] },
  })),
])
