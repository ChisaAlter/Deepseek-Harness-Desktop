/** File association results and explicit handler authorization at the native command adapter. */
import { describe, expect, it, vi, onTestFinished } from 'vitest'
import * as runner from '../src/runner.ts'
import { nativeFileApplications, openNativeFileApplication } from '../src/file-applications.ts'

const application = { id: '/Applications/Music.app', name: 'Music', default: true, icon: null }
const signal = new AbortController().signal

describe('native file associations', () => {
  it('passes file paths as arguments and preserves the desktop default', async () => {
    const run = vi.fn(async () => ({ stdout: JSON.stringify([application]), stderr: '' }))
    const path = '/tmp/中文 $(touch nope).mp3'
    await expect(nativeFileApplications(path, signal, { platform: 'darwin', run })).resolves.toEqual([application])
    expect(run).toHaveBeenCalledWith('osascript', ['-l', 'JavaScript', '-e', expect.any(String), path, 'icons'], signal)
  })

  it.each(['{}', '[null]', '[{"id":1}]', '[{"id":"/a.app","default":false,"icon":null,"bundle":"b"}]', '[{"id":"/a.app","name":"A","default":false,"icon":null,"bundle":5}]', JSON.stringify([{ ...application, icon: 'javascript:alert(1)' }])])('rejects malformed native output %s', async (stdout) => {
    await expect(nativeFileApplications('/file.mp3', signal, {
      platform: 'darwin', run: async () => ({ stdout, stderr: '' }),
    })).rejects.toThrow()
  })

  it('collapses duplicate copies of one application to its default or newest install', async () => {
    const copy = (id: string, name: string, extra: object) => ({ id, name, default: false, icon: null, ...extra })
    const stdout = JSON.stringify([
      copy('/Applications/Quark.app', '夸克', { default: true, bundle: 'com.quark.desktop', version: '7.1.5' }),
      copy('/Applications/Doubao.app', '豆包', { bundle: 'com.bot.pc.doubao', version: '2.18.12' }),
      copy('/Applications/Xcode.app', 'Xcode', { bundle: 'com.apple.dt.Xcode', version: '26.2' }),
      copy('/Applications/Xcode-26.0.0.app', 'Xcode-26.0.0', { bundle: 'com.apple.dt.Xcode', version: '26.0' }),
      copy('/stale/WeChat.app', 'WeChat', { bundle: 'com.tencent.xinWeChat', version: '4.0' }),
      copy('/updates/Quark.app', '夸克', { bundle: 'com.quark.desktop', version: '9.9' }),
      copy('/versions/Doubao.app', '豆包', { bundle: 'com.bot.pc.doubao', version: '2.25.16' }),
      copy('/Applications/WeChat.app', 'WeChat', { default: true, bundle: 'com.tencent.xinWeChat', version: '3.9' }),
      copy('/script-a.app', 'Script', {}),
      copy('/script-b.app', 'Script', { bundle: null, version: null }),
    ])
    const apps = await nativeFileApplications('/file.txt', signal, { platform: 'darwin', run: async () => ({ stdout, stderr: '' }) })
    expect(apps.map(app => app.id)).toEqual([
      // The system default beats the newer staged update copy.
      '/Applications/Quark.app',
      // The newest copy wins and holds the group's first menu position.
      '/versions/Doubao.app',
      // Side-by-side installs carry distinct display names and both stay.
      '/Applications/Xcode.app',
      '/Applications/Xcode-26.0.0.app',
      // A later default replaces a newer stale copy.
      '/Applications/WeChat.app',
      // Entries without a bundle identifier never group.
      '/script-a.app',
      '/script-b.app',
    ])
    expect(apps[4]!.default).toBe(true)
    expect(apps.every(app => !('bundle' in app) && !('version' in app))).toBe(true)
  })

  it('keeps the first copy on version ties and prefers any version over none', async () => {
    const copy = (id: string, bundle: string, version?: string) => ({ id, name: bundle, default: false, icon: null, bundle, version })
    const stdout = JSON.stringify([
      copy('/a/H.app', 'h', '1.0'), copy('/b/H.app', 'h', '1.0.0'),
      copy('/a/N.app', 'n'), copy('/b/N.app', 'n'),
      copy('/a/V.app', 'v', ''), copy('/b/V.app', 'v', '0.1'),
      copy('/a/W.app', 'w', '0.1'), copy('/b/W.app', 'w'),
    ])
    const apps = await nativeFileApplications('/file.txt', signal, { platform: 'darwin', run: async () => ({ stdout, stderr: '' }) })
    expect(apps.map(app => app.id)).toEqual(['/a/H.app', '/a/N.app', '/b/V.app', '/a/W.app'])
  })

  it('rejects a malformed copy even when deduplication would discard it', async () => {
    const stdout = JSON.stringify([
      { ...application, bundle: 'com.apple.Music', version: '2.0' },
      { id: '/updates/Music.app', name: 'Music', icon: null, bundle: 'com.apple.Music', version: '1.0' },
    ])
    await expect(nativeFileApplications('/file.mp3', signal, {
      platform: 'darwin', run: async () => ({ stdout, stderr: '' }),
    })).rejects.toThrow('Invalid native application entry')
  })

  it('launches only a currently registered application with argv', async () => {
    const run = vi.fn(async () => ({ stdout: JSON.stringify([application]), stderr: '' }))
    await openNativeFileApplication('/file.mp3', application.id, signal, { platform: 'darwin', run })
    expect(run).toHaveBeenNthCalledWith(1, 'osascript', ['-l', 'JavaScript', '-e', expect.any(String), '/file.mp3', 'handlers'], signal)
    expect(run).toHaveBeenLastCalledWith('open', ['-a', application.id, '/file.mp3'], signal)
    run.mockClear()
    await expect(openNativeFileApplication('/file.mp3', '/arbitrary.app', signal, { platform: 'darwin', run })).rejects.toThrow('not registered')
    expect(run).toHaveBeenCalledOnce()
  })

  it('launches a registered copy that deduplication collapses out of the display list', async () => {
    const stdout = JSON.stringify([
      { ...application, bundle: 'com.apple.Music', version: '2.0' },
      { ...application, id: '/updates/Music.app', default: false, bundle: 'com.apple.Music', version: '1.0' },
    ])
    const run = vi.fn(async () => ({ stdout, stderr: '' }))
    const shown = await nativeFileApplications('/file.mp3', signal, { platform: 'darwin', run })
    expect(shown.map(app => app.id)).toEqual([application.id])
    await openNativeFileApplication('/file.mp3', '/updates/Music.app', signal, { platform: 'darwin', run })
    expect(run).toHaveBeenLastCalledWith('open', ['-a', '/updates/Music.app', '/file.mp3'], signal)
  })

  it('does not query after cancellation or on unsupported platforms', async () => {
    const run = vi.fn()
    await expect(nativeFileApplications('/file.mp3', signal, { platform: 'freebsd', run })).resolves.toEqual([])
    await expect(nativeFileApplications('/file.mp3', AbortSignal.abort(), { platform: 'darwin', run })).rejects.toThrow()
    expect(run).not.toHaveBeenCalled()
  })
})


