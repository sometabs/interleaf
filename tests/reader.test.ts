// @vitest-environment jsdom
import type { EpubCandidate } from '@shared/api'
import { describe, expect, it } from 'vitest'

import { inertPage } from '../src/renderer/src/lib/epubContent'
import { isNoteReference, isNoteTarget, noteText } from '../src/renderer/src/lib/footnotes'
import { matchLibrary, normalTitle } from '../src/renderer/src/lib/epubMatch'
import {
  bookCss,
  DEFAULT_LOOK,
  layoutOf,
  LIMITS,
  narrower,
  pageLabel,
  parseLook,
  shownTheme,
  step,
  widthRoom,
  withLayout
} from '../src/renderer/src/lib/readerLook'
import { makeBook } from './helpers/render'

const XHTML = 'application/xhtml+xml'

function candidate(overrides: Partial<EpubCandidate> = {}): EpubCandidate {
  return {
    path: 'C:/books/orchard.epub',
    fileName: 'orchard.epub',
    title: 'The Glass Orchard',
    author: 'Mira Halden',
    isbn: null,
    bookId: null,
    ...overrides
  }
}

describe('making book pages inert', () => {
  const page = (body: string): string =>
    `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>x</title></head><body>${body}</body></html>`

  it('removes scripts, frames, forms and event handlers but keeps the text', () => {
    const out = inertPage(
      page(
        '<p onclick="steal()">Kept text</p><script>steal()</script><iframe src="https://example.com"/><form action="x"><input/></form><img src="a.png" onerror="steal()"/>'
      ),
      XHTML
    )

    expect(out).toContain('Kept text')
    expect(out).toContain('a.png')
    expect(out).not.toMatch(/script|iframe|<form|onclick|onerror|steal/)
  })

  it('removes script links but keeps ordinary ones', () => {
    const out = inertPage(
      page('<a href="javascript:steal()">bad</a><a href="chapter2.xhtml#n1">good</a>'),
      XHTML
    )

    expect(out).not.toContain('javascript:')
    expect(out).toContain('chapter2.xhtml#n1')
  })

  it('handles plain HTML pages too', () => {
    const out = inertPage(
      '<html><body><p>Text</p><script>steal()</script></body></html>',
      'text/html'
    )

    expect(out).toContain('<p>Text</p>')
    expect(out).not.toContain('steal')
  })
})

describe('finding the book an EPUB belongs to', () => {
  const library = [
    makeBook({ id: 1, title: 'The Glass Orchard', author: 'Mira Halden' }),
    makeBook({ id: 2, title: 'Glass Houses', author: 'Teo Marsh' }),
    makeBook({ id: 3, title: 'Salt and Cinder', author: 'Ines Varga', isbn: '978-0-00-000000-2' })
  ]

  it('ignores case, articles, punctuation and subtitles', () => {
    expect(normalTitle('The Glass Orchard: A Novel')).toBe('glass orchard')
    expect(normalTitle('Glass Orchard (Deluxe Edition)')).toBe('glass orchard')
  })

  it('offers the one clear match first', () => {
    const matches = matchLibrary(candidate({ title: 'Glass Orchard (Deluxe Edition)' }), library)

    expect(matches.clear?.id).toBe(1)
    expect(matches.close.map((book) => book.id)).toEqual([1])
  })

  it('matches on ISBN when titles differ', () => {
    const matches = matchLibrary(
      candidate({ title: 'Sel et cendre', author: null, isbn: '9780000000002' }),
      library
    )

    expect(matches.clear?.id).toBe(3)
  })

  it('offers no single match when several books fit equally', () => {
    const twins = [
      ...library,
      makeBook({ id: 4, title: 'The Glass Orchard', author: 'Mira Halden' })
    ]

    expect(matchLibrary(candidate(), twins).clear).toBeNull()
  })

  it('finds nothing for an unrelated file', () => {
    expect(matchLibrary(candidate({ title: 'Untitled', author: 'Unknown' }), library)).toEqual({
      clear: null,
      close: []
    })
  })
})

