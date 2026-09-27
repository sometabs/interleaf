import type { Database } from 'better-sqlite3'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

import type {
  HighlightBookPlan,
  HighlightImportLink,
  HighlightImportPlan,
  HighlightImportResult,
  HighlightImportSource
} from '../../shared/api'
import * as notes from '../repos/notes'
import { parseCollection, type CalibreAnnotation } from './calibre'
import { parseKindleClippings, type KindleHighlight } from './kindle'

interface SourceHighlight {
  sourceKey: string
  sourceTitle: string
  sourceAuthor: string | null
  externalId: string | null
  text: string
  note: string | null
  timestamp: string | undefined
  location: string | null
}

interface ParsedExport {
  source: HighlightImportSource
  highlights: SourceHighlight[]
}

const SAMPLES = 3

function calibreHighlight(annotation: CalibreAnnotation): SourceHighlight {
  return {
    sourceKey: String(annotation.book_id),
    sourceTitle: `Calibre book ${annotation.book_id}`,
    sourceAuthor: null,
    externalId: annotation.uuid,
    text: annotation.highlighted_text,
    note: annotation.notes ?? null,
    timestamp: annotation.timestamp,
    location: null
  }
}

function kindleHighlight(highlight: KindleHighlight): SourceHighlight {
  return {
    sourceKey: highlight.sourceBookKey,
    sourceTitle: highlight.title,
    sourceAuthor: highlight.author,
    externalId: null,
    text: highlight.text,
    note: null,
    timestamp: highlight.timestamp,
    location: highlight.location
  }
}

export function parseExport(raw: string): ParsedExport {
  const withoutBom = raw.replace(/^\uFEFF/, '').trimStart()
  if (withoutBom.startsWith('{')) {
    return { source: 'calibre', highlights: parseCollection(raw).map(calibreHighlight) }
  }
  return { source: 'kindle', highlights: parseKindleClippings(raw).map(kindleHighlight) }
}

function readExport(filePath: string): ParsedExport {
  let raw: string
  try {
    raw = readFileSync(filePath, 'utf8')
  } catch {
    throw new Error('That file could not be read.')
  }
  return parseExport(raw)
}

/** Reads the export without touching the library, so a plan cannot import. */
export function planImport(db: Database, filePath: string): HighlightImportPlan {
  const parsed = readExport(filePath)
  const linked = linkedBooks(db, parsed.source)
  const known = knownImportKeys(db, parsed.source)
  const byBook = new Map<string, HighlightBookPlan>()

  for (const highlight of parsed.highlights) {
    let plan = byBook.get(highlight.sourceKey)
    if (!plan) {
      plan = {
        sourceKey: highlight.sourceKey,
        sourceTitle: highlight.sourceTitle,
        sourceAuthor: highlight.sourceAuthor,
        bookId: linked.get(highlight.sourceKey) ?? null,
        newHighlights: 0,
        knownHighlights: 0,
        samples: []
      }
      byBook.set(highlight.sourceKey, plan)
    }

    const key = importKey(parsed.source, highlight, plan.bookId)
    if (key !== null && known.has(key)) plan.knownHighlights++
    else plan.newHighlights++
    if (plan.samples.length < SAMPLES) plan.samples.push(highlight.text.trim())
  }

  return { filePath, source: parsed.source, books: [...byBook.values()] }
}

export function runImport(
  db: Database,
  filePath: string,
  links: HighlightImportLink[]
): HighlightImportResult {
  const parsed = readExport(filePath)

  return db.transaction((): HighlightImportResult => {
    for (const link of links) rememberLink(db, parsed.source, link)

    const linked = linkedBooks(db, parsed.source)
    const seen = knownImportKeys(db, parsed.source)
    const touched = new Set<number>()
    let imported = 0
    let skipped = 0

    for (const highlight of parsed.highlights) {
      const bookId = linked.get(highlight.sourceKey)
      if (bookId === undefined) {
        skipped++
        continue
      }

      const key = importKey(parsed.source, highlight, bookId)
      if (key === null || seen.has(key)) {
        skipped++
        continue
      }

      const note = notes.createNote(db, {
        bookId,
        kind: 'highlight',
        bodyMd: toBody(highlight),
        createdAt: toUnix(highlight.timestamp)
      })
      db.prepare('UPDATE note SET import_source = ?, import_key = ? WHERE id = ?').run(
        parsed.source,
        key,
        note.id
      )

      seen.add(key)
      touched.add(bookId)
      imported++
    }

    return { imported, skipped, books: touched.size }
  })()
}

function normalized(value: string): string {
  return value.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase()
}

function importKey(
  source: HighlightImportSource,
  highlight: SourceHighlight,
  bookId: number | null
): string | null {
  if (source === 'calibre') return highlight.externalId
  if (bookId === null) return null

  return createHash('sha256')
    .update(
      `${bookId}\u0000${normalized(highlight.text)}\u0000${normalized(highlight.location ?? '')}`
    )
    .digest('hex')
}

// The passage stays a plain paragraph, exactly as a hand-typed quote is, so
// only the note supplied by Calibre carries a quotation marker.
function toBody(highlight: SourceHighlight): string {
  const passage = highlight.text.trim()
  const note = (highlight.note ?? '').trim()
  if (!note) return passage

  const quoted = note
    .split(/\r?\n/)
    .map((line) => `> ${line}`.trimEnd())
    .join('\n')
  return `${passage}\n\n${quoted}`
}

function toUnix(timestamp: string | undefined): number | undefined {
  const ms = timestamp ? Date.parse(timestamp) : NaN
  return Number.isNaN(ms) ? undefined : Math.floor(ms / 1000)
}

function linkedBooks(db: Database, source: HighlightImportSource): Map<string, number> {
  const rows = db
    .prepare<[HighlightImportSource], { source_key: string; book_id: number }>(
      'SELECT source_key, book_id FROM imported_book WHERE source = ?'
    )
    .all(source)
  return new Map(rows.map((row) => [row.source_key, row.book_id]))
}

function knownImportKeys(db: Database, source: HighlightImportSource): Set<string> {
  const rows = db
    .prepare<[HighlightImportSource], { import_key: string }>(
      'SELECT import_key FROM note WHERE import_source = ? AND import_key IS NOT NULL'
    )
    .all(source)
  return new Set(rows.map((row) => row.import_key))
}

function rememberLink(
  db: Database,
  source: HighlightImportSource,
  link: HighlightImportLink
): void {
  const exists = db
    .prepare<[number], { id: number }>('SELECT id FROM book WHERE id = ?')
    .get(link.bookId)
  if (!exists) throw new Error('That book is no longer in your library.')

  db.prepare(
    `INSERT INTO imported_book (source, source_key, book_id) VALUES (?, ?, ?)
     ON CONFLICT (source, source_key)
     DO UPDATE SET book_id = excluded.book_id, linked_at = unixepoch()`
  ).run(source, link.sourceKey, link.bookId)
}