it('uses the production command adapter and current platform when no override is supplied', async () => {
  const run = vi.spyOn(runner, 'runNativeCommand').mockImplementation(async command => ({
    stdout: command === 'gio' ? 'standard::content-type: audio/mpeg' : command === 'env' ? 'No applications found' : JSON.stringify([application]), stderr: '',
  }))
  onTestFinished(() => { run.mockRestore() })
  expect(await nativeFileApplications('/file.mp3', signal)).toEqual(process.platform === 'linux' ? [] : [application])
  await openNativeFileApplication('/file.mp3', application.id, signal, { platform: 'darwin' })
  expect(run).toHaveBeenLastCalledWith('open', ['-a', application.id, '/file.mp3'], signal)
})


it('encodes Windows query and invocation data separately from native adapter source', async () => {
  const run = vi.fn<runner.NativeCommandRunner>(async () => ({ stdout: JSON.stringify([application]), stderr: '' }))
  const path = "C:\\测试\\a'; write-host nope.mp3"
  expect(await nativeFileApplications(path, signal, { platform: 'win32', run })).toEqual([application])
  const query = Buffer.from(run.mock.calls[0]![1].at(-1)!, 'base64').toString('utf16le')
  expect(query).toContain(Buffer.from(path).toString('base64'))
  expect(query).not.toContain(path)
  expect(query).toContain('::List($path)')
  await openNativeFileApplication(path, application.id, signal, { platform: 'win32', run })
  expect(Buffer.from(run.mock.calls[1]![1].at(-1)!, 'base64').toString('utf16le')).toContain('::Open($path, $application)')
  expect(run.mock.calls[1]![0]).toBe('powershell.exe')
})

it('uses the Windows desktop for WSL paths and rejects an empty translation', async () => {
  const run = vi.fn<runner.NativeCommandRunner>(async command => ({
    stdout: command === 'wslpath' ? 'C:\\音频.mp3\n' : JSON.stringify([application]), stderr: '',
  }))
  const facts = { platform: 'linux' as const, osRelease: 'microsoft', env: {}, run }
  expect(await nativeFileApplications('/mnt/c/音频.mp3', signal, facts)).toEqual([application])
  await openNativeFileApplication('/mnt/c/音频.mp3', application.id, signal, facts)
  expect(run).toHaveBeenCalledWith('wslpath', ['-w', '/mnt/c/音频.mp3'], signal)
  const empty = async () => ({ stdout: '', stderr: '' })
  await expect(nativeFileApplications('/a', signal, { ...facts, run: empty })).rejects.toThrow('no Windows path')
})


it('uses production environment and runner defaults for Linux and WSL', async () => {
  const run = vi.spyOn(runner, 'runNativeCommand').mockImplementation(async command => ({
    stdout: command === 'gio' ? 'standard::content-type: audio/mpeg'
      : command === 'env' ? 'No applications found'
        : command === 'wslpath' ? 'C:\\file.mp3\n' : JSON.stringify([application]), stderr: '',
  }))
  onTestFinished(() => { run.mockRestore() })
  expect(await nativeFileApplications('/file.mp3', signal, { platform: 'linux', osRelease: 'linux' })).toEqual([])
  expect(await nativeFileApplications('/file.mp3', signal, { platform: 'linux', osRelease: 'microsoft', env: {} })).toEqual([application])
})
