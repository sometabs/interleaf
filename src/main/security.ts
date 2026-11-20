import type { IpcMainInvokeEvent, Session, WebContents } from 'electron'

import { isAppUrl } from './navigation'

// Only windows created by the app are enrolled, before their page is loaded.
const trustedRenderers = new WeakMap<WebContents, string>()

export function trustRenderer(contents: WebContents, appUrl: string): void {
  trustedRenderers.set(contents, appUrl)
}

function isTrustedRenderer(contents: WebContents | null, url: string | undefined): boolean {
  if (!contents || contents.isDestroyed() || !url) return false
  const expected = trustedRenderers.get(contents)
  if (!expected) return false
  try {
    return isAppUrl(contents.mainFrame.url, expected) && isAppUrl(url, expected)
  } catch {
    return false
  }
}

export function assertTrustedIpcSender(event: IpcMainInvokeEvent): void {
  const frame = event.senderFrame
  if (!frame || !isTrustedRenderer(event.sender, frame.url) || frame !== event.sender.mainFrame) {
    throw new Error('This request did not come from the Interleaf window.')
  }
}

// Copy diagnostics uses writeText() and the reader can go full screen. Reading the clipboard,
// media access, location, notifications and all other browser capabilities are not needed.
const ALLOWED_PERMISSIONS = new Set(['clipboard-sanitized-write', 'fullscreen'])

export function restrictPermissions(session: Session): void {
  session.setPermissionCheckHandler((contents, permission, _origin, details) => {
    return (
      ALLOWED_PERMISSIONS.has(permission) &&
      details.isMainFrame &&
      isTrustedRenderer(contents, details.requestingUrl)
    )
  })
  session.setPermissionRequestHandler((contents, permission, callback, details) => {
    callback(
      ALLOWED_PERMISSIONS.has(permission) &&
        details.isMainFrame &&
        isTrustedRenderer(contents, details.requestingUrl)
    )
  })
  session.setDevicePermissionHandler(() => false)
}
