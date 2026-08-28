import { describe, expect, it } from 'vitest'

import { MAX_SHOWN, MIN_SHOWN, shownFor } from '../src/renderer/src/lib/shown'

describe('how many suggestions a library supports', () => {
  it('grows with the shelf', () => {
    expect(shownFor(20)).toBeGreaterThan(shownFor(10))
    expect(shownFor(10)).toBeGreaterThan(shownFor(7))
  })

  it('never drops below a page, however small the library', () => {
    expect(shownFor(0)).toBe(MIN_SHOWN)
    expect(shownFor(1)).toBe(MIN_SHOWN)
    expect(shownFor(5)).toBe(MIN_SHOWN)
  })

  // Past here the scores are flat and the ordering stops meaning anything.
  it('stops growing at the ceiling', () => {
    expect(shownFor(30)).toBe(MAX_SHOWN)
    expect(shownFor(400)).toBe(MAX_SHOWN)
  })

  it('is always a whole number of cards', () => {
    for (const size of [0, 3, 7, 13, 29, 31, 500]) {
      expect(Number.isInteger(shownFor(size))).toBe(true)
    }
  })
})
