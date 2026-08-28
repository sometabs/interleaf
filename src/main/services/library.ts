import type { Database } from 'better-sqlite3'

import type { Book, OlBookDto } from '../../shared/api'
import * as books from '../repos/books'
import { saveBookMetadata } from '../repos/metadata'
import { cacheCover } from './covers'
import { fetchWork, searchBooks } from './openlibrary'

// The row is created and returned even if enrichment fails, so an offline
// reader still gets their book.
export async function addFromOpenLibrary(db: Database, dto: OlBookDto): Promise<Book> {
  const existing = db
    .prepare<[string], { id: number }>('SELECT id FROM book WHERE olid = ?')
    .get(dto.olid)
  if (existing) {
    const found = books.getBook(db, existing.id)
    if (found) return found
  }

  const created = books.createBook(db, {
    title: dto.title || dto.olid,
    author: dto.author,
    olid: dto.olid,
    isbn: dto.isbn,
    pageCount: dto.pageCount,
    publishedYear: dto.firstPublishYear,
    status: 'want'
  })

  const enriched = await enrich(db, created.id, dto.coverId)
  return enriched ?? created
}

// Safe to call repeatedly, and offline, where it does nothing.
export async function enrich(
  db: Database,
  bookId: number,
  knownCoverId: number | null = null
): Promise<Book | null> {
  const book = books.getBook(db, bookId)
  if (!book) return null

  let olid = book.olid
  let coverId = knownCoverId
  // Whether a search has already been spent here, so the cover fallback below
  // does not repeat it.
  let alreadySearched = false

  // A manually added book has no olid, so find one from title and author. This
  // searches on *title*, never on an olid: `q=<olid>` matches nothing.
  if (!olid) {
    const query = [book.title, book.author].filter(Boolean).join(' ')
    // Best-effort: a failed lookup leaves the book as the reader typed it.
    const [best] = (await searchBooks(query, 1)) ?? []
    alreadySearched = true
    if (!best) return book
    olid = best.olid
    coverId ??= best.coverId
    books.updateBook(db, bookId, {
      olid,
      author: book.author ?? best.author,
      publishedYear: book.publishedYear ?? best.firstPublishYear,
      pageCount: book.pageCount ?? best.pageCount
    })
  }

  const work = await fetchWork(olid)
  if (work) {
    saveBookMetadata(db, bookId, {
      subjects: work.subjects,
      description: work.description,
      raw: work.raw
    })

    // Heal a row whose title never resolved: manual entry can leave it blank,
    // and a book added by olid alone is titled with that olid.
    if (work.title && (book.title === book.olid || book.title.trim() === '')) {
      books.updateBook(db, bookId, { title: work.title })
    }

    coverId ??= work.covers[0] ?? null
  }

  // A title search usually knows a cover even when the work record does not.
  // Skipped if the branch above already searched, at ~1 request/second.
  if (coverId === null && !alreadySearched) {
    const [best] = (await searchBooks(book.title, 1)) ?? []
    coverId = best?.coverId ?? null
  }

  if (coverId !== null && !book.coverPath) {
    const fileName = await cacheCover(bookId, coverId)
    if (fileName) books.updateBook(db, bookId, { coverPath: fileName })
  }

  return books.getBook(db, bookId)
}
