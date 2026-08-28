import { describe, expect, it } from 'vitest'

import { isAppUrl, isExternalLink } from '../src/main/navigation'

// The preload is injected into whatever the window loads and exposes the whole
// IPC surface, so this is a privilege question rather than a routing one.

const PACKAGED = 'file:///C:/Program%20Files/Interleaf/resources/app.asar/out/renderer/index.html'
const DEV = 'http://localhost:5173/'

describe('what the window may navigate to', () => {
  it('allows the packaged renderer to reach itself', () => {
    expect(isAppUrl(PACKAGED, PACKAGED)).toBe(true)
  })

  it('ignores a hash or a query, which address a place inside the document', () => {
    expect(isAppUrl(`${PACKAGED}#/book/3`, PACKAGED)).toBe(true)
    expect(isAppUrl(`${PACKAGED}?x=1`, PACKAGED)).toBe(true)
  })

  // `new URL('file:///x').origin` is the string "null", so an origin comparison
  // calls every local file same-origin -- and the packaged renderer is one.
  it('refuses another local file, whose origin is also "null"', () => {
    expect(isAppUrl('file:///C:/Users/someone/evil.html', PACKAGED)).toBe(false)
    expect(isAppUrl('file:///etc/passwd', PACKAGED)).toBe(false)
  })

  it('refuses a remote page', () => {
    expect(isAppUrl('https://evil.example/', PACKAGED)).toBe(false)
    expect(isAppUrl('http://localhost:5173/', PACKAGED)).toBe(false)
  })

  it('allows the dev server to navigate within itself', () => {
    expect(isAppUrl('http://localhost:5173/index.html', DEV)).toBe(true)
  })

  it('refuses a different port, which is a different server', () => {
    expect(isAppUrl('http://localhost:9999/', DEV)).toBe(false)
    expect(isAppUrl('https://localhost:5173/', DEV)).toBe(false)
  })

  it('refuses anything that is not a URL at all', () => {
    expect(isAppUrl('', PACKAGED)).toBe(false)
    expect(isAppUrl('javascript:alert(1)', PACKAGED)).toBe(false)
    expect(isAppUrl('not a url', PACKAGED)).toBe(false)
  })
})

// `shell.openExternal` starts whatever the OS registered for a scheme, so an
// unchecked call launches a local program from a network-supplied string.
describe('what may be handed to the operating system', () => {
  it('allows web links', () => {
    expect(isExternalLink('https://openlibrary.org/works/OL27448W')).toBe(true)
    expect(isExternalLink('http://example.com')).toBe(true)
  })

  it('refuses everything else', () => {
    for (const url of [
      'file:///C:/Windows/System32/calc.exe',
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'ms-msdt:/id',
      'smb://attacker/share',
      'vbscript:msgbox(1)',
      '',
      'nonsense'
    ]) {
      expect(isExternalLink(url), url).toBe(false)
    }
  })
})
