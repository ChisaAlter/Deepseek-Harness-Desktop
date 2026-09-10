import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { browserBundledExternals, browserPackageOfFile, browserSourceAliases } from './browser-bundled-externals.ts'

const roots: string[] = []
const repositoryRoot = resolve(import.meta.dirname, '..')

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-browser-notices-'))
  roots.push(root)
  write(root, 'package.json', '{"type":"module"}')
  write(root, 'tsconfig.base.json', JSON.stringify({
    compilerOptions: {
      module: 'esnext', target: 'es2022', jsx: 'react-jsx',
      paths: { '@fixture/static': ['./packages/client/static/src/index.ts'] },
    },
  }))
  write(root, 'tsconfig.base.client.json', '{"extends":"./tsconfig.base.json"}')
  return root
}

function write(root: string, path: string, text: string): void {
  const target = join(root, path)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, text)
}

function library(root: string, name: string, source = 'export const value = 1'): void {
  write(root, `node_modules/${name}/package.json`, JSON.stringify({ name, type: 'module', exports: './index.js' }))
  write(root, `node_modules/${name}/index.js`, source)
}

function dynamicPlugin(root: string, source: string): void {
  write(root, 'packages/client/dynamic/package.json', JSON.stringify({
    name: '@fixture/dynamic', dsh: { client: { platform: 'web' } },
  }))
  write(root, 'packages/client/dynamic/tsdown.config.ts', [
    'export default {',
    '  name: "@fixture/dynamic/client",',
    '  entry: { client: "src/client/index.ts" },',
    '  inputOptions: { resolve: { conditionNames: ["browser", "import", "default"] } },',
    '}',
  ].join('\n'))
  write(root, 'packages/client/dynamic/src/client/index.ts', source)
}

describe('browser dependency discovery', () => {
  it('records runtime imports through the client config without following upstream dependencies or erased types', async () => {
    const root = fixture()
    library(root, 'browser-lib', 'export { value } from "transitive-lib"')
    library(root, 'transitive-lib')
    dynamicPlugin(root, [
      'import type { MissingType } from "type-only-lib"',
      'import { value } from "browser-lib"',
      'export const output: MissingType = value',
    ].join('\n'))

    expect(await browserBundledExternals(root)).toEqual(new Set(['browser-lib']))
    expect(existsSync(join(root, 'packages/client/dynamic/lib'))).toBe(false)
  })

  it('rejects an unresolved runtime library', async () => {
    const root = fixture()
    dynamicPlugin(root, 'export { value } from "missing-browser-lib"')
    await expect(browserBundledExternals(root)).rejects.toThrow('cannot resolve missing-browser-lib')
  })

  it('rejects a declared client without its browser config', async () => {
    const root = fixture()
    dynamicPlugin(root, 'export const value = 1')
    write(root, 'packages/client/dynamic/tsdown.config.ts', 'export default { name: "@fixture/dynamic", entry: "src/index.ts" }')
    await expect(browserBundledExternals(root)).rejects.toThrow('has no browser build config')
  })

  it('follows shell workspace aliases, CSS assets and lazy imports without writing output', async () => {
    const root = fixture()
    library(root, 'shell-lib')
    library(root, 'lazy-lib')
    library(root, 'asset-lib')
    write(root, 'node_modules/asset-lib/package.json', JSON.stringify({
      name: 'asset-lib', exports: { './theme.css': './theme.css' },
    }))
    write(root, 'node_modules/asset-lib/theme.css', '.fixture { color: red }')
    write(root, 'packages/client/static/package.json', '{"name":"@fixture/static"}')
    write(root, 'packages/client/static/src/index.ts', [
      'import { value } from "shell-lib"',
      'import "asset-lib/theme.css"',
      'export const output = value',
      'export const lazy = () => import("lazy-lib")',
    ].join('\n'))
    const app = join(root, 'apps/web')
    write(root, 'apps/web/package.json', '{"name":"@fixture/web","type":"module","exports":{"./dist/*":"./dist/*"}}')
    symlinkSync(resolve(repositoryRoot, 'apps/web/node_modules'), join(app, 'node_modules'), 'junction')
    write(root, 'apps/web/index.html', '<script type="module" src="./main.ts"></script>')
    write(root, 'apps/web/main.ts', 'import { output, lazy } from "@fixture/static"; console.log(output); void lazy()')
    write(root, 'apps/web/vite.config.ts', `export default {
      build: { rollupOptions: { input: { index: ${JSON.stringify(join(app, 'index.html'))}, preview: "missing-preview.ts" } } }
    }`)
    write(root, 'apps/web/dist/sentinel.txt', 'untouched')

    expect(await browserBundledExternals(root)).toEqual(new Set(['shell-lib', 'lazy-lib', 'asset-lib']))
    expect(readFileSync(join(app, 'dist/sentinel.txt'), 'utf8')).toBe('untouched')
    expect(existsSync(join(app, 'dist/index.html'))).toBe(false)
    expect(existsSync(join(root, 'packages/client/static/lib'))).toBe(false)
  })

  it('normalizes installed module ids and excludes virtual/workspace modules', () => {
    expect(browserPackageOfFile('/repo/node_modules/.pnpm/pkg@1/node_modules/pkg/a.js')).toBe('pkg')
    expect(browserPackageOfFile('C:\\repo\\node_modules\\@scope\\pkg\\a.css?url')).toBe('@scope/pkg')
    expect(browserPackageOfFile('/repo/packages/client/a.ts')).toBeUndefined()
    expect(browserPackageOfFile('\0vite/modulepreload-polyfill')).toBeUndefined()
  })

  it('maps exact names and subpaths from the source facade', () => {
    const root = fixture()
    const aliases = browserSourceAliases(root)
    expect('@fixture/static'.replace(aliases[0]!.find, aliases[0]!.replacement))
      .toBe(join(root, 'packages/client/static/src/index.ts'))
    expect(aliases[0]!.find.test('@fixture/static-extra')).toBe(false)
  })
})
