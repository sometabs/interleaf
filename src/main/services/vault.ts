import type { Database } from 'better-sqlite3'
import { copyFileSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'

import type { Book } from '../../shared/api'
import * as books from '../repos/books'
import * as notes from '../repos/notes'

// The readable half of a backup, kept apart from the database a restore reads.
const MARKDOWN_DIR = 'markdown'

// Named for the reason they sit apart: these belong to no book.
const LOOSE_DIR = 'unlinked-notes'

export function slugify(text: string, fallback = 'untitled'): string {
  const slug = text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  return slug || fallback
}

function toIsoDate(unix: number | null): string | null {
  if (!unix) return null
  return new Date(unix * 1000).toISOString().slice(0, 10)
}

function yamlValue(value: string): string {
  return /^[\w .,'()&-]+$/.test(value) && !/^\s|\s$/.test(value) ? value : JSON.stringify(value)
}

export function buildFrontmatter(fields: Record<string, unknown>): string {
  const lines: string[] = ['---']
  for (const [key, value] of Object.entries(fields)) {
    if (value === null || value === undefined || value === '') continue
    lines.push(`${key}: ${yamlValue(String(value))}`)
  }
  lines.push('---')
  return lines.join('\n')
}

// When a passage was written down is part of a reading journal, not metadata.
function dateLine(createdAt: number): string[] {
  const date = toIsoDate(createdAt)
  return date ? [`*${date}*`, ''] : []
}

// The Markdown is read, never read back: the database beside it is what a
// restore uses, so this carries what a person wants to see and nothing else.
function bookMarkdown(book: Book, bookNotes: ReturnType<typeof notes.listNotes>): string {
  const review = bookNotes.find((n) => n.kind === 'review')
  const others = bookNotes.filter((n) => n.kind !== 'review')

  const parts = [
    buildFrontmatter({
      title: book.title,
      author: book.author,
      status: book.status,
      rating: book.rating
    }),
    '',
    `# ${book.title}`,
    ''
  ]

  const cover = safeCoverName(book.coverPath)
  // Out of `markdown/books/`, then out of `markdown/`, to the shared covers.
  if (cover) parts.push(`![](../../covers/${cover})`, '')

  if (review) {
    parts.push('## Review', '', ...dateLine(review.createdAt), review.bodyMd.trim(), '')
  }

  for (const note of others) {
    const heading = note.kind === 'highlight' ? 'Highlight' : 'Note'
    parts.push(
      `## ${heading}: ${note.title || 'untitled'}`,
      '',
      ...dateLine(note.createdAt),
      note.bodyMd.trim(),
      ''
    )
  }

  return (
    parts
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trimEnd() + '\n'
  )
}

function noteMarkdown(note: ReturnType<typeof notes.listNotes>[number]): string {
  return (
    [
      buildFrontmatter({ title: note.title, created: toIsoDate(note.createdAt) }),
      '',
      note.bodyMd.trim()
    ].join('\n') + '\n'
  )
}

// This name becomes a path, so the pattern is the whole guard: no slash, no
// backslash, no colon.
function safeCoverName(value: string | null): string | null {
  if (!value) return null
  return /^[\w.-]+\.(jpg|jpeg|png|webp)$/i.test(value) ? value : null
}

function copyCover(name: string, fromDir: string, toDir: string): void {
  try {
    mkdirSync(toDir, { recursive: true })
    copyFileSync(join(fromDir, name), join(toDir, name))
  } catch {
    // A page without its jacket still reads.
  }
}

// Writes into an existing directory rather than making its own, so it can sit
// alongside the database in a backup. Returns the number of files written.
export function writeVault(db: Database, dir: string, coversDir?: string): number {
  const booksDir = join(dir, MARKDOWN_DIR, 'books')
  const notesDir = join(dir, MARKDOWN_DIR, LOOSE_DIR)
  mkdirSync(booksDir, { recursive: true })
  mkdirSync(notesDir, { recursive: true })

  let files = 0
  const used = new Set<string>()

  const uniqueName = (base: string): string => {
    let name = base
    let n = 2
    while (used.has(name)) name = `${base}-${n++}`
    used.add(name)
    return name
  }

  for (const book of books.listBooks(db)) {
    const cover = safeCoverName(book.coverPath)
    if (cover && coversDir) copyCover(cover, coversDir, join(dir, 'covers'))

    const name = uniqueName(slugify(book.title))
    writeFileSync(
      join(booksDir, `${name}.md`),
      bookMarkdown(book, notes.listNotes(db, book.id)),
      'utf8'
    )
    files++
  }

  for (const note of notes.listNotes(db, null)) {
    const name = uniqueName(slugify(note.title || `note-${note.id}`))
    writeFileSync(join(notesDir, `${name}.md`), noteMarkdown(note), 'utf8')
    files++
  }

  return files
}
