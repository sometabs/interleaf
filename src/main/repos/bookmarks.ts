import type { Database } from 'better-sqlite3'

import type { Bookmark, NewBookmark } from '../../shared/api'

interface BookmarkRow {
  id: number
  book_id: number
  cfi: string
  excerpt: string
  chapter: string | null
  created_at: number
}

const toBookmark = (row: BookmarkRow): Bookmark => ({
  id: row.id,
  bookId: row.book_id,
  cfi: row.cfi,
  excerpt: row.excerpt,
  chapter: row.chapter,
  createdAt: row.created_at
})

const MAX_TEXT = 200

function clip(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT) : ''
}

export function listBookmarks(db: Database, bookId: number): Bookmark[] {
  return db
    .prepare<[number], BookmarkRow>('SELECT * FROM bookmark WHERE book_id = ? ORDER BY id')
    .all(bookId)
    .map(toBookmark)
}

// Marking the same place twice keeps the first bookmark rather than failing.
export function addBookmark(db: Database, bookId: number, input: NewBookmark): Bookmark {
  if (typeof input?.cfi !== 'string' || !input.cfi.startsWith('epubcfi(')) {
    throw new Error('Invalid bookmark.')
  }
  db.prepare(
    `INSERT INTO bookmark (book_id, cfi, excerpt, chapter) VALUES (?, ?, ?, ?)
      ON CONFLICT (book_id, cfi) DO NOTHING`
  ).run(bookId, input.cfi, clip(input.excerpt), clip(input.chapter) || null)
  return toBookmark(
    db
      .prepare<[number, string], BookmarkRow>(
        'SELECT * FROM bookmark WHERE book_id = ? AND cfi = ?'
      )
      .get(bookId, input.cfi)!
  )
}

export function removeBookmark(db: Database, id: number): void {
  db.prepare('DELETE FROM bookmark WHERE id = ?').run(id)
}
