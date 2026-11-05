import type { IpcMainInvokeEvent, Session, WebContents } from 'electron'
import { describe, expect, it, vi } from 'vitest'

import { assertTrustedIpcSender, restrictPermissions, trustRenderer } from '../src/main/security'

const APP_URL = 'file:///C:/Interleaf/out/renderer/index.html'

function renderer(url = APP_URL): WebContents {
  return {
    mainFrame: { url },
    isDestroyed: vi.fn(() => false)
  } as unknown as WebContents
}

function caller(contents: WebContents): IpcMainInvokeEvent {
  return { sender: contents, senderFrame: contents.mainFrame } as IpcMainInvokeEvent
}

describe('IPC caller validation', () => {
  it.each([APP_URL, 'http://localhost:5173/'])('accepts the enrolled main frame at %s', (url) => {
    const contents = renderer(url)
    trustRenderer(contents, url)
    expect(() => assertTrustedIpcSender(caller(contents))).not.toThrow()
  })

  it('accepts an app hash or query without granting another document access', () => {
    const contents = renderer(`${APP_URL}?view=library#book/1`)
    trustRenderer(contents, APP_URL)
    expect(() => assertTrustedIpcSender(caller(contents))).not.toThrow()
  })

  it('refuses an unenrolled window even when it loads the same app URL', () => {
    const contents = renderer()
    expect(() => assertTrustedIpcSender(caller(contents))).toThrow(/Interleaf window/)
  })

  it('refuses a subframe even when its URL matches the app', () => {
    const contents = renderer()
    trustRenderer(contents, APP_URL)
    const event = { ...caller(contents), senderFrame: { url: APP_URL } } as IpcMainInvokeEvent
    expect(() => assertTrustedIpcSender(event)).toThrow(/Interleaf window/)
  })

  it.each(['https://example.com/', 'file:///C:/private.html', 'file:///C:/bad%ZZ'])(
    'refuses an enrolled window after navigating to %s',
    (url) => {
      const contents = renderer(url)
      trustRenderer(contents, APP_URL)
      expect(() => assertTrustedIpcSender(caller(contents))).toThrow(/Interleaf window/)
    }
  )

  it('refuses a missing frame', () => {
    const contents = renderer()
    trustRenderer(contents, APP_URL)
    expect(() =>
      assertTrustedIpcSender({ sender: contents, senderFrame: null } as IpcMainInvokeEvent)
    ).toThrow(/Interleaf window/)
  })

  it('refuses a destroyed renderer', () => {
    const contents = renderer()
    trustRenderer(contents, APP_URL)
    vi.mocked(contents.isDestroyed).mockReturnValue(true)
    expect(() => assertTrustedIpcSender(caller(contents))).toThrow(/Interleaf window/)
  })
})

function permissions(): {
  check: NonNullable<Parameters<Session['setPermissionCheckHandler']>[0]>
  request: NonNullable<Parameters<Session['setPermissionRequestHandler']>[0]>
  device: NonNullable<Parameters<Session['setDevicePermissionHandler']>[0]>
} {
  const setPermissionCheckHandler = vi.fn<Session['setPermissionCheckHandler']>()
  const setPermissionRequestHandler = vi.fn<Session['setPermissionRequestHandler']>()
  const setDevicePermissionHandler = vi.fn<Session['setDevicePermissionHandler']>()
  restrictPermissions({
    setPermissionCheckHandler,
    setPermissionRequestHandler,
    setDevicePermissionHandler
  } as unknown as Session)
  return {
    check: setPermissionCheckHandler.mock.calls[0][0]!,
    request: setPermissionRequestHandler.mock.calls[0][0]!,
    device: setDevicePermissionHandler.mock.calls[0][0]!
  }
}

describe('unused permissions', () => {
  it('denies sensitive checks and requests, including clipboard reads', () => {
    const contents = renderer()
    trustRenderer(contents, APP_URL)
    const { check, request } = permissions()
    const details = { isMainFrame: true, requestingUrl: APP_URL }
    for (const permission of ['media', 'geolocation', 'notifications', 'clipboard-read'] as const) {
      expect(check(contents, permission, 'file://', details)).toBe(false)
      const callback = vi.fn()
      request(contents, permission, callback, details)
      expect(callback).toHaveBeenCalledExactlyOnceWith(false)
    }
  })

  it('keeps copying diagnostics available to the app main frame', () => {
    const contents = renderer()
    trustRenderer(contents, APP_URL)
    const { check, request } = permissions()
    const details = { isMainFrame: true, requestingUrl: APP_URL }
    expect(check(contents, 'clipboard-sanitized-write', 'file://', details)).toBe(true)
    const callback = vi.fn()
    request(contents, 'clipboard-sanitized-write', callback, details)
    expect(callback).toHaveBeenCalledExactlyOnceWith(true)
  })

  it('refuses clipboard writes from other windows, frames or documents', () => {
    const trusted = renderer()
    trustRenderer(trusted, APP_URL)
    const { check, request } = permissions()
    for (const [contents, details] of [
      [renderer(), { isMainFrame: true, requestingUrl: APP_URL }],
      [trusted, { isMainFrame: false, requestingUrl: APP_URL }],
      [trusted, { isMainFrame: true, requestingUrl: 'https://example.com/' }]
    ] as const) {
      expect(check(contents, 'clipboard-sanitized-write', 'file://', details)).toBe(false)
      const callback = vi.fn()
      request(contents, 'clipboard-sanitized-write', callback, details)
      expect(callback).toHaveBeenCalledExactlyOnceWith(false)
    }
    expect(check(null, 'clipboard-sanitized-write', '', { isMainFrame: false })).toBe(false)
    expect(check(trusted, 'clipboard-sanitized-write', '', { isMainFrame: true })).toBe(false)
  })

  it('denies device permission grants', () => {
    expect(
      permissions().device({} as Parameters<ReturnType<typeof permissions>['device']>[0])
    ).toBe(false)
  })
})
