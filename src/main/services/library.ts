import type { Database } from 'better-sqlite3'

import type {
  Book,
  MetadataRefreshFailure,
  MetadataRefreshProgress,
  MetadataRefreshResult,
  OlBookDto
} from '../../shared/api'
import * as books from '../repos/books'
import { saveBookMetadata } from '../repos/metadata'
import { cacheCover } from './covers'
import { fetchWork, searchBookByTitleAuthor, searchWorkByOlid } from './openlibrary'

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
    editionOlid: dto.editionOlid,
    isbn: dto.isbn,
    pageCount: dto.pageCount,
    publishedYear: dto.publishedYear,
    status: 'want'
  })

  const enriched = await enrich(
    db,
    created.id,
    dto.coverId,
    dto.subjects ?? [],
    dto.description ?? null
  )
  return enriched ?? created
}

// Safe to call repeatedly, and offline, where it does nothing.
export async function enrich(
  db: Database,
  bookId: number,
  knownCoverId: number | null = null,
  knownSubjects: readonly string[] = [],
  knownDescription: string | null = null
): Promise<Book | null> {
  const book = books.getBook(db, bookId)
  if (!book) return null

  let olid = book.olid
  let editionOlid = book.editionOlid
  let coverId = knownCoverId
  let searchSubjects = [...knownSubjects]
  let searchDescription = knownDescription
  // Whether a search has already been spent here, so the cover fallback below
  // does not repeat it.
  let alreadySearched = false

  // A manually added book has no olid, so find one from title and author. This
  // searches on *title*, never on an olid: `q=<olid>` matches nothing.
  if (!olid) {
    // Best-effort: a failed lookup leaves the book as the reader typed it.
    const [best] = (await searchBookByTitleAuthor(book.title, book.author, 1)) ?? []
    alreadySearched = true
    if (!best) return book
    olid = best.olid
    editionOlid = best.editionOlid
    coverId ??= best.coverId
    searchSubjects = best.subjects
    searchDescription = best.description
    books.updateBook(db, bookId, {
      olid,
      editionOlid,
      isbn: book.isbn ?? best.isbn,
      author: book.author ?? best.author,
      publishedYear: book.publishedYear ?? best.publishedYear,
      pageCount: book.pageCount ?? best.pageCount
    })
  }

  const work = await fetchWork(olid)

  // Older Interleaf versions saved only the work record, so existing shelves
  // may need the richer Search API subjects. A refresh may supplement the same
  // work, but it never silently changes the work OLID.
  const sparseWork = searchSubjects.length === 0 && work && work.subjects.length <= 3
  if (!alreadySearched && (sparseWork || editionOlid === null)) {
    const matches = await searchBookByTitleAuthor(book.title, book.author, 12)
    alreadySearched = true
    const best = matches?.find((match) => match.olid === olid)

    if (best) {
      searchSubjects = best.subjects
      searchDescription = best.description
      const canUseEdition = editionOlid === null || editionOlid === best.editionOlid
      if (canUseEdition) {
        editionOlid = best.editionOlid
        coverId ??= best.coverId
        books.updateBook(db, bookId, {
          editionOlid,
          isbn: best.isbn,
          publishedYear: book.publishedYear ?? best.publishedYear,
          pageCount: book.pageCount ?? best.pageCount
        })
      }
    }
  }

  const subjects = searchSubjects.length > 0 ? searchSubjects : (work?.subjects ?? [])
  const description = work?.description ?? searchDescription
  if (work || subjects.length > 0 || description) {
    saveBookMetadata(db, bookId, {
      subjects,
      description,
      raw: work?.raw
    })

    // Heal a row whose title never resolved: manual entry can leave it blank,
    // and a book added by olid alone is titled with that olid.
    if (work?.title && (book.title === book.olid || book.title.trim() === '')) {
      books.updateBook(db, bookId, { title: work.title })
    }

    // A work cover is only a fallback when no concrete edition was selected.
    if (editionOlid === null) coverId ??= work?.covers[0] ?? null
  }

  // A title search usually knows a cover even when the work record does not.
  // Skipped if the branch above already searched, at ~1 request/second.
  if (coverId === null && !alreadySearched) {
    const [best] = (await searchBookByTitleAuthor(book.title, book.author, 1)) ?? []
    if (best?.olid === olid && (editionOlid === null || editionOlid === best.editionOlid)) {
      editionOlid = best.editionOlid
      coverId = best.coverId
      books.updateBook(db, bookId, { editionOlid, isbn: best.isbn })
    }
  }

  if (coverId !== null && !book.coverPath) {
    const fileName = await cacheCover(bookId, coverId)
    if (fileName) books.updateBook(db, bookId, { coverPath: fileName })
  }

  return books.getBook(db, bookId)
}