describe('reader look', () => {
  it('falls back to defaults for unknown or out-of-range values', () => {
    expect(parseLook({ theme: 'neon', size: 9000, flow: 'sideways' })).toEqual({
      ...DEFAULT_LOOK,
      size: LIMITS.size.max
    })
    expect(parseLook('nonsense')).toBeNull()
  })

  it('steps within the limits', () => {
    const smallest = { ...DEFAULT_LOOK, size: LIMITS.size.min }

    expect(step(smallest, 'size', -1).size).toBe(LIMITS.size.min)
    expect(step(DEFAULT_LOOK, 'spacing', 1).spacing).toBe(1.6)
  })

  it('knows when a wider text width stops changing the page', () => {
    const wide = { width: 1700, height: 900 }

    expect(widthRoom(DEFAULT_LOOK, wide)).toBeCloseTo(799)
    expect(widthRoom({ ...DEFAULT_LOOK, pages: 1 }, wide)).toBeCloseTo(1598)
    expect(widthRoom(DEFAULT_LOOK, { width: 900, height: 1200 })).toBeCloseTo(846)
    expect(widthRoom({ ...DEFAULT_LOOK, flow: 'scrolled' }, wide)).toBeCloseTo(1496)
    expect(widthRoom(DEFAULT_LOOK, { width: 0, height: 0 })).toBe(Infinity)
  })

  it('narrows a width the window had capped on the first press', () => {
    expect(narrower({ ...DEFAULT_LOOK, width: 1040 }, 799).width).toBe(740)
    expect(narrower({ ...DEFAULT_LOOK, width: 680 }, 799).width).toBe(620)
    expect(narrower({ ...DEFAULT_LOOK, width: 680 }, Infinity).width).toBe(620)
    expect(narrower({ ...DEFAULT_LOOK, width: 440 }, 300).width).toBe(440)
  })

  it('keeps the book’s own colours and fonts in the light theme', () => {
    const css = bookCss(DEFAULT_LOOK, 'light')

    expect(css).not.toContain('font-family')
    expect(css).not.toContain('color: #')
    expect(css).not.toContain('text-align')
  })

  it('aligns paragraphs only when asked and keeps margins in range', () => {
    expect(bookCss({ ...DEFAULT_LOOK, align: 'justify' }, 'light')).toContain(
      'text-align: justify !important'
    )
    expect(bookCss({ ...DEFAULT_LOOK, align: 'left' }, 'light')).toContain(
      'text-align: left !important'
    )
    expect(parseLook({ align: 'centre', margin: 'huge' })).toMatchObject({
      align: 'book',
      margin: 40
    })
    expect(parseLook({ align: 'justify', margin: 0 })).toMatchObject({
      align: 'justify',
      margin: 0
    })
    expect(parseLook({ margin: 500 })?.margin).toBe(120)
  })

  it('recolours text in the dark theme and sets the chosen font', () => {
    const css = bookCss({ ...DEFAULT_LOOK, theme: 'dark', font: 'serif' }, 'dark')

    expect(css).toContain('color-scheme: dark')
    expect(css).toMatch(/font-family: [^;]*serif/)
  })

  it('offers two pages, one page or scrolling', () => {
    expect(layoutOf(DEFAULT_LOOK)).toBe('two')
    expect(withLayout(DEFAULT_LOOK, 'one')).toMatchObject({ flow: 'paginated', pages: 1 })
    expect(layoutOf(withLayout(DEFAULT_LOOK, 'scroll'))).toBe('scroll')
    // Scrolling keeps the page count, so going back to pages restores it.
    expect(layoutOf(withLayout(withLayout(DEFAULT_LOOK, 'one'), 'scroll'))).toBe('scroll')
  })

  it('reads looks saved before the one-page option as two pages', () => {
    expect(parseLook({ flow: 'paginated' })?.pages).toBe(2)
    expect(parseLook({ flow: 'paginated', pages: 1 })?.pages).toBe(1)
  })

  it('keeps a theme chosen before Auto existed', () => {
    expect(parseLook({ theme: 'sepia' })?.theme).toBe('sepia')
    expect(parseLook({ theme: 'auto' })?.theme).toBe('auto')
    expect(parseLook({})?.pageCount).toBe('left')
  })

  it('follows the app between light and dark on Auto, and never picks sepia', () => {
    expect(shownTheme('auto', false)).toBe('light')
    expect(shownTheme('auto', true)).toBe('dark')
    expect(shownTheme('sepia', true)).toBe('sepia')
    expect(shownTheme('light', true)).toBe('light')
  })
})

