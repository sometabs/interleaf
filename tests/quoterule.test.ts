import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createDatabase } from '../src/main/db/database'
import * as books from '../src/main/repos/books'
import * as notes from '../src/main/repos/notes'

// The schema 014 was written against. Rewinding the version instead would
// rerun every later migration too, and those are not repeatable.
const BEFORE_THE_RULE = 13

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'interleaf-quote-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('a quote belongs to a book', () => {
  it('refuses one with no book', () => {
    const db = createDatabase(':memory:')

    expect(() => notes.createNote(db, { kind: 'highlight', bodyMd: 'A passage' })).toThrow(
      /belong to a book/
    )
  })

  it('still allows a note with no book', () => {
    const db = createDatabase(':memory:')

    const note = notes.createNote(db, { kind: 'thought', bodyMd: 'A thought' })

    expect(note.bookId).toBeNull()
  })

  it('still allows a quote that has one', () => {
    const db = createDatabase(':memory:')
    const book = books.createBook(db, { title: 'Dune' })

    const quote = notes.createNote(db, { kind: 'highlight', bookId: book.id, bodyMd: 'A passage' })

    expect(quote.kind).toBe('highlight')
  })
})

describe('quotes left over from before the rule', () => {
  it('become notes rather than disappearing', () => {
    const file = join(dir, 'interleaf.db')

    // Written by a build that still allowed it, then reopened by this one.
    const before = createDatabase(file, BEFORE_THE_RULE)
    before
      .prepare("INSERT INTO note (book_id, kind, title, body_md) VALUES (NULL, 'highlight', ?, ?)")
      .run('Orphaned', 'A passage from nowhere')
    before.close()

    const after = createDatabase(file)
    try {
      const row = after
        .prepare<[], { kind: string; body_md: string }>('SELECT kind, body_md FROM note')
        .get()
      expect(row?.kind).toBe('thought')
      expect(row?.body_md).toBe('A passage from nowhere')
    } finally {
      after.close()
    }
  })

  it('leaves a quote that has a book alone', () => {
    const file = join(dir, 'interleaf.db')

    const before = createDatabase(file, BEFORE_THE_RULE)
    const book = books.createBook(before, { title: 'Dune' })
    before
      .prepare("INSERT INTO note (book_id, kind, title, body_md) VALUES (?, 'highlight', ?, ?)")
      .run(book.id, 'Kept', 'The spice must flow')
    before.close()

    const after = createDatabase(file)
    try {
      expect(after.prepare<[], { kind: string }>('SELECT kind FROM note').get()?.kind).toBe(
        'highlight'
      )
    } finally {
      after.close()
    }
  })
})

describe('the schema itself', () => {
  it('has no unattached quote left in a fresh database', () => {
    const db: Database.Database = createDatabase(':memory:')

    const stray = db
      .prepare<[], { n: number }>(
        "SELECT count(*) AS n FROM note WHERE kind = 'highlight' AND book_id IS NULL"
      )
      .get()

    expect(stray?.n).toBe(0)
  })
})
