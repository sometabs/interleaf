import type { Database } from 'better-sqlite3'
import { beforeEach, describe, expect, it } from 'vitest'

import { HL_END, HL_START } from '../src/shared/api'
import { createDatabase } from '../src/main/db/database'
import * as books from '../src/main/repos/books'
import * as notes from '../src/main/repos/notes'
import { search, toFtsQuery } from '../src/main/repos/search'

let db: Database

beforeEach(() => {
  db = createDatabase(':memory:')
})

describe('toFtsQuery', () => {
  it('quotes each term and adds a prefix wildcard', () => {
    expect(toFtsQuery('anarch uto')).toBe('"anarch"* "uto"*')
  })

  it('returns null for blank input', () => {
    expect(toFtsQuery('   ')).toBeNull()
  })

  it('strips characters that are FTS5 query syntax', () => {
    expect(toFtsQuery('"quoted" (paren) star*')).toBe('"quoted"* "paren"* "star"*')
  })

  it('neutralizes operators that would otherwise be parsed as syntax', () => {
    expect(toFtsQuery('AND OR NOT NEAR')).toBe('"AND"* "OR"* "NOT"* "NEAR"*')
  })
})

describe('search', () => {
  beforeEach(() => {
    const book = books.createBook(db, { title: 'The Dispossessed', author: 'Ursula K. Le Guin' })
    notes.createNote(db, {
      bookId: book.id,
      kind: 'review',
      title: 'On Utopias',
      bodyMd: 'A thought about anarchism and ambiguous utopia.'
    })
    books.createBook(db, { title: 'Dune', author: 'Frank Herbert' })
  })

  it('returns nothing for an empty query', () => {
    expect(search(db, '')).toEqual([])
  })

  it('finds a note by body text', () => {
    const hits = search(db, 'anarchism')
    expect(hits.some((h) => h.kind === 'note' && h.title === 'On Utopias')).toBe(true)
  })

  it('finds a book by title', () => {
    const hits = search(db, 'Dune')
    expect(hits.some((h) => h.kind === 'book' && h.title === 'Dune')).toBe(true)
  })

  it('finds a book by author', () => {
    expect(search(db, 'Herbert').some((h) => h.kind === 'book')).toBe(true)
  })

  it('matches on a prefix so results appear while typing', () => {
    expect(search(db, 'anarch').length).toBeGreaterThan(0)
  })

  it('wraps matches in the highlight markers', () => {
    const hit = search(db, 'anarchism').find((h) => h.kind === 'note')
    expect(hit?.snippet).toContain(HL_START)
    expect(hit?.snippet).toContain(HL_END)
  })

  it('uses control characters, not HTML, for highlighting', () => {
    const hit = search(db, 'anarchism').find((h) => h.kind === 'note')
    expect(hit?.snippet).not.toContain('<mark>')
  })

  it('does not throw on input full of query syntax', () => {
    expect(() => search(db, '"*(){}[]^: AND NEAR')).not.toThrow()
  })

  it('respects the limit', () => {
    // 'd' prefixes both titles, so unlimited this would return 2.
    expect(search(db, 'd').length).toBeGreaterThan(1)
    expect(search(db, 'd', 1)).toHaveLength(1)
  })

  it('drops a deleted note from the index', () => {
    const note = notes.createNote(db, { bodyMd: 'ephemeral zebra content' })
    expect(search(db, 'zebra')).toHaveLength(1)
    notes.deleteNote(db, note.id)
    expect(search(db, 'zebra')).toHaveLength(0)
  })

  it('reflects an edited note body in the index', () => {
    const note = notes.createNote(db, { bodyMd: 'original walrus text' })
    notes.updateNote(db, note.id, { bodyMd: 'replaced penguin text' })
    expect(search(db, 'walrus')).toHaveLength(0)
    expect(search(db, 'penguin')).toHaveLength(1)
  })

  it('reflects a retitled book in the index', () => {
    const book = books.createBook(db, { title: 'Old Title Aardvark' })
    books.updateBook(db, book.id, { title: 'New Title Narwhal' })
    expect(search(db, 'aardvark')).toHaveLength(0)
    expect(search(db, 'narwhal')).toHaveLength(1)
  })

  it('folds diacritics so cafe matches Café', () => {
    notes.createNote(db, { bodyMd: 'written in a Café somewhere' })
    expect(search(db, 'cafe').length).toBeGreaterThan(0)
  })
})
