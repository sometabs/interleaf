// The preload exposes the whole IPC surface to whatever the window loads, so
// navigating elsewhere hands `window.interleaf` to that page.

const EXTERNAL_SCHEMES = new Set(['http:', 'https:'])

// Compared by path because `new URL('file:///x').origin` is the string "null",
// which makes every local file same-origin.
export function isAppUrl(target: string, appUrl: string): boolean {
  let url: URL
  let base: URL
  try {
    url = new URL(target)
    base = new URL(appUrl)
  } catch {
    return false
  }

  if (base.protocol === 'file:') {
    // Hash and query address a position within the document, not another one.
    return (
      url.protocol === 'file:' &&
      decodeURIComponent(url.pathname) === decodeURIComponent(base.pathname)
    )
  }

  return url.origin === base.origin
}

// `shell.openExternal` launches whatever is registered for a scheme, so only
// web links qualify.
export function isExternalLink(target: string): boolean {
  try {
    return EXTERNAL_SCHEMES.has(new URL(target).protocol)
  } catch {
    return false
  }
}
