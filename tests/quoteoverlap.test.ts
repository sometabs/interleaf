// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'

import { overlapOf, unionOf } from '../src/renderer/src/lib/quoteOverlap'

let text: Text
let other: Text

beforeEach(() => {
  document.body.innerHTML = '<p>The quick brown fox jumps over the lazy dog.</p><p>Second line.</p>'
  text = document.querySelector('p')!.firstChild as Text
  other = document.querySelectorAll('p')[1].firstChild as Text
})

function span(start: number, end: number, endNode: Text = text): Range {
  const range = document.createRange()
  range.setStart(text, start)
  range.setEnd(endNode, end)
  return range
}

// "quick brown fox" sits at 4..19 in the first paragraph.
const quote = (): Range => span(4, 19)

describe('a selection against an existing quote', () => {
  it('is inside when it lies within the quote, edges included', () => {
    expect(overlapOf(span(10, 15), quote())).toBe('inside')
    expect(overlapOf(span(4, 19), quote())).toBe('inside')
  })

  it('overlaps when it runs past either end', () => {
    expect(overlapOf(span(0, 10), quote())).toBe('overlap')
    expect(overlapOf(span(10, 30), quote())).toBe('overlap')
    expect(overlapOf(span(0, 44), quote())).toBe('overlap')
    expect(overlapOf(span(10, 5, other), quote())).toBe('overlap')
  })

  it('is apart when it only touches or misses the quote', () => {
    expect(overlapOf(span(0, 4), quote())).toBe('apart')
    expect(overlapOf(span(19, 25), quote())).toBe('apart')
    expect(overlapOf(span(30, 40), quote())).toBe('apart')
  })
})

describe('the extended quote', () => {
  it('covers the selection and every quote it touched', () => {
    expect(unionOf([span(10, 30), quote()]).toString()).toBe('quick brown fox jumps over')
    expect(unionOf([span(16, 22), quote(), span(20, 30)]).toString()).toBe(
      'quick brown fox jumps over'
    )
  })
})
