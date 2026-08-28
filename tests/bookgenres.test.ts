import type { Database } from 'better-sqlite3'
import { beforeEach, describe, expect, it } from 'vitest'

import { createDatabase } from '../src/main/db/database'
import * as books from '../src/main/repos/books'
import { fromChosenGenres } from '../src/shared/categories'

// The column is on `book`, not `book_metadata`: that table is a cache rewritten
// whole by every enrichment.
let db: Database

beforeEach(() => {
  db = createDatabase(':memory:')
})

describe('storing chosen genres', () => {
  it('starts as null, which means nothing has been chosen', () => {
    expect(books.createBook(db, { title: 'Unfu*k Yourself' }).genres).toBeNull()
  })

  it('round-trips a list through SQLite', () => {
    const book = books.createBook(db, { title: 'Dune' })
    books.updateBook(db, book.id, { genres: ['Science Fiction', 'Fantasy'] })

    expect(books.getBook(db, book.id)?.genres).toEqual(['Science Fiction', 'Fantasy'])
  })

  // Null leaves the inference in charge; an empty list silences it.
  it('keeps an empty choice distinct from no choice', () => {
    const book = books.createBook(db, { title: 'Dune' })

    books.updateBook(db, book.id, { genres: [] })
    expect(books.getBook(db, book.id)?.genres).toEqual([])

    books.updateBook(db, book.id, { genres: null })
    expect(books.getBook(db, book.id)?.genres).toBeNull()
  })

  it('leaves the column alone when the patch omits it', () => {
    const book = books.createBook(db, { title: 'Dune' })
    books.updateBook(db, book.id, { genres: ['Fantasy'] })
    books.updateBook(db, book.id, { rating: 5 })

    expect(books.getBook(db, book.id)?.genres).toEqual(['Fantasy'])
  })

  it('reads unparseable content as no choice', () => {
    const book = books.createBook(db, { title: 'Dune' })
    db.prepare('UPDATE book SET genres = ? WHERE id = ?').run('{not json', book.id)

    expect(books.getBook(db, book.id)?.genres).toBeNull()
  })

  it('reads a JSON value that is not a list as no choice', () => {
    const book = books.createBook(db, { title: 'Dune' })
    db.prepare('UPDATE book SET genres = ? WHERE id = ?').run('"Fantasy"', book.id)

    expect(books.getBook(db, book.id)?.genres).toBeNull()
  })

  it('drops non-strings rather than handing them on', () => {
    const book = books.createBook(db, { title: 'Dune' })
    db.prepare('UPDATE book SET genres = ? WHERE id = ?').run('["Fantasy", 7, null]', book.id)

    expect(books.getBook(db, book.id)?.genres).toEqual(['Fantasy'])
  })

  it('leaves rows written before the migration unchosen', () => {
    const book = books.createBook(db, { title: 'Dune' })
    db.prepare('UPDATE book SET genres = NULL WHERE id = ?').run(book.id)

    expect(books.getBook(db, book.id)?.genres).toBeNull()
  })
})

describe('turning a choice into a shelf', () => {
  it('derives the group from the genres rather than asking twice', () => {
    // Asking separately would allow Fantasy under Non-fiction.
    expect(fromChosenGenres(['Fantasy'])).toEqual({ group: 'Fiction', genres: ['Fantasy'] })
    expect(fromChosenGenres(['Psychology'])).toEqual({
      group: 'Non-fiction',
      genres: ['Psychology']
    })
  })

  it('lets the first genre decide when a choice spans both groups', () => {
    expect(fromChosenGenres(['Historical Fiction', 'History'])?.group).toBe('Fiction')
    expect(fromChosenGenres(['History', 'Historical Fiction'])?.group).toBe('Non-fiction')
  })

  it('ignores a name that is not in the vocabulary', () => {
    expect(fromChosenGenres(['Fantasy', 'Cyberpunk Westerns'])).toEqual({
      group: 'Fiction',
      genres: ['Fantasy']
    })
  })

  it('reports nothing at all when no name survives', () => {
    expect(fromChosenGenres([])).toBeNull()
    expect(fromChosenGenres(['Cyberpunk Westerns'])).toBeNull()
  })
})
