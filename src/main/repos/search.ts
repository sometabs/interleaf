import type { Database } from 'better-sqlite3'

import { HL_END, HL_START, type SearchHit } from '../../shared/api'

// `"`, `*`, `(` and bare `AND`/`NEAR` are FTS5 syntax and a stray one throws.
// Quoting neutralises them; the trailing `*` matches prefixes while typing.
export function toFtsQuery(input: string): string | null {
  const terms = input
    .trim()
    .split(/\s+/)
    .map((t) => t.replace(/["*^:()]/g, '').trim())
    .filter(Boolean)

  if (terms.length === 0) return null
  return terms.map((t) => `"${t}"*`).join(' ')
}

interface HitRow {
  id: number
  title: string
  subtitle: string | null
  snippet: string
  score: number
}

export function search(db: Database, query: string, limit = 30): SearchHit[] {
  const match = toFtsQuery(query)
  if (!match) return []

  // Column index -1 lets FTS5 pick whichever column actually matched.
  const noteRows = db
    .prepare<[string, string, string, number], HitRow>(
      `SELECT n.id                              AS id,
              n.title                           AS title,
              b.title                           AS subtitle,
              snippet(note_fts, -1, ?, ?, '…', 12) AS snippet,
              bm25(note_fts)                    AS score
       FROM note_fts
       JOIN note n ON n.id = note_fts.rowid
       LEFT JOIN book b ON b.id = n.book_id
       WHERE note_fts MATCH ?
       ORDER BY score
       LIMIT ?`
    )
    .all(HL_START, HL_END, match, limit)

  const bookRows = db
    .prepare<[string, string, string, number], HitRow>(
      `SELECT b.id                              AS id,
              b.title                           AS title,
              b.author                          AS subtitle,
              snippet(book_fts, -1, ?, ?, '…', 12) AS snippet,
              bm25(book_fts)                    AS score
       FROM book_fts
       JOIN book b ON b.id = book_fts.rowid
       WHERE book_fts MATCH ?
       ORDER BY score
       LIMIT ?`
    )
    .all(HL_START, HL_END, match, limit)

  // bm25 scores are negative, more negative being better. The nudge breaks ties
  // towards the book: searching a title usually means "take me to the book".
  const ranked = [
    ...bookRows.map((r) => ({ score: r.score - 0.5, hit: toHit('book', r) })),
    ...noteRows.map((r) => ({ score: r.score, hit: toHit('note', r) }))
  ]

  return ranked
    .sort((a, b) => a.score - b.score)
    .slice(0, limit)
    .map((r) => r.hit)
}

function toHit(kind: SearchHit['kind'], row: HitRow): SearchHit {
  return { kind, id: row.id, title: row.title, subtitle: row.subtitle, snippet: row.snippet }
}
