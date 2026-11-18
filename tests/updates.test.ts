import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'

import {
  installReadyUpdate,
  readyUpdate,
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

    expect(announce).toHaveBeenCalledWith('1.21.0')
    expect(readyUpdate()).toBe('1.21.0')
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
})
