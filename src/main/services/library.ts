import type { Database } from 'better-sqlite3'

import type {
  Book,
  MetadataRefreshFailure,
  MetadataRefreshProgress,
  MetadataRefreshResult,
  OlBookDto
} from '../../shared/api'
import * as books from '../repos/books'
import { getBookMetadata, saveBookMetadata } from '../repos/metadata'
import { cacheCover } from './covers'
import { fetchWork, searchWorkByOlid } from './openlibrary'

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

  const enriched = await enrichSelectedBook(
    db,
    created.id,
    dto.coverId,
    dto.subjects ?? [],
    dto.description ?? null
  )
  return enriched ?? created
}

// Enrichment may add work metadata and cache the selected cover, but it never
// searches again or changes the result the reader chose.
async function enrichSelectedBook(
  db: Database,
  bookId: number,
  knownCoverId: number | null = null,
  knownSubjects: readonly string[] = [],
  knownDescription: string | null = null
): Promise<Book | null> {
  const book = books.getBook(db, bookId)
  if (!book) return null

  const workResult = book.olid ? await fetchWork(book.olid) : null
  const work = workResult?.kind === 'ok' ? workResult.work : null
  const subjects = knownSubjects.length > 0 ? [...knownSubjects] : (work?.subjects ?? [])
  const description = work?.description ?? knownDescription
  if (work || subjects.length > 0 || description) {
    saveBookMetadata(db, bookId, {
      subjects,
      description,
      raw: work?.raw
    })
  }

  if (knownCoverId !== null && !book.coverPath) {
    const fileName = await cacheCover(bookId, knownCoverId)
    if (fileName) books.updateBook(db, bookId, { coverPath: fileName })
  }

  return books.getBook(db, bookId)
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
  const refreshedWork = matches.find(
    (match) => match.olid.toUpperCase() === book.olid?.toUpperCase()
  )
  if (!refreshedWork) {
    return { kind: 'failed', reason: 'Open Library returned no result for this book.' }
  }

  const workResult = await fetchWork(book.olid)
  // Do not replace complete stored metadata with a partial Search API record
  // when the work endpoint failed midway through a bulk run.
  if (workResult.kind === 'unavailable') return { kind: 'offline' }
  if (workResult.kind === 'missing') {
    return { kind: 'failed', reason: 'Open Library no longer has this Work ID.' }
  }
  const work = workResult.work
  const existingMetadata = getBookMetadata(db, book.id)
  const subjects =
    refreshedWork.subjects.length > 0
      ? refreshedWork.subjects
      : work.subjects.length > 0
        ? work.subjects
        : (existingMetadata?.subjects ?? [])
  const description =
    work.description ?? refreshedWork.description ?? existingMetadata?.description ?? null

  db.transaction(() => {
    books.updateBook(db, book.id, {
      pageCount: book.pageCount ?? refreshedWork.pageCount,
      publishedYear: book.publishedYear ?? refreshedWork.publishedYear
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
