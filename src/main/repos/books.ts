import type { Database } from 'better-sqlite3'

import type { Book, BookPatch, NewBook } from '../../shared/api'

/** Shape of a `book` row as SQLite hands it back. */
interface BookRow {
  id: number
  title: string
  author: string | null
  isbn: string | null
  edition_olid: string | null
  olid: string | null
  cover_path: string | null
  page_count: number | null
  published_year: number | null
  status: Book['status']
  rating: number | null
  started_at: number | null
  finished_at: number | null
  priority_position: number | null
  /** JSON array of genre names, or null when the reader has chosen none. */
  genres: string | null
  created_at: number
  updated_at: number
}

// Anything unreadable counts as no choice: a corrupt cell should cost a book
// its shelf label, not stop the library opening.
function parseGenres(value: string | null): string[] | null {
  if (value === null) return null
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.filter((g): g is string => typeof g === 'string') : null
  } catch {
    return null
  }
}

/** SQLite speaks snake_case; the API speaks camelCase. */
function toBook(row: BookRow): Book {
  return {
    id: row.id,
    title: row.title,
    author: row.author,
    isbn: row.isbn,
    editionOlid: row.edition_olid,
    olid: row.olid,
    coverPath: row.cover_path,
    pageCount: row.page_count,
    publishedYear: row.published_year,
    status: row.status,
    rating: row.rating,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    priorityPosition: row.priority_position,
    genres: parseGenres(row.genres),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

// Whitelist mapping patch fields to columns; never interpolate caller keys.
const BOOK_COLUMNS: Record<keyof BookPatch, string> = {
  title: 'title',
  author: 'author',
  isbn: 'isbn',
  editionOlid: 'edition_olid',
  olid: 'olid',
  coverPath: 'cover_path',
  pageCount: 'page_count',
  publishedYear: 'published_year',
  status: 'status',
  rating: 'rating',
  startedAt: 'started_at',
  finishedAt: 'finished_at',
  genres: 'genres'
}

export function listBooks(db: Database): Book[] {
  return db.prepare<[], BookRow>('SELECT * FROM book ORDER BY updated_at DESC').all().map(toBook)
}

export function getBook(db: Database, id: number): Book | null {
  const row = db.prepare<[number], BookRow>('SELECT * FROM book WHERE id = ?').get(id)
  return row ? toBook(row) : null
}

export function createBook(db: Database, input: NewBook): Book {
  const info = db
    .prepare(
      `INSERT INTO book
         (title, author, isbn, edition_olid, olid, page_count, published_year, status, rating,
          priority_position)
       VALUES
         (@title, @author, @isbn, @editionOlid, @olid, @pageCount, @publishedYear, @status, @rating,
          CASE WHEN @status = 'want'
            THEN (SELECT coalesce(max(priority_position), 0) + 1 FROM book WHERE status = 'want')
            ELSE NULL
          END)`
    )
    .run({
      title: input.title,
      author: input.author ?? null,
      isbn: input.isbn ?? null,
      editionOlid: input.editionOlid ?? null,
      olid: input.olid ?? null,
      pageCount: input.pageCount ?? null,
      publishedYear: input.publishedYear ?? null,
      status: input.status ?? 'want',
      rating: input.rating ?? null
    })

  const created = getBook(db, Number(info.lastInsertRowid))
  if (!created) throw new Error('Insert succeeded but the row could not be read back')
  return created
}

export function updateBook(db: Database, id: number, patch: BookPatch): Book | null {
  // `Object.hasOwn`, not `in`: the latter walks the prototype chain, so
  // `__proto__` would pass the whitelist. The patch comes from the renderer.
  const keys = (Object.keys(patch) as (keyof BookPatch)[]).filter(
    (k) => Object.hasOwn(BOOK_COLUMNS, k) && patch[k] !== undefined
  )

  if (keys.length > 0) {
    const assignments = keys.map((k) => `${BOOK_COLUMNS[k]} = @${k}`)
    // Want to read is the queue: entering appends the book, and leaving removes it.
    if (patch.status === 'want') {
      assignments.push(
        `priority_position = CASE WHEN priority_position IS NULL
          THEN (SELECT coalesce(max(priority_position), 0) + 1 FROM book WHERE status = 'want')
          ELSE priority_position
        END`
      )
    } else if (patch.status !== undefined) {
      assignments.push('priority_position = NULL')
    }
    const params: Record<string, unknown> = { id }
    for (const k of keys) {
      // The only column that is not a SQLite scalar. Null stays null, so
      // "chose nothing" and "chose an empty list" remain distinct.
      params[k] =
        k === 'genres' ? (patch.genres === null ? null : JSON.stringify(patch.genres)) : patch[k]
    }

    db.prepare(
      `UPDATE book SET ${assignments.join(', ')}, updated_at = unixepoch() WHERE id = @id`
    ).run(params)
  }

  return getBook(db, id)
}

export function reorderPriority(db: Database, bookIds: readonly number[]): void {
  const ids = bookIds.filter((id) => Number.isInteger(id) && id > 0)
  if (ids.length !== bookIds.length || new Set(ids).size !== ids.length) {
    throw new Error('Priority order contains invalid or repeated books.')
  }

  const current = db
    .prepare<[], { id: number }>(
      `SELECT id FROM book
       WHERE status = 'want'
       ORDER BY priority_position, id`
    )
    .all()
    .map((row) => row.id)
  if (current.length !== ids.length || current.some((id) => !ids.includes(id))) {
    throw new Error('Priority list changed before it could be reordered.')
  }

  const update = db.prepare(
    `UPDATE book SET priority_position = ?
     WHERE id = ? AND status = 'want'`
  )
  db.transaction((ordered: readonly number[]) => {
    ordered.forEach((id, index) => update.run(index + 1, id))
  })(ids)
}

export function deleteBook(db: Database, id: number): void {
  db.prepare('DELETE FROM book WHERE id = ?').run(id)
}
