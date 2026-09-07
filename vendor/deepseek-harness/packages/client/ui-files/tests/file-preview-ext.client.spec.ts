import { describe, expect, it } from 'vitest'
import {
  isWorkspaceBrowserPreviewPath,
  isWorkspaceImagePreviewPath,
  isWorkspacePreviewEntryPath,
} from '../src/client/workspacePreview.ts'

describe('workspace file previews', () => {
  it.each(['report.html', 'report.HTM', 'document.pdf?download=1', 'page.xhtml'])(
    'recognizes browser preview path %s',
    (path) => {
      expect(isWorkspaceBrowserPreviewPath(path)).toBe(true)
      expect(isWorkspacePreviewEntryPath(path)).toBe(true)
    },
  )

  it.each([
    'icon.png',
    'photo.JPEG',
    'animation.gif',
    'vector.svg#mark',
    'texture.webp',
    'image.avif',
  ])('recognizes image preview path %s', (path) => {
    expect(isWorkspaceImagePreviewPath(path)).toBe(true)
    expect(isWorkspacePreviewEntryPath(path)).toBe(true)
  })

  it('keeps SVG in the image viewer instead of the Browser', () => {
    expect(isWorkspaceImagePreviewPath('vector.svg')).toBe(true)
    expect(isWorkspaceBrowserPreviewPath('vector.svg')).toBe(false)
  })

  it.each(['README.md', 'src/index.ts', 'image.png.ts', 'png'])(
    'rejects non-preview path %s',
    (path) => {
      expect(isWorkspacePreviewEntryPath(path)).toBe(false)
    },
  )
})
