import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const implementationFiles = [
  new URL('../src/client/DshdMiniPlayer.tsx', import.meta.url),
  new URL('../src/client/BrowserSurfaceSlot.tsx', import.meta.url),
  new URL('../src/client/mini-player-state.ts', import.meta.url),
].map((url) => readFileSync(url, 'utf8')).join('\n')
const implementationWithoutComments = implementationFiles.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')

describe('dshd mini-player structural contract', () => {
  it('reuses the existing preview runtime and does not add a host channel', () => {
    expect(implementationFiles).toMatch(/runtime\.previewShow/)
    expect(implementationFiles).toMatch(/runtime\.previewResize/)
    expect(implementationFiles).toMatch(/runtime\.previewHide/)
    expect(implementationWithoutComments).not.toMatch(/BrowserWindow|BrowserView|ipcRenderer|ipcMain/)
  })
})
