import type { Database } from 'better-sqlite3'
import { readFileSync } from 'node:fs'

import type {
  CalibreBookPlan,
  CalibreImportPlan,
  CalibreImportResult,
  CalibreLink
} from '../../shared/api'
import * as notes from '../repos/notes'

interface Annotation {
  book_id: number
  uuid: string
  type: string
  highlighted_text: string
  notes?: string
  timestamp?: string
}

const SAMPLES = 3

const NOT_AN_EXPORT =
  'That file is not a Calibre annotations export. In the Calibre viewer, ' +
  'use Highlights, then Export, and keep the calibre format.'

/** Reads the export without touching the library, so a plan cannot import. */
export function planImport(db: Database, filePath: string): CalibreImportPlan {
  const annotations = readAnnotations(filePath)
  const linked = linkedBooks(db)
  const known = knownUuids(db)

  const byBook = new Map<number, CalibreBookPlan>()

  for (const annotation of annotations) {
    let plan = byBook.get(annotation.book_id)
    if (!plan) {
      plan = {
        calibreId: annotation.book_id,
        bookId: linked.get(annotation.book_id) ?? null,
        newHighlights: 0,
        knownHighlights: 0,
        samples: []
      }
      byBook.set(annotation.book_id, plan)
    }

    if (known.has(annotation.uuid)) plan.knownHighlights++
    else plan.newHighlights++
    if (plan.samples.length < SAMPLES) plan.samples.push(annotation.highlighted_text.trim())
  }

  return { filePath, books: [...byBook.values()] }
}

export function runImport(
  db: Database,
  filePath: string,
  links: CalibreLink[]
): CalibreImportResult {
  const annotations = readAnnotations(filePath)

  const run = db.transaction((): CalibreImportResult => {
    for (const link of links) rememberLink(db, link)

    const linked = linkedBooks(db)
    const seen = knownUuids(db)
    const touched = new Set<number>()
    let imported = 0
    let skipped = 0

    for (const annotation of annotations) {
      const bookId = linked.get(annotation.book_id)
      if (bookId === undefined || seen.has(annotation.uuid)) {
        skipped++
        continue
      }

      const note = notes.createNote(db, {
        bookId,
        kind: 'highlight',
        bodyMd: toBody(annotation),
        createdAt: toUnix(annotation.timestamp)
      })
      db.prepare('UPDATE note SET calibre_uuid = ? WHERE id = ?').run(annotation.uuid, note.id)

      seen.add(annotation.uuid)
      touched.add(bookId)
      imported++
    }

    return { imported, skipped, books: touched.size }
  })

  return run()
}

function readAnnotations(filePath: string): Annotation[] {
  let raw: string
  try {
    raw = readFileSync(filePath, 'utf8')
  } catch {
    throw new Error('That file could not be read.')
  }
  return parseCollection(raw)
}

export function parseCollection(raw: string): Annotation[] {
  let parsed: unknown
  try {
    // Calibre writes a byte order mark, which JSON.parse rejects.
    parsed = JSON.parse(raw.replace(/^\uFEFF/, ''))
  } catch {
    throw new Error(NOT_AN_EXPORT)
  }

  const collection = parsed as { type?: unknown; annotations?: unknown }
  if (
    collection?.type !== 'calibre_annotation_collection' ||
    !Array.isArray(collection.annotations)
  )
    throw new Error(NOT_AN_EXPORT)

  return collection.annotations.filter(isImportable)
}

// Bookmarks and removed highlights ride along in the same array.
function isImportable(value: unknown): value is Annotation {
  const annotation = value as Annotation
  return (
    !!annotation &&
    annotation.type === 'highlight' &&
    typeof annotation.uuid === 'string' &&
    annotation.uuid !== '' &&
    Number.isInteger(annotation.book_id) &&
    typeof annotation.highlighted_text === 'string' &&
    annotation.highlighted_text.trim() !== ''
  )
}

// The passage stays a plain paragraph, exactly as a hand-typed quote is, so
// only the part you added carries a marker.
function toBody(annotation: Annotation): string {
  const passage = annotation.highlighted_text.trim()
  const note = (annotation.notes ?? '').trim()
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

function linkedBooks(db: Database): Map<number, number> {
  const rows = db
    .prepare<[], { calibre_id: number; book_id: number }>(
      'SELECT calibre_id, book_id FROM calibre_book'
    )
    .all()
  return new Map(rows.map((row) => [row.calibre_id, row.book_id]))
}

function knownUuids(db: Database): Set<string> {
  const rows = db
    .prepare<[], { calibre_uuid: string }>(
      'SELECT calibre_uuid FROM note WHERE calibre_uuid IS NOT NULL'
    )
    .all()
  return new Set(rows.map((row) => row.calibre_uuid))
}

function rememberLink(db: Database, link: CalibreLink): void {
  const exists = db
    .prepare<[number], { id: number }>('SELECT id FROM book WHERE id = ?')
    .get(link.bookId)
  if (!exists) throw new Error('That book is no longer in your library.')

  db.prepare(
    `INSERT INTO calibre_book (calibre_id, book_id) VALUES (?, ?)
     ON CONFLICT (calibre_id) DO UPDATE SET book_id = excluded.book_id, linked_at = unixepoch()`
  ).run(link.calibreId, link.bookId)
}