describe('clicking page edges', () => {
  it('is on unless switched off, also for settings saved before it existed', () => {
    expect(DEFAULT_LOOK.edgeTurn).toBe(true)
    expect(parseLook({})?.edgeTurn).toBe(true)
    expect(parseLook({ ...DEFAULT_LOOK, edgeTurn: false })?.edgeTurn).toBe(false)
  })
})

describe('page label', () => {
  // Ten screens include a blank one at each end, so eight hold text.
  it('counts the pages left in the chapter, two per screen side by side', () => {
    expect(pageLabel(5, 10, 1, false)).toBe('3 pages left')
    expect(pageLabel(5, 10, 2, false)).toBe('6 pages left')
    expect(pageLabel(7, 10, 1, false)).toBe('1 page left')
    expect(pageLabel(8, 10, 2, false)).toBe('Last page')
  })

  it('can show where you are in the chapter instead', () => {
    expect(pageLabel(5, 10, 1, false, 'position')).toBe('5 / 8')
    expect(pageLabel(1, 10, 2, false, 'position')).toBe('1 / 16')
    expect(pageLabel(8, 10, 2, false, 'position')).toBe('15 / 16')
  })

  it('shows nothing while scrolling or before the chapter is laid out', () => {
    expect(pageLabel(3, 10, 1, true)).toBe('')
    expect(pageLabel(0, 0, 1, false)).toBe('')
  })
})

describe('footnotes', () => {
  const page = (body: string): Document =>
    new DOMParser().parseFromString(
      `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body>${body}</body></html>`,
      'application/xhtml+xml'
    )

  it('recognises a reference the book marks as a note', () => {
    const doc = page('<p>Text<a epub:type="noteref" href="n.xhtml#n1">1</a></p>')
    expect(isNoteReference(doc.querySelector('a')!)).toBe(true)
  })

  it('recognises a raised number, the way print shows a note', () => {
    const doc = page('<p>Text<sup><a href="n.xhtml#n1">1</a></sup></p>')
    expect(isNoteReference(doc.querySelector('a')!)).toBe(true)
  })

  it('recognises a bare marker such as [1] or † as a note, but not words', () => {
    const doc = page(
      '<p><a id="bracket" href="n.xhtml#n1">[1]</a><a id="dagger" href="n.xhtml#n2">†</a><a id="words" href="c2.xhtml">see chapter 2</a></p>'
    )
    expect(isNoteReference(doc.getElementById('bracket')!)).toBe(true)
    expect(isNoteReference(doc.getElementById('dagger')!)).toBe(true)
    expect(isNoteReference(doc.getElementById('words')!)).toBe(false)
  })

  it('recognises a link pointing at something the book marks as a note', () => {
    const doc = page(
      '<aside id="fn1"><p>A note.</p></aside><ol><li id="en1" role="doc-endnote"><p id="inner">An endnote.</p></li></ol><p id="plain">A paragraph.</p>'
    )
    expect(isNoteTarget(doc.getElementById('fn1'))).toBe(true)
    expect(isNoteTarget(doc.getElementById('inner'))).toBe(true)
    expect(isNoteTarget(doc.getElementById('plain'))).toBe(false)
    expect(isNoteTarget(null)).toBe(false)
  })

  it('treats an ordinary link as a jump, and a link back from a note as no note', () => {
    const doc = page(
      '<p><a id="plain" href="c2.xhtml">Chapter two</a><sup><a id="back" epub:type="backlink" href="c1.xhtml#r1">↩</a></sup></p>'
    )
    expect(isNoteReference(doc.getElementById('plain')!)).toBe(false)
    expect(isNoteReference(doc.getElementById('back')!)).toBe(false)
  })

  it('reads the whole note as plain text, without its link back', () => {
    const doc = page(
      '<aside id="n1" epub:type="footnote"><p><a epub:type="backlink" href="c1.xhtml#r1">1.</a> The keeper counted <em>every</em> tree.</p></aside>'
    )
    expect(noteText(doc.querySelector('em'))).toBe('The keeper counted every tree.')
  })

  it('cuts a very long note short', () => {
    const doc = page(`<p id="n1">${'word '.repeat(600)}</p>`)
    const text = noteText(doc.getElementById('n1'))
    expect(text.length).toBeLessThanOrEqual(1501)
    expect(text.endsWith('…')).toBe(true)
  })
})
