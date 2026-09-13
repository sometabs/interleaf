import type { Database } from 'better-sqlite3'

import type { Book, BookMetadata } from '../../shared/api'

export interface CandidateRow {
  olid: string
  editionOlid: string | null
  isbn: string | null
  title: string
  author: string | null
  subjects: string[]
  description: string | null
  coverId: number | null
  pageCount: number | null
  publishedYear: number | null
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
    `INSERT INTO book_candidate
       (olid, edition_olid, isbn, title, author, subjects, description, cover_id,
        page_count, published_year, source, languages, harvested_at)
     VALUES
       (@olid, @editionOlid, @isbn, @title, @author, @subjects, @description, @coverId,
        @pageCount, @publishedYear, @source, @languages, unixepoch())
     ON CONFLICT (olid) DO UPDATE SET
       edition_olid = excluded.edition_olid,
       isbn = excluded.isbn,
       title = excluded.title,
       author = excluded.author,
       subjects = excluded.subjects,
       description = excluded.description,
       cover_id = excluded.cover_id,
       page_count = excluded.page_count,
       published_year = excluded.published_year,
       languages = excluded.languages,
       source = excluded.source,
       harvested_at = unixepoch()`
  )
}

function writeCandidates(stmt: ReturnType<Database['prepare']>, items: CandidateRow[]): number {
  for (const c of items) {
    stmt.run({
      olid: c.olid,
      editionOlid: c.editionOlid,
      isbn: c.isbn,
      title: c.title,
      author: c.author,
      subjects: JSON.stringify(c.subjects),
      description: c.description,
      coverId: c.coverId,
      pageCount: c.pageCount,
      publishedYear: c.publishedYear,
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

const TITLE_FILLER = new Set(['a', 'an', 'and', 'for', 'in', 'of', 'on', 'or', 'the', 'to'])

function identityWords(value: string | null): string[] {
  return (
    (value ?? '')
      .normalize('NFKD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu) ?? []
  )
}

function sameAuthor(left: string | null, right: string | null): boolean {
  if (!left || !right) return false
  return identityWords(left).sort().join(' ') === identityWords(right).sort().join(' ')
}

// Open Library occasionally splits a work and a collection containing it into
// different Work IDs. Keep this deliberately narrow: a matching author, a
// whole-title containment, and at least two meaningful words in the shorter
// title. This avoids treating one-word series titles such as Dune as copies.
export function likelySameBook(
  left: { title: string; author: string | null },
  right: { title: string; author: string | null }
): boolean {
  if (!sameAuthor(left.author, right.author)) return false

  const leftTitle = identityWords(left.title).join(' ')
  const rightTitle = identityWords(right.title).join(' ')
  const shorter = leftTitle.length <= rightTitle.length ? leftTitle : rightTitle
  const longer = shorter === leftTitle ? rightTitle : leftTitle
  const meaningful = shorter.split(' ').filter((word) => word && !TITLE_FILLER.has(word))

  return meaningful.length >= 2 && ` ${longer} `.includes(` ${shorter} `)
}

// Excludes anything already in the library, by olid or by title, and anything
// the reader dismissed.
export function scorableCandidates(db: Database): CandidateRow[] {
  const excludedBooks = db
    .prepare<[], { title: string; author: string | null }>(
      `SELECT title, author FROM book
       UNION ALL
       SELECT title, author FROM rec_feedback
       WHERE action = 'dismissed' AND title IS NOT NULL`
    )
    .all()
  const candidates = db
    .prepare<
      [],
      {
        olid: string
        edition_olid: string | null
        isbn: string | null
        title: string
        author: string | null
        subjects: string | null
        description: string | null
        cover_id: number | null
        page_count: number | null
        published_year: number | null
        source: string | null
        languages: string | null
      }
    >(
      `WITH eligible AS (
         SELECT c.rowid AS candidate_order, c.* FROM book_candidate c
         WHERE c.olid NOT IN (SELECT olid FROM book WHERE olid IS NOT NULL)
           AND (
             c.edition_olid IS NULL
             OR c.edition_olid NOT IN (
               SELECT edition_olid FROM book WHERE edition_olid IS NOT NULL
             )
           )
           AND (
             c.isbn IS NULL
             OR c.isbn NOT IN (SELECT isbn FROM book WHERE isbn IS NOT NULL)
           )
           AND lower(trim(c.title)) NOT IN (SELECT lower(trim(title)) FROM book)
           AND NOT EXISTS (
             SELECT 1 FROM rec_feedback f
             WHERE f.action = 'dismissed'
               AND (
                 f.olid = c.olid
                 OR (
                   f.title IS NOT NULL
                   AND lower(trim(f.title)) = lower(trim(c.title))
                   AND (
                     f.author IS NULL OR c.author IS NULL
                     OR lower(trim(f.author)) = lower(trim(c.author))
                   )
                 )
               )
           )
       ), ranked AS (
         SELECT e.*,
                row_number() OVER (
                  PARTITION BY lower(trim(e.title)), lower(trim(coalesce(e.author, '')))
                  ORDER BY e.candidate_order
                ) AS duplicate_rank
         FROM eligible e
       )
       SELECT olid, edition_olid, isbn, title, author, subjects, description, cover_id,
              page_count, published_year, source, languages
       FROM ranked
       WHERE duplicate_rank = 1
       ORDER BY candidate_order`
    )
    .all()
    .map((r) => ({
      olid: r.olid,
      editionOlid: r.edition_olid,
      isbn: r.isbn,
      title: r.title,
      author: r.author,
      subjects: parseJsonArray(r.subjects),
      description: r.description,
      coverId: r.cover_id,
      pageCount: r.page_count,
      publishedYear: r.published_year,
      source: r.source,
      languages: parseJsonArray(r.languages)
    }))

  const distinct: CandidateRow[] = []
  for (const candidate of candidates) {
    if (excludedBooks.some((book) => likelySameBook(candidate, book))) continue
    if (distinct.some((book) => likelySameBook(candidate, book))) continue
    distinct.push(candidate)
  }
  return distinct
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
