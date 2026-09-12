import type { Database } from 'better-sqlite3'

import type { Book, BookMetadata, BookSubjects } from '../../shared/api'

export interface CandidateRow {
  olid: string
  title: string
  author: string | null
  subjects: string[]
  description: string | null
  coverId: number | null
  source: string | null
  // Empty when the harvest that found it reported none.
  languages: string[]
}

export function saveBookMetadata(
  db: Database,
  bookId: number,
  data: { subjects: string[]; description: string | null; raw?: unknown }
): void {
  db.prepare(
    `INSERT INTO book_metadata (book_id, subjects, description, raw_json, fetched_at)
     VALUES (@bookId, @subjects, @description, @raw, unixepoch())
     ON CONFLICT (book_id) DO UPDATE SET
       subjects = excluded.subjects,
       description = excluded.description,
       raw_json = excluded.raw_json,
       fetched_at = excluded.fetched_at`
  ).run({
    bookId,
    subjects: JSON.stringify(data.subjects),
    description: data.description,
    raw: data.raw ? JSON.stringify(data.raw) : null
  })
}

export function getBookMetadata(db: Database, bookId: number): BookMetadata | null {
  const row = db
    .prepare<[number], { subjects: string | null; description: string | null; fetched_at: number }>(
      'SELECT subjects, description, fetched_at FROM book_metadata WHERE book_id = ?'
    )
    .get(bookId)

  if (!row) return null
  return {
    subjects: parseJsonArray(row.subjects),
    description: row.description,
    fetchedAt: row.fetched_at
  }
}

// Narrower than `booksWithMetadata`: the grid needs no descriptions, which are
// the largest column here.
export function listBookSubjects(db: Database): BookSubjects[] {
  return db
    .prepare<[], { book_id: number; subjects: string | null }>(
      'SELECT book_id, subjects FROM book_metadata'
    )
    .all()
    .map((row) => ({ bookId: row.book_id, subjects: parseJsonArray(row.subjects) }))
    .filter((row) => row.subjects.length > 0)
}

// The input to the taste profile.
export function booksWithMetadata(db: Database): {
  bookId: number
  title: string
  author: string | null
  status: Book['status']
  rating: number | null
  subjects: string[]
  description: string | null
  finishedAt: number | null
}[] {
  return db
    .prepare<
      [],
      {
        book_id: number
        title: string
        author: string | null
        status: Book['status']
        rating: number | null
        subjects: string | null
        description: string | null
        finished_at: number | null
      }
    >(
      `SELECT b.id AS book_id, b.title, b.author, b.status, b.rating, b.finished_at,
              m.subjects, m.description
       FROM book b
       JOIN book_metadata m ON m.book_id = b.id`
    )
    .all()
    .map((r) => ({
      bookId: r.book_id,
      title: r.title,
      author: r.author,
      status: r.status,
      rating: r.rating,
      finishedAt: r.finished_at,
      subjects: parseJsonArray(r.subjects),
      description: r.description
    }))
}

function candidateUpsert(db: Database): ReturnType<Database['prepare']> {
  return db.prepare(
    `INSERT INTO book_candidate (olid, title, author, subjects, description, cover_id, source, languages, harvested_at)
     VALUES (@olid, @title, @author, @subjects, @description, @coverId, @source, @languages, unixepoch())
     ON CONFLICT (olid) DO UPDATE SET
       subjects = excluded.subjects,
       description = coalesce(excluded.description, book_candidate.description),
       -- coalesce, not overwrite: the same book arrives from several queries and
       -- only some carry an author. A later harvest fills gaps, never blanks.
       author = coalesce(excluded.author, book_candidate.author),
       -- The title is the exception. Two harvests can legitimately disagree,
       -- since the edition Open Library nests is the one that matched *that*
       -- query, so last write wins, because it is the one that can heal a row
       -- stuck on an original-language title.
       title = excluded.title,
       -- The cover moves with the title, even to null: title and jacket come off
       -- the same object, and coalescing here would pair a new name with an old
       -- cover. Gap-filling applies only while the title is unchanged.
       cover_id = CASE
         WHEN excluded.title <> book_candidate.title THEN excluded.cover_id
         ELSE coalesce(excluded.cover_id, book_candidate.cover_id)
       END,
       -- Gap-filling again, but an empty list must be nulled first: a subject
       -- harvest reports no languages, and letting that win would erase what a
       -- search harvest already established.
       languages = coalesce(nullif(excluded.languages, '[]'), book_candidate.languages),
       source = excluded.source,
       harvested_at = unixepoch()`
  )
}

