import type { Database } from 'better-sqlite3'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createDatabase } from '../src/main/db/database'
import * as books from '../src/main/repos/books'
import * as notes from '../src/main/repos/notes'
import { parseCollection, planImport, runImport } from '../src/main/services/calibre'

let db: Database
let dir: string

beforeEach(() => {
  db = createDatabase(':memory:')
  dir = mkdtempSync(join(tmpdir(), 'interleaf-calibre-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

interface Annotation {
  book_id?: number
  uuid?: string
  type?: string
  highlighted_text?: string
  notes?: string
  timestamp?: string
}

function annotation(overrides: Annotation = {}): Annotation {
  return {
    book_id: 42,
    uuid: 'k2QpvLm7T0aZ9RxCwXyNbA',
    type: 'highlight',
    highlighted_text: 'Nothing is so painful to the human mind as a great and sudden change.',
    timestamp: '2025-11-02T14:08:12.640Z',
    ...overrides
  }
}

function exportFile(annotations: Annotation[], name = 'annotations.json'): string {
  const path = join(dir, name)
  writeFileSync(
    path,
    JSON.stringify({ type: 'calibre_annotation_collection', version: 1, annotations })
  )
  return path
}

describe('upgrading a library that predates the import', () => {
  it('keeps the quotes already in it and imports alongside them', () => {
    const file = join(dir, 'interleaf.db')
    const before = createDatabase(file, 14)
    const bookId = Number(
      before.prepare("INSERT INTO book (title) VALUES ('Frankenstein')").run().lastInsertRowid
    )
    notes.createNote(before, { bookId, kind: 'highlight', bodyMd: 'Typed by hand' })
    before.close()

    const after = createDatabase(file)
    try {
      runImport(after, exportFile([annotation()]), [{ calibreId: 42, bookId }])
      expect(notes.listNotes(after).map((note) => note.bodyMd)).toContain('Typed by hand')
      expect(notes.listNotes(after)).toHaveLength(2)
    } finally {
      after.close()
    }
  })
})

describe('reading an export', () => {
  it('refuses a file that is not one', () => {
    expect(() => parseCollection('{"type":"something else","annotations":[]}')).toThrow(
      /not a Calibre annotations export/
    )
    expect(() => parseCollection('not json at all')).toThrow(/not a Calibre annotations export/)
  })

  it('reads a file that starts with a byte order mark, as Calibre writes it', () => {
    const kept = parseCollection(
      '﻿' + JSON.stringify({ type: 'calibre_annotation_collection', annotations: [annotation()] })
    )
    expect(kept).toHaveLength(1)
  })

  it('keeps highlights and drops everything else', () => {
    const kept = parseCollection(
      JSON.stringify({
        type: 'calibre_annotation_collection',
        annotations: [
          annotation(),
          annotation({ uuid: 'b', type: 'bookmark' }),
          annotation({ uuid: 'c', highlighted_text: '   ' }),
          annotation({ uuid: '' })
        ]
      })
    )

    expect(kept).toHaveLength(1)
    expect(kept[0].uuid).toBe('k2QpvLm7T0aZ9RxCwXyNbA')
  })

  it('groups by Calibre book and counts what is new', () => {
    const book = books.createBook(db, { title: 'Frankenstein' })
    runImport(db, exportFile([annotation()]), [{ calibreId: 42, bookId: book.id }])

    const plan = planImport(
      db,
      exportFile([
        annotation(),
        annotation({ uuid: 'second' }),
        annotation({ book_id: 21, uuid: 'c' })
      ])
    )

    const shelley = plan.books.find((entry) => entry.calibreId === 42)
    expect(shelley).toMatchObject({ bookId: book.id, newHighlights: 1, knownHighlights: 1 })
    // Never matched, so it has no book and everything in it is new.
    expect(plan.books.find((entry) => entry.calibreId === 21)).toMatchObject({
      bookId: null,
      newHighlights: 1
    })
  })

  it('carries passages so an unnamed book can be recognised', () => {
    const plan = planImport(db, exportFile([annotation()]))
    expect(plan.books[0].samples[0]).toContain('a great and sudden change')
  })

  it('writes nothing', () => {
    books.createBook(db, { title: 'Frankenstein' })
    planImport(db, exportFile([annotation()]))
    expect(notes.listNotes(db)).toHaveLength(0)
  })
})

describe('importing highlights', () => {
  it('stores each one as a quote on the matched book', () => {
    const book = books.createBook(db, { title: 'Frankenstein' })

    const result = runImport(db, exportFile([annotation()]), [{ calibreId: 42, bookId: book.id }])

    expect(result).toEqual({ imported: 1, skipped: 0, books: 1 })
    const [quote] = notes.listNotes(db)
    expect(quote.kind).toBe('highlight')
    expect(quote.bookId).toBe(book.id)
    expect(quote.bodyMd).toBe(
      'Nothing is so painful to the human mind as a great and sudden change.'
    )
  })

  it('keeps the date the passage was highlighted', () => {
    const book = books.createBook(db, { title: 'Frankenstein' })
    runImport(db, exportFile([annotation()]), [{ calibreId: 42, bookId: book.id }])

    expect(notes.listNotes(db)[0].createdAt).toBe(
      Math.floor(Date.parse('2025-11-02T14:08:12.640Z') / 1000)
    )
  })

  it('puts a Calibre note under the passage as a quotation', () => {
    const book = books.createBook(db, { title: 'Frankenstein' })
    runImport(db, exportFile([annotation({ notes: 'Read this again after the second volume.' })]), [
      { calibreId: 42, bookId: book.id }
    ])

    expect(notes.listNotes(db)[0].bodyMd).toBe(
      'Nothing is so painful to the human mind as a great and sudden change.\n\n> Read this again after the second volume.'
    )
  })

  it('skips a book left unmatched', () => {
    const book = books.createBook(db, { title: 'Frankenstein' })

    const result = runImport(
      db,
      exportFile([annotation(), annotation({ book_id: 21, uuid: 'other' })]),
      [{ calibreId: 42, bookId: book.id }]
    )

    expect(result).toEqual({ imported: 1, skipped: 1, books: 1 })
    expect(notes.listNotes(db)).toHaveLength(1)
  })

  it('adds nothing on a second run of the same file', () => {
    const book = books.createBook(db, { title: 'Frankenstein' })
    const path = exportFile([annotation()])
    runImport(db, path, [{ calibreId: 42, bookId: book.id }])

    const again = runImport(db, path, [{ calibreId: 42, bookId: book.id }])

    expect(again).toEqual({ imported: 0, skipped: 1, books: 0 })
    expect(notes.listNotes(db)).toHaveLength(1)
  })

  it('leaves a highlight edited in Calibre as it was imported', () => {
    const book = books.createBook(db, { title: 'Frankenstein' })
    runImport(db, exportFile([annotation()]), [{ calibreId: 42, bookId: book.id }])

    runImport(db, exportFile([annotation({ highlighted_text: 'a longer passage entirely' })]), [
      { calibreId: 42, bookId: book.id }
    ])

    const stored = notes.listNotes(db)
    expect(stored).toHaveLength(1)
    expect(stored[0].bodyMd).toBe(
      'Nothing is so painful to the human mind as a great and sudden change.'
    )
  })

  it('remembers the match, so a later export needs none', () => {
    const book = books.createBook(db, { title: 'Frankenstein' })
    runImport(db, exportFile([annotation()]), [{ calibreId: 42, bookId: book.id }])

    const plan = planImport(db, exportFile([annotation({ uuid: 'later' })]))

    expect(plan.books[0].bookId).toBe(book.id)
    expect(runImport(db, plan.filePath, []).imported).toBe(1)
  })

  it('refuses a match to a book that is gone', () => {
    expect(() =>
      runImport(db, exportFile([annotation()]), [{ calibreId: 42, bookId: 404 }])
    ).toThrow(/no longer in your library/)
    expect(notes.listNotes(db)).toHaveLength(0)
  })

  it('forgets the match when the book is deleted', () => {
    const book = books.createBook(db, { title: 'Frankenstein' })
    runImport(db, exportFile([annotation()]), [{ calibreId: 42, bookId: book.id }])

    books.deleteBook(db, book.id)

    expect(planImport(db, exportFile([annotation({ uuid: 'later' })])).books[0].bookId).toBeNull()
  })
})
