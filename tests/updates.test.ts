import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'

import {
  installReadyUpdate,
  readyUpdate,
  releaseNoteLines,
  watchForUpdates,
  type Updater
} from '../src/main/services/updates'

type FakeUpdater = EventEmitter &
  Updater & {
    checkForUpdates: ReturnType<typeof vi.fn>
    quitAndInstall: ReturnType<typeof vi.fn>
  }

function fakeUpdater(check: () => Promise<unknown> = () => Promise.resolve(null)): FakeUpdater {
  return Object.assign(new EventEmitter(), {
    checkForUpdates: vi.fn(check),
    quitAndInstall: vi.fn()
  }) as FakeUpdater
}

describe('watching for updates', () => {
  it('checks once when started', () => {
    const updater = fakeUpdater()
    watchForUpdates(updater, vi.fn())
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1)
  })

  it('announces a downloaded update and remembers it for a window that asks later', () => {
    const updater = fakeUpdater()
    const announce = vi.fn()
    watchForUpdates(updater, announce)
    expect(readyUpdate()).toBeNull()

    updater.emit('update-downloaded', { version: '1.21.0' })

    expect(announce).toHaveBeenCalledWith({ version: '1.21.0', notes: [] })
    expect(readyUpdate()).toEqual({ version: '1.21.0', notes: [] })
  })

  it('restarts into the update silently and reopens the app', () => {
    const updater = fakeUpdater()
    watchForUpdates(updater, vi.fn())
    updater.emit('update-downloaded', { version: '1.21.0' })

    installReadyUpdate()

    expect(updater.quitAndInstall).toHaveBeenCalledWith(true, true)
  })

  it('ignores a restart request when nothing has downloaded', () => {
    const updater = fakeUpdater()
    watchForUpdates(updater, vi.fn())

    installReadyUpdate()

    expect(updater.quitAndInstall).not.toHaveBeenCalled()
  })

  // An unhandled 'error' event or rejection would crash the main process offline.
  it('stays quiet when the check fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const updater = fakeUpdater(() => Promise.reject(new Error('net::ERR_INTERNET_DISCONNECTED')))
    const announce = vi.fn()
    watchForUpdates(updater, announce)

    expect(() => updater.emit('error', new Error('net::ERR_INTERNET_DISCONNECTED'))).not.toThrow()
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(announce).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it('carries the release notes with the update', () => {
    const updater = fakeUpdater()
    const announce = vi.fn()
    watchForUpdates(updater, announce)

    updater.emit('update-downloaded', {
      version: '1.22.0',
      releaseNotes: '<ul><li>Rate books in half stars</li></ul>'
    })

    expect(readyUpdate()?.notes).toEqual([{ heading: false, text: 'Rate books in half stars' }])
  })

  it('takes the notes of the downloaded version from a full changelog', () => {
    const updater = fakeUpdater()
    watchForUpdates(updater, vi.fn())

    updater.emit('update-downloaded', {
      version: '1.23.0',
      releaseNotes: [
        { version: '1.22.0', note: '<p>Older</p>' },
        { version: '1.23.0', note: '<p>Newer</p>' }
      ]
    })

    expect(readyUpdate()?.notes).toEqual([{ heading: false, text: 'Newer' }])
  })
})

describe('release note lines', () => {
  it('keeps headings and list items in order', () => {
    const html = `<h3>New</h3>
<ul>
<li>Rate books in <strong>half</strong> stars</li>
</ul>
<h3>Fixed</h3>
<ul>
<li><p>Typing is saved on close</p></li>
</ul>`

    expect(releaseNoteLines(html)).toEqual([
      { heading: true, text: 'New' },
      { heading: false, text: 'Rate books in half stars' },
      { heading: true, text: 'Fixed' },
      { heading: false, text: 'Typing is saved on close' }
    ])
  })

  it('turns markup in the notes into inert text', () => {
    const html = '<li>Use &lt;script&gt; &amp; &#39;quotes&#39;<img src=x onerror=alert(1)></li>'

    expect(releaseNoteLines(html)).toEqual([{ heading: false, text: "Use <script> & 'quotes'" }])
  })

  it('reads plain text notes line by line', () => {
    expect(releaseNoteLines('- Rate books in half stars\n- Bigger stars')).toEqual([
      { heading: false, text: 'Rate books in half stars' },
      { heading: false, text: 'Bigger stars' }
    ])
  })

  it('gives nothing for empty notes', () => {
    expect(releaseNoteLines('')).toEqual([])
  })
})