function writeCandidates(stmt: ReturnType<Database['prepare']>, items: CandidateRow[]): number {
  for (const c of items) {
    stmt.run({
      olid: c.olid,
      title: c.title,
      author: c.author,
      subjects: JSON.stringify(c.subjects),
      description: c.description,
      coverId: c.coverId,
      source: c.source,
      languages: JSON.stringify(c.languages)
    })
  }
  return items.length
}

export function upsertCandidates(db: Database, rows: CandidateRow[]): number {
  const stmt = candidateUpsert(db)
  const run = db.transaction((items: CandidateRow[]) => writeCandidates(stmt, items))

  return run(rows)
}

// A fully successful harvest describes the current taste, so stale candidates
// from older shelves and broader query strategies should not linger forever.
export function replaceCandidates(db: Database, rows: CandidateRow[]): number {
  const stmt = candidateUpsert(db)
  const run = db.transaction((items: CandidateRow[]) => {
    db.prepare('DELETE FROM book_candidate').run()
    return writeCandidates(stmt, items)
  })

  return run(rows)
}

// Excludes anything already in the library, by olid or by title, and anything
// the reader dismissed.
export function scorableCandidates(db: Database): CandidateRow[] {
  return db
    .prepare<
      [],
      {
        olid: string
        title: string
        author: string | null
        subjects: string | null
        description: string | null
        cover_id: number | null
        source: string | null
        languages: string | null
      }
    >(
      `SELECT c.* FROM book_candidate c
       WHERE c.olid NOT IN (SELECT olid FROM book WHERE olid IS NOT NULL)
         AND lower(c.title) NOT IN (SELECT lower(title) FROM book)
         AND c.olid NOT IN (SELECT olid FROM rec_feedback WHERE action = 'dismissed')`
    )
    .all()
    .map((r) => ({
      olid: r.olid,
      title: r.title,
      author: r.author,
      subjects: parseJsonArray(r.subjects),
      description: r.description,
      coverId: r.cover_id,
      source: r.source,
      languages: parseJsonArray(r.languages)
    }))
}

export function getCandidate(db: Database, olid: string): CandidateRow | null {
  const all = scorableCandidates(db)
  return all.find((c) => c.olid === olid) ?? null
}

// The name is copied onto the row because a refusal has to outlive the
// candidate pool, which any harvest can empty.
export function recordFeedback(db: Database, olid: string, action: 'dismissed' | 'saved'): void {
  const candidate = db
    .prepare<[string], { title: string; author: string | null }>(
      'SELECT title, author FROM book_candidate WHERE olid = ?'
    )
    .get(olid)

  db.prepare(
    `INSERT INTO rec_feedback (olid, action, title, author) VALUES (?, ?, ?, ?)
     ON CONFLICT (olid, action) DO UPDATE SET
       at = unixepoch(),
       -- coalesce so dismissing a book whose candidate is gone does not blank
       -- the name already captured.
       title = coalesce(excluded.title, rec_feedback.title),
       author = coalesce(excluded.author, rec_feedback.author)`
  ).run(olid, action, candidate?.title ?? null, candidate?.author ?? null)
}

export interface DismissedBook {
  olid: string
  // Null for a refusal made before the name was recorded.
  title: string | null
  author: string | null
  at: number
}

export function dismissedBooks(db: Database): DismissedBook[] {
  return db
    .prepare<[], DismissedBook>(
      `SELECT olid, title, author, at FROM rec_feedback
       WHERE action = 'dismissed'
       ORDER BY at DESC`
    )
    .all()
}

export function undismiss(db: Database, olid: string): void {
  db.prepare("DELETE FROM rec_feedback WHERE olid = ? AND action = 'dismissed'").run(olid)
}

function parseJsonArray(raw: string | null): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === 'string') : []
  } catch {
    return []
  }
}
