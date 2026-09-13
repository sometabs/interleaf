import type { Database } from 'better-sqlite3'
import { beforeEach, describe, expect, it } from 'vitest'

import { createDatabase } from '../src/main/db/database'
import * as books from '../src/main/repos/books'
import * as data from '../src/main/repos/data'
import * as meta from '../src/main/repos/metadata'
import * as notes from '../src/main/repos/notes'

let db: Database

beforeEach(() => {
  db = createDatabase(':memory:')
})

function candidate(olid: string, title: string, author: string | null): meta.CandidateRow {
  return {
    olid,
    editionOlid: null,
    isbn: null,
    title,
    author,
    subjects: ['science fiction'],
    description: null,
    coverId: null,
    pageCount: null,
    publishedYear: null,
    source: 'subject:x',
    languages: ['eng']
  }
}

describe('deleting all books', () => {
  it('removes every book', () => {
    books.createBook(db, { title: 'Dune' })
    books.createBook(db, { title: 'Recursion' })

    expect(data.deleteAllBooks(db)).toBe(2)
    expect(books.listBooks(db)).toHaveLength(0)
  })

  it('takes the notes attached to them', () => {
    const book = books.createBook(db, { title: 'Dune' })
    notes.createNote(db, { bookId: book.id, bodyMd: 'attached' })

    data.deleteAllBooks(db)

    expect(notes.listNotes(db)).toHaveLength(0)
  })

  it('leaves free-floating notes alone', () => {
    books.createBook(db, { title: 'Dune' })
    notes.createNote(db, { bodyMd: 'floating' })

    data.deleteAllBooks(db)

    expect(notes.listNotes(db)).toHaveLength(1)
  })
})

describe('deleting all notes', () => {
  it('removes attached and free-floating alike', () => {
    const book = books.createBook(db, { title: 'Dune' })
    notes.createNote(db, { bookId: book.id, bodyMd: 'attached' })
    notes.createNote(db, { bodyMd: 'floating' })

    expect(data.deleteAllNotes(db)).toBe(2)
    expect(notes.listNotes(db)).toHaveLength(0)
  })

  it('keeps the books', () => {
    const book = books.createBook(db, { title: 'Dune' })
    notes.createNote(db, { bookId: book.id, bodyMd: 'attached' })

    data.deleteAllNotes(db)

    expect(books.listBooks(db)).toHaveLength(1)
  })
})

describe('deleting everything', () => {
  it('empties books, notes, candidates and decisions', () => {
    const book = books.createBook(db, { title: 'Dune' })
    notes.createNote(db, { bookId: book.id, bodyMd: 'x' })
    notes.createNote(db, { bodyMd: 'floating' })
    meta.upsertCandidates(db, [candidate('OL1W', 'Solaris', 'Lem')])
    meta.recordFeedback(db, 'OL1W', 'dismissed')

    data.deleteEverything(db)

    expect(data.dataCounts(db)).toEqual({ books: 0, notes: 0, candidates: 0, dismissed: 0 })
  })

  // Empty, not un-migrated: the next launch must not rebuild the schema.
  it('leaves the schema in place', () => {
    const version = db.pragma('user_version', { simple: true })

    data.deleteEverything(db)

    expect(db.pragma('user_version', { simple: true })).toBe(version)
    expect(() => books.createBook(db, { title: 'Fresh start' })).not.toThrow()
  })
})

describe('the Not for me list', () => {
  it('remembers what the refused book was called', () => {
    meta.upsertCandidates(db, [candidate('OL1W', 'Os Maias', 'Eça de Queiroz')])

    meta.recordFeedback(db, 'OL1W', 'dismissed')

    expect(meta.dismissedBooks(db)[0]).toMatchObject({
      olid: 'OL1W',
      title: 'Os Maias',
      author: 'Eça de Queiroz'
    })
  })

  // The pool the name came from is a cache, and clearing it must not leave
  // bare identifiers behind.
  it('still knows the name after the candidate pool is emptied', () => {
    meta.upsertCandidates(db, [candidate('OL1W', 'Os Maias', 'Eça de Queiroz')])
    meta.recordFeedback(db, 'OL1W', 'dismissed')

    db.prepare('DELETE FROM book_candidate').run()

    expect(meta.dismissedBooks(db)[0].title).toBe('Os Maias')
  })

  it('records a refusal for a book that is no longer in the pool', () => {
    meta.recordFeedback(db, 'OL9W', 'dismissed')

    expect(meta.dismissedBooks(db)).toHaveLength(1)
    expect(meta.dismissedBooks(db)[0].title).toBeNull()
  })

  it('does not blank a name a second dismissal cannot see', () => {
    meta.upsertCandidates(db, [candidate('OL1W', 'Os Maias', 'Eça de Queiroz')])
    meta.recordFeedback(db, 'OL1W', 'dismissed')
    db.prepare('DELETE FROM book_candidate').run()

    meta.recordFeedback(db, 'OL1W', 'dismissed')

    expect(meta.dismissedBooks(db)[0].title).toBe('Os Maias')
  })

  it('lists the most recent refusal first', () => {
    meta.recordFeedback(db, 'OL1W', 'dismissed')
    db.prepare("UPDATE rec_feedback SET at = 100 WHERE olid = 'OL1W'").run()
    meta.recordFeedback(db, 'OL2W', 'dismissed')
    db.prepare("UPDATE rec_feedback SET at = 200 WHERE olid = 'OL2W'").run()

    expect(meta.dismissedBooks(db).map((b) => b.olid)).toEqual(['OL2W', 'OL1W'])
  })

  it('shows only refusals, not books saved from Discover', () => {
    meta.recordFeedback(db, 'OL1W', 'saved')

    expect(meta.dismissedBooks(db)).toHaveLength(0)
  })

  it('puts a book back in circulation when the refusal is undone', () => {
    meta.upsertCandidates(db, [candidate('OL1W', 'Os Maias', null)])
    meta.recordFeedback(db, 'OL1W', 'dismissed')
    expect(meta.scorableCandidates(db)).toHaveLength(0)

    meta.undismiss(db, 'OL1W')

    expect(meta.dismissedBooks(db)).toHaveLength(0)
    expect(meta.scorableCandidates(db)).toHaveLength(1)
  })
})

describe('the counts shown beside each button', () => {
  it('reports what is actually there', () => {
    books.createBook(db, { title: 'Dune' })
    notes.createNote(db, { bodyMd: 'x' })
    meta.upsertCandidates(db, [candidate('OL1W', 'Solaris', null)])
    meta.recordFeedback(db, 'OL2W', 'dismissed')

    expect(data.dataCounts(db)).toEqual({ books: 1, notes: 1, candidates: 1, dismissed: 1 })
  })
})
