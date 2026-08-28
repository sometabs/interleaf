import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach, vi } from 'vitest'

import { resetMessages } from '../src/renderer/src/lib/feedback'

// jsdom implements Range but not its layout methods, and nothing has a size.
if (!Range.prototype.getClientRects) {
  Range.prototype.getClientRects = () => Object.assign([], { item: () => null }) as DOMRectList
  Range.prototype.getBoundingClientRect = () => new DOMRect()
}

// Tracked rather than no-op'd, so a test can tell whether a component
// captured the pointer.
if (!Element.prototype.setPointerCapture) {
  const captured = new WeakMap<Element, Set<number>>()
  Element.prototype.setPointerCapture = function (id: number) {
    const ids = captured.get(this) ?? new Set<number>()
    ids.add(id)
    captured.set(this, ids)
  }
  Element.prototype.releasePointerCapture = function (id: number) {
    captured.get(this)?.delete(id)
  }
  Element.prototype.hasPointerCapture = function (id: number) {
    return captured.get(this)?.has(id) ?? false
  }
}

// jsdom has no ResizeObserver, and nothing in it resizes.
if (!('ResizeObserver' in globalThis)) {
  globalThis.ResizeObserver = class {
    observe(): void {
      // Never fires: nothing in jsdom resizes.
    }
    unobserve(): void {
      // See `observe`.
    }
    disconnect(): void {
      // See `observe`.
    }
  } as unknown as typeof ResizeObserver
}

// cmdk scrolls the highlighted item into view on every render.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function (): void {
    // No viewport in jsdom, so there is nothing to scroll.
  }
}

beforeEach(() => {
  // Tests that need a refusal override this.
  vi.stubGlobal('confirm', () => true)
  window.localStorage.clear()
})

afterEach(() => {
  cleanup()
  resetMessages()
  vi.unstubAllGlobals()
})
