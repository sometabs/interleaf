import type { Database } from 'better-sqlite3'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createDatabase } from '../src/main/db/database'
import * as books from '../src/main/repos/books'
import * as notes from '../src/main/repos/notes'
import { planImport, runImport } from '../src/main/services/highlights'
import { parseKindleClippings } from '../src/main/services/kindle'

let db: Database
let dir: string

beforeEach(() => {
  db = createDatabase(':memory:')
  dir = mkdtempSync(join(tmpdir(), 'interleaf-kindle-'))
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

function clipping({
  title = "The Clockmaker's Map: A Field Guide",
  author = 'Mira Vale;Jon Bell',
  type = 'Highlight',
  location = '283-284',
  date = 'Saturday, 5 September 2026 14:36:51',
  text = 'The brass compass pointed toward the mountains, though no road appeared on the map.'
}: {
  title?: string
  author?: string
  type?: 'Bookmark' | 'Highlight' | 'Note'
  location?: string | null
  date?: string
  text?: string
} = {}): string {
  const where = location === null ? '' : ` | Location ${location}`
  return `${title} (${author})
- Your ${type} on page 19${where} | Added on ${date}

${text}
==========`
}

function exportFile(raw: string): string {
  const path = join(dir, 'My Clippings.txt')
  writeFileSync(path, raw)
  return path
}

describe('reading Kindle clippings', () => {
  it('reads titles, authors, locations and highlight text', () => {
    const [highlight] = parseKindleClippings('\uFEFF' + clipping())

    expect(highlight).toMatchObject({
      title: "The Clockmaker's Map: A Field Guide",
      author: 'Mira Vale, Jon Bell',
      location: '283-284',
      text: 'The brass compass pointed toward the mountains, though no road appeared on the map.',
      timestamp: 'Saturday, 5 September 2026 14:36:51'
    })
  })

  it('ignores bookmarks and notes', () => {
    const parsed = parseKindleClippings(
      [clipping({ type: 'Bookmark', text: '' }), clipping(), clipping({ type: 'Note' })].join('\n')
    )
    expect(parsed).toHaveLength(1)
  })

  it('accepts a valid file containing no highlights', () => {
    expect(parseKindleClippings(clipping({ type: 'Bookmark', text: '' }))).toEqual([])
  })

  it('rejects unrelated text files', () => {
    expect(() => parseKindleClippings('These are not Kindle clippings.')).toThrow(
      /not a Kindle clippings file/
    )
  })

  it('keeps parentheses that belong to the title', () => {
    const [highlight] = parseKindleClippings(
      clipping({ title: 'A Book (With a Subtitle)', author: 'Ari Stone' })
    )
    expect(highlight.title).toBe('A Book (With a Subtitle)')
    expect(highlight.author).toBe('Ari Stone')
  })
})

describe('planning a Kindle import', () => {
  it('shows Kindle metadata but never guesses a library match', () => {
    books.createBook(db, { title: "The Clockmaker's Map", author: 'Mira Vále' })

    const plan = planImport(db, exportFile(clipping()))

    expect(plan.source).toBe('kindle')
    expect(plan.books).toHaveLength(1)
    expect(plan.books[0]).toMatchObject({
      sourceTitle: "The Clockmaker's Map: A Field Guide",
      sourceAuthor: 'Mira Vale, Jon Bell',
      bookId: null,
      newHighlights: 1,
      knownHighlights: 0
    })
  })
})

describe('importing Kindle highlights', () => {
  it('stores the passage and Kindle date on the manually matched book', () => {
    const book = books.createBook(db, { title: "The Clockmaker's Map" })
    const file = exportFile(clipping())
    const plan = planImport(db, file)

    const result = runImport(db, file, [{ sourceKey: plan.books[0].sourceKey, bookId: book.id }])

    expect(result).toEqual({ imported: 1, skipped: 0, books: 1 })
    const [quote] = notes.listNotes(db)
    expect(quote.bookId).toBe(book.id)
    expect(quote.bodyMd).toContain('The brass compass pointed toward the mountains')
    expect(quote.createdAt).toBe(
      Math.floor(Date.parse('Saturday, 5 September 2026 14:36:51') / 1000)
    )
  })

  it('remembers the book match and skips the same clipping next time', () => {
    const book = books.createBook(db, { title: "The Clockmaker's Map" })
    const file = exportFile(clipping())
    const first = planImport(db, file)
    runImport(db, file, [{ sourceKey: first.books[0].sourceKey, bookId: book.id }])

    const second = planImport(db, file)
    expect(second.books[0]).toMatchObject({
      bookId: book.id,
      newHighlights: 0,
      knownHighlights: 1
    })
    expect(runImport(db, file, [])).toEqual({ imported: 0, skipped: 1, books: 0 })
  })

  it('does not use the date in the fingerprint', () => {
    const book = books.createBook(db, { title: "The Clockmaker's Map" })
    const file = exportFile(clipping())
    const plan = planImport(db, file)
    runImport(db, file, [{ sourceKey: plan.books[0].sourceKey, bookId: book.id }])

    const changedDate = exportFile(clipping({ date: 'Sunday, 6 September 2026 09:00:00' }))
    expect(runImport(db, changedDate, [])).toEqual({ imported: 0, skipped: 1, books: 0 })
  })

  it('keeps identical text highlighted at two different locations', () => {
    const book = books.createBook(db, { title: 'Repeated Sentences' })
    const raw = [
      clipping({ title: 'Repeated Sentences', location: '100', text: 'Again.' }),
      clipping({ title: 'Repeated Sentences', location: '200', text: 'Again.' })
    ].join('\n')
    const file = exportFile(raw)
    const plan = planImport(db, file)

    expect(
      runImport(db, file, [{ sourceKey: plan.books[0].sourceKey, bookId: book.id }]).imported
    ).toBe(2)
    expect(notes.listNotes(db)).toHaveLength(2)
  })
})
