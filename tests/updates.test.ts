import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'

import { watchForUpdates, type Updater } from '../src/main/services/updates'

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

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

describe('watching for updates', () => {
  it('checks once when started', () => {
    const updater = fakeUpdater()
    watchForUpdates(updater, vi.fn())
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1)
  })

  it('restarts into a downloaded update when the reader agrees', async () => {
    const updater = fakeUpdater()
    const ask = vi.fn().mockResolvedValue(true)
    watchForUpdates(updater, ask)

    updater.emit('update-downloaded', { version: '1.21.0' })
    await flush()

    expect(ask).toHaveBeenCalledWith('1.21.0')
    expect(updater.quitAndInstall).toHaveBeenCalledWith(true, true)
  })

  it('leaves the update for the next quit when the reader says later', async () => {
    const updater = fakeUpdater()
    watchForUpdates(updater, vi.fn().mockResolvedValue(false))

    updater.emit('update-downloaded', { version: '1.21.0' })
    await flush()

    expect(updater.quitAndInstall).not.toHaveBeenCalled()
  })

  // An unhandled 'error' event or rejection would crash the main process offline.
  it('stays quiet when the check fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const updater = fakeUpdater(() => Promise.reject(new Error('net::ERR_INTERNET_DISCONNECTED')))
    const ask = vi.fn()
    watchForUpdates(updater, ask)

    expect(() => updater.emit('error', new Error('net::ERR_INTERNET_DISCONNECTED'))).not.toThrow()
    await flush()

    expect(ask).not.toHaveBeenCalled()
    warn.mockRestore()
  })
})