function isOpenLibraryCover(book: Book): boolean {
  return new RegExp(`^book-${book.id}-[0-9]+\\.jpg$`, 'i').test(book.coverPath ?? '')
}

type RefreshOneResult =
  { kind: 'refreshed' } | { kind: 'offline' } | { kind: 'failed'; reason: string }

// Refreshes only the Open Library-owned part of a shelf row. The stored Work
// ID identifies the current book; this feature never searches by title to
// migrate or reinterpret older records.
async function refreshKnownBook(db: Database, book: Book): Promise<RefreshOneResult> {
  if (!book.olid) {
    return { kind: 'failed', reason: 'This book has no Open Library Work ID.' }
  }

  const matches = await searchWorkByOlid(book.olid)
  if (matches === null) return { kind: 'offline' }
  if (matches.length === 0) {
    return { kind: 'failed', reason: 'Open Library returned no result for this book.' }
  }
  const selected = matches[0]

  const work = await fetchWork(selected.olid)
  // Do not replace complete stored metadata with a partial Search API record
  // when the work endpoint failed midway through a bulk run.
  if (work === null) return { kind: 'offline' }
  const subjects = selected.subjects.length > 0 ? selected.subjects : work.subjects
  const description = work.description ?? selected.description

  let coverPath = book.coverPath
  const replaceableCover = coverPath === null || isOpenLibraryCover(book)
  if (replaceableCover && selected.coverId !== null) {
    // A failed download keeps the existing jacket so a temporary cover outage
    // cannot make the shelf worse.
    coverPath = (await cacheCover(book.id, selected.coverId)) ?? coverPath
  } else if (replaceableCover) {
    coverPath = null
  }

  db.transaction(() => {
    books.updateBook(db, book.id, {
      title: selected.title,
      author: selected.author,
      olid: selected.olid,
      editionOlid: selected.editionOlid,
      isbn: selected.isbn,
      pageCount: selected.pageCount,
      publishedYear: selected.publishedYear,
      coverPath
    })
    saveBookMetadata(db, book.id, { subjects, description, raw: work.raw })
  })()

  return { kind: 'refreshed' }
}

async function refreshBooksMetadata(
  db: Database,
  library: readonly Book[],
  onProgress?: (progress: MetadataRefreshProgress) => void,
  isCancelled: () => boolean = () => false
): Promise<MetadataRefreshResult> {
  const failures: MetadataRefreshFailure[] = []
  let refreshed = 0
  let processed = 0
  let offline = false

  for (const book of library) {
    if (isCancelled()) break
    onProgress?.({ done: processed, total: library.length, label: `Refreshing “${book.title}”` })

    const result = await refreshKnownBook(db, book)
    processed++
    if (result.kind === 'refreshed') {
      refreshed++
    } else {
      const reason = result.kind === 'offline' ? 'Open Library became unreachable.' : result.reason
      failures.push({ bookId: book.id, title: book.title, reason })
      if (result.kind === 'offline') {
        offline = true
        break
      }
    }
  }

  onProgress?.({
    done: processed,
    total: library.length,
    label: isCancelled() ? 'Stopping metadata refresh' : 'Metadata refresh complete'
  })

  return {
    refreshed,
    failures,
    cancelled: isCancelled(),
    offline
  }
}

export function refreshAllBookMetadata(
  db: Database,
  onProgress?: (progress: MetadataRefreshProgress) => void,
  isCancelled: () => boolean = () => false
): Promise<MetadataRefreshResult> {
  return refreshBooksMetadata(db, books.listBooks(db), onProgress, isCancelled)
}

export function retryBookMetadata(
  db: Database,
  bookIds: readonly number[],
  onProgress?: (progress: MetadataRefreshProgress) => void,
  isCancelled: () => boolean = () => false
): Promise<MetadataRefreshResult> {
  const wanted = new Set(bookIds.filter((id) => Number.isInteger(id) && id > 0))
  const selected = books.listBooks(db).filter((book) => wanted.has(book.id))
  return refreshBooksMetadata(db, selected, onProgress, isCancelled)
}

export async function refreshOneBookMetadata(db: Database, bookId: number): Promise<Book | null> {
  const book = books.getBook(db, bookId)
  if (!book) return null

  const result = await refreshBooksMetadata(db, [book])
  if (result.offline) throw new Error('Open Library did not answer. Try again later.')
  if (result.failures.length > 0) throw new Error(result.failures[0].reason)
  return books.getBook(db, bookId)
}
