import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// The module reads its value once at import, so each case resets the module
// registry rather than re-rendering.
async function loadSize(): Promise<string> {
  vi.resetModules()
  const { useNoteFontSize } = await import('../src/renderer/src/lib/fontSize')
  return renderHook(() => useNoteFontSize()).result.current
}

describe('note font size across the rename', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('reads a size stored under the name the app had before', async () => {
    window.localStorage.setItem('bookhook.noteFontSize', 'large')

    expect(await loadSize()).toBe('large')
  })

  it('prefers the current key when both are stored', async () => {
    window.localStorage.setItem('bookhook.noteFontSize', 'large')
    window.localStorage.setItem('interleaf.noteFontSize', 'small')

    expect(await loadSize()).toBe('small')
  })

  it('falls back to the default when neither is stored', async () => {
    expect(await loadSize()).toBe('medium')
  })
})
