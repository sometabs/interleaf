import type { Database } from 'better-sqlite3'
import { beforeEach, describe, expect, it } from 'vitest'

import { createDatabase } from '../src/main/db/database'
import * as books from '../src/main/repos/books'
import * as files from '../src/main/repos/bookFiles'
import * as marks from '../src/main/repos/bookmarks'

let db: Database
let bookId: number

const revision = (): string =>
  db.prepare<[], { revision: string }>('SELECT revision FROM library_revision').get()!.revision

function attach(sha = 'a'): void {
  files.setBookFile(db, bookId, { sha256: sha.repeat(64), fileName: 'book.epub', size: 10 })
}

beforeEach(() => {
  db = createDatabase(':memory:')
  bookId = books.createBook(db, { title: 'The Lighthouse Keeper' }).id
  attach()
})

describe('bookmarks', () => {
  it('keeps the place, the first words of the page and the chapter', () => {
    marks.addBookmark(db, bookId, {
      cfi: 'epubcfi(/6/8!/4/2,/1:0,/1:40)',
      excerpt: '  The lamp had to be\n wound every four hours.  ',
      chapter: 'The Gallery'
    })

    expect(marks.listBookmarks(db, bookId)).toMatchObject([
      {
        bookId,
        cfi: 'epubcfi(/6/8!/4/2,/1:0,/1:40)',
        excerpt: 'The lamp had to be wound every four hours.',
        chapter: 'The Gallery'
      }
    ])
  })

  it('marks a place only once', () => {
    const first = marks.addBookmark(db, bookId, {
      cfi: 'epubcfi(/6/4)',
      excerpt: 'a',
      chapter: null
    })
    const again = marks.addBookmark(db, bookId, {
      cfi: 'epubcfi(/6/4)',
      excerpt: 'b',
      chapter: null
    })

    expect(again.id).toBe(first.id)
    expect(marks.listBookmarks(db, bookId)).toHaveLength(1)
  })

  it('refuses something that is not a place in a book', () => {
    expect(() =>
      marks.addBookmark(db, bookId, { cfi: 'javascript:alert(1)', excerpt: '', chapter: null })
    ).toThrow('Invalid bookmark.')
  })

  it('keeps long text short', () => {
    const saved = marks.addBookmark(db, bookId, {
      cfi: 'epubcfi(/6/4)',
      excerpt: 'word '.repeat(200),
      chapter: ''
    })

    expect(saved.excerpt.length).toBeLessThanOrEqual(200)
    expect(saved.chapter).toBeNull()
  })

  it('removes one bookmark and leaves the rest', () => {
    const gone = marks.addBookmark(db, bookId, { cfi: 'epubcfi(/6/4)', excerpt: '', chapter: null })
    marks.addBookmark(db, bookId, { cfi: 'epubcfi(/6/6)', excerpt: '', chapter: null })

    marks.removeBookmark(db, gone.id)

    expect(marks.listBookmarks(db, bookId).map((mark) => mark.cfi)).toEqual(['epubcfi(/6/6)'])
  })

  it('needs an EPUB to mark', () => {
    files.removeBookFile(db, bookId)

    expect(() =>
      marks.addBookmark(db, bookId, { cfi: 'epubcfi(/6/4)', excerpt: '', chapter: null })
    ).toThrow()
  })

  // A place in one file points at nothing in another.
  it('drops the bookmarks when the EPUB is replaced or removed', () => {
    marks.addBookmark(db, bookId, { cfi: 'epubcfi(/6/4)', excerpt: '', chapter: null })
    attach('b')
    expect(marks.listBookmarks(db, bookId)).toEqual([])

    marks.addBookmark(db, bookId, { cfi: 'epubcfi(/6/4)', excerpt: '', chapter: null })
    files.removeBookFile(db, bookId)
    expect(marks.listBookmarks(db, bookId)).toEqual([])
  })

  it('counts as a change for the automatic backup', () => {
    const before = revision()

    marks.addBookmark(db, bookId, { cfi: 'epubcfi(/6/4)', excerpt: '', chapter: null })

    expect(revision()).not.toBe(before)
  })
})
