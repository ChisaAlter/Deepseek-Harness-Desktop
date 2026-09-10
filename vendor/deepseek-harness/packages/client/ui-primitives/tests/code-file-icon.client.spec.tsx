// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import {
  classifyFileType, FileTypeIcon, type CodeFileType, type FileTypeProjectContext,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { CODE_FILE_TYPES } from '../src/code-file-types.ts'

afterEach(cleanup)

const flutter: FileTypeProjectContext = {
  files: { 'config/pubspec.yaml': 'name: demo\ndependencies:\n  flutter: sdk' },
}

describe('code-file classification', () => {
  it.each([
    ['app.component.ts', 'angular'],
    ['file.c', 'c'],
    ['file.clj', 'clojure'],
    ['CMakeLists.txt', 'cmake'],
    ['file.cc', 'cpp'],
    ['file.cs', 'csharp'],
    ['file.css', 'css'],
    ['file.dart', 'dart'],
    ['Dockerfile', 'docker'],
    ['file.ex', 'elixir'],
    ['.env', 'env'],
    ['file.erl', 'erlang'],
    ['.gitignore', 'git'],
    ['file.go', 'go'],
    ['file.graphql', 'graphql'],
    ['file.hs', 'haskell'],
    ['file.ini', 'ini'],
    ['file.java', 'java'],
    ['file.js', 'javascript'],
    ['file.json', 'json'],
    ['file.kt', 'kotlin'],
    ['file.lua', 'lua'],
    ['Makefile', 'makefile'],
    ['package.json', 'node'],
    ['file.m', 'objective-c'],
    ['file.pl', 'perl'],
    ['file.php', 'php'],
    ['file.ps1', 'powershell'],
    ['file.proto', 'protobuf'],
    ['file.py', 'python'],
    ['file.r', 'r'],
    ['file.jsx', 'react'],
    ['Gemfile', 'ruby'],
    ['file.rs', 'rust'],
    ['file.scala', 'scala'],
    ['.bashrc', 'shell'],
    ['file.sol', 'solidity'],
    ['file.sql', 'sql'],
    ['file.svelte', 'svelte'],
    ['file.swift', 'swift'],
    ['file.toml', 'toml'],
    ['file.ts', 'typescript'],
    ['file.vue', 'vue'],
    ['file.wasm', 'wasm'],
    ['file.xml', 'xml'],
    ['file.yaml', 'yaml'],
    ['file.zig', 'zig'],
  ] as [string, CodeFileType][])('%s → %s', (path, type) => {
    expect(classifyFileType(path)).toBe(type)
  })

  it('applies filename priority before generic extensions', () => {
    expect(classifyFileType('package.json')).toBe('node')
    expect(classifyFileType('docker-compose.yaml')).toBe('docker')
    expect(classifyFileType('feature.component.ts')).toBe('angular')
    expect(classifyFileType('Dockerfile.local')).toBe('docker')
    expect(classifyFileType('.env.production')).toBe('env')
  })

  it('selects Flutter only when the supplied project snapshot identifies it', () => {
    expect(classifyFileType('lib/main.dart')).toBe('dart')
    expect(classifyFileType('lib/main.dart', { files: { 'pubspec.yaml': 'name: demo' } })).toBe('dart')
    expect(classifyFileType('lib/main.dart', flutter)).toBe('flutter')

    const view = render(<FileTypeIcon path="lib/main.dart" context={flutter} />)
    const explicit = render(<FileTypeIcon kind="flutter" />)
    expect(view.container.innerHTML).toBe(explicit.container.innerHTML)
  })

  it('keeps Markdown and SVG on the traditional file artwork', () => {
    expect(classifyFileType('README.md')).toBe('markdown')
    expect(classifyFileType('logo.svg')).toBe('image')
  })
})

describe('full-color code-file artwork', () => {
  it.each(CODE_FILE_TYPES)('%s renders its supplied square SVG', (type) => {
    const { container } = render(<FileTypeIcon kind={type} />)
    const svg = container.querySelector('svg')!
    expect(svg.getAttribute('viewBox')).toBe('0 0 20 20')
    expect(svg.getAttribute('width')).toBe('28')
    expect(svg.getAttribute('aria-hidden')).toBe('true')
    expect(container.innerHTML).toMatch(/#[0-9a-fA-F]{3,8}/)
    expect(container.innerHTML).not.toContain('currentColor')
  })

  it('keeps every code category visually distinct', () => {
    const artwork = CODE_FILE_TYPES.map((type) => {
      const { container } = render(<FileTypeIcon kind={type} />)
      return container.querySelector('svg')!.innerHTML
    })
    expect(new Set(artwork).size).toBe(CODE_FILE_TYPES.length)
  })

  it('uses instance-safe gradient ids and forwards sizing classes', () => {
    const { container } = render(<><FileTypeIcon kind="elixir" /><FileTypeIcon kind="elixir" /></>)
    const ids = [...container.querySelectorAll('linearGradient')].map(gradient => gradient.id)
    expect(new Set(ids).size).toBe(2)
    expect([...container.querySelectorAll('rect')].map(rect => rect.getAttribute('fill'))).toEqual(ids.map(id => `url(#${id})`))

    const sized = render(<FileTypeIcon path="file.ts" size={16} className="x" />)
    const svg = sized.container.querySelector('svg')!
    expect(svg.getAttribute('width')).toBe('16')
    expect(svg.getAttribute('height')).toBe('16')
    expect(svg.classList.contains('x')).toBe(true)
  })
})
