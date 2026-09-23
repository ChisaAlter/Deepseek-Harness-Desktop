// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { AssistantMarkdown, localPathMediaUrl } from '../src/client/chat/AssistantMarkdown.tsx'
import { useDetailedPresentation } from './presentation-fixture.client.ts'
import { useDisclosure } from '../src/client/chat/use-disclosure.ts'
import type { ChatNodeOwnerProps, ChatViewSlotProps } from '../src/client/contract/slots.ts'
import type { AssistantBlock } from '../src/client/contract/snapshot.ts'

afterEach(cleanup)

const t = ((_key: string) => 'label') as ChatViewSlotProps['t']
const renderMessageImages = (() => null) as ChatNodeOwnerProps['renderMessageImages']

function textBlock(text: string): AssistantBlock {
  return { kind: 'text', text }
}

function reasoningBlock(text: string): AssistantBlock {
  return { kind: 'reasoning', text }
}

const BASE = 'http://127.0.0.1:3080/'
const MOUNTED_BASE = 'http://127.0.0.1:3080/tools/dsh/'

describe('localPathMediaUrl', () => {
  it('maps an absolute POSIX path to the file route of the document, root or mount', () => {
    const path = encodeURIComponent('/tmp/graph.png')
    for (const [base, root] of [
      [BASE, BASE],
      ['https://127.0.0.1:3080/', 'https://127.0.0.1:3080/'],
      [MOUNTED_BASE, MOUNTED_BASE],
      ['http://127.0.0.1:3080/tools/dsh/index.html', MOUNTED_BASE],
    ]) {
      expect(localPathMediaUrl(base!, '/tmp/graph.png')).toBe(`${root!}api/file?path=${path}`)
    }
  })

  it('keeps non-HTTP transports inert', () => {
    expect(localPathMediaUrl('about:blank', '/tmp/graph.png')).toBeUndefined()
    expect(localPathMediaUrl('dsh-app://app/', '/tmp/graph.png')).toBeUndefined()
    expect(localPathMediaUrl('file:///app', '/tmp/graph.png')).toBeUndefined()
    expect(localPathMediaUrl('ws://127.0.0.1:3080/', '/tmp/graph.png')).toBeUndefined()
  })

  it('keeps destinations that cannot be Host-served local files inert', () => {
    expect(localPathMediaUrl(BASE, '')).toBeUndefined()
    expect(localPathMediaUrl(BASE, '//cdn.example.com/x.png')).toBeUndefined()
    expect(localPathMediaUrl(BASE, 'relative.png')).toBeUndefined()
    expect(localPathMediaUrl(BASE, 'C:\\tmp\\x.png')).toBeUndefined()
  })

  it('encodes the full path including spaces', () => {
    expect(localPathMediaUrl(BASE, '/tmp/my graph.png'))
      .toBe(`${BASE}api/file?path=${encodeURIComponent('/tmp/my graph.png')}`)
  })
})

describe('AssistantMarkdown local-path images', () => {
  it('renders a local image path in closing prose through the same-origin API', () => {
    const { container } = render(
      <AssistantMarkdown useDisclosure={useDisclosure}
        usePresentation={useDetailedPresentation}
        blocks={[textBlock('See ![diagram](/tmp/graph.png) for the layout.')]}
        streaming={false}
        renderMessageImages={renderMessageImages}
        t={t}
      />,
    )
    const image = container.querySelector('img')
    expect(image?.getAttribute('alt')).toBe('diagram')
    const url = new URL(image?.getAttribute('src') ?? '')
    expect(url.pathname).toBe('/api/file')
    expect(url.searchParams.get('path')).toBe('/tmp/graph.png')
  })

  it('keeps non-absolute destinations inert', () => {
    const { container } = render(
      <AssistantMarkdown useDisclosure={useDisclosure}
        usePresentation={useDetailedPresentation}
        blocks={[textBlock('See ![diagram](relative.png).')]}
        streaming={false}
        renderMessageImages={renderMessageImages}
        t={t}
      />,
    )
    expect(container.querySelector('img')).toBeNull()
    expect(container.textContent).toContain('diagram')
  })

  it('renders a local image path inside an expanded Think row through the same vocabulary', () => {
    const { container } = render(
      <AssistantMarkdown
        useDisclosure={useDisclosure}
        usePresentation={useDetailedPresentation}
        blocks={[reasoningBlock('Checking the shot ![shot](/tmp/screen.png) first.')]}
        streaming={false}
        renderMessageImages={renderMessageImages}
        t={t}
      />,
    )
    // The Think disclosure starts collapsed; open it to reach the image.
    fireEvent.click(screen.getByText('label'))
    const image = container.querySelector('img')
    expect(image?.getAttribute('alt')).toBe('shot')
    const url = new URL(image?.getAttribute('src') ?? '')
    expect(url.pathname).toBe('/api/file')
    expect(url.searchParams.get('path')).toBe('/tmp/screen.png')
  })
})
