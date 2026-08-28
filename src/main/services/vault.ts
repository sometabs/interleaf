import type { Database } from 'better-sqlite3'
import { copyFileSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'fs'
import { join } from 'path'

import type { Book, BookStatus, ExportResult, ImportResult, NoteKind } from '../../shared/api'
import * as books from '../repos/books'
import * as notes from '../repos/notes'

const VALID_STATUS: readonly string[] = ['want', 'reading', 'read', 'abandoned']
const VALID_KIND: readonly string[] = ['review', 'thought', 'highlight']

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

function fromIsoDate(value: string | null): number | null {
  if (!value) return null
  const ms = Date.parse(value)
  return Number.isNaN(ms) ? null : Math.floor(ms / 1000)
}

function yamlValue(value: string): string {
  return /^[\w .,'()&-]+$/.test(value) && !/^\s|\s$/.test(value) ? value : JSON.stringify(value)
}

export function buildFrontmatter(fields: Record<string, unknown>): string {
  const lines: string[] = ['---']
  for (const [key, value] of Object.entries(fields)) {
    if (value === null || value === undefined || value === '') continue
    if (Array.isArray(value)) {
      if (value.length === 0) continue
      lines.push(`${key}: [${value.map((v) => yamlValue(String(v))).join(', ')}]`)
    } else {
      lines.push(`${key}: ${yamlValue(String(value))}`)
    }
  }
  lines.push('---')
  return lines.join('\n')
}

export interface ParsedFile {
  frontmatter: Record<string, string | string[]>
  body: string
}

// A small YAML subset, which is all the export emits: guessing at anything
// richer makes a hand-edited file import unpredictably.
export function parseFrontmatter(text: string): ParsedFile {
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n')
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(normalized)
  if (!match) return { frontmatter: {}, body: normalized.trim() }

  const frontmatter: Record<string, string | string[]> = {}
  for (const line of match[1].split('\n')) {
    const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line)
    if (!kv) continue

    const key = kv[1]
    const raw = kv[2].trim()
    if (!raw) continue

    if (raw.startsWith('[') && raw.endsWith(']')) {
      frontmatter[key] = raw
        .slice(1, -1)
        .split(',')
        .map((s) => unquote(s.trim()))
        .filter(Boolean)
    } else {
      frontmatter[key] = unquote(raw)
    }
  }

  return { frontmatter, body: normalized.slice(match[0].length).trim() }
}

function unquote(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    try {
      return JSON.parse(value.replace(/^'|'$/g, '"'))
    } catch {
      return value.slice(1, -1)
    }
  }
  return value
}

function bookMarkdown(book: Book, bookNotes: ReturnType<typeof notes.listNotes>): string {
  const review = bookNotes.find((n) => n.kind === 'review')
  const others = bookNotes.filter((n) => n.kind !== 'review')

  const tags = [...new Set(bookNotes.map((n) => n.tag).filter((t): t is string => t !== null))]

  const parts = [
    buildFrontmatter({
      title: book.title,
      author: book.author,
      isbn: book.isbn,
      olid: book.olid,
      status: book.status,
      rating: book.rating,
      pages: book.pageCount,
      published: book.publishedYear,
      started: toIsoDate(book.startedAt),
      finished: toIsoDate(book.finishedAt),
      cover: book.coverPath,
      tags
    }),
    '',
    `# ${book.title}`,
    ''
  ]

  if (review) {
    parts.push('## Review', '', review.bodyMd.trim(), '')
  }

  for (const note of others) {
    const heading = note.kind === 'highlight' ? 'Highlight' : 'Note'
    parts.push(`## ${heading}: ${note.title || 'untitled'}`, '', note.bodyMd.trim(), '')
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
      buildFrontmatter({
        title: note.title,
        kind: note.kind,
        created: toIsoDate(note.createdAt),
        tags: note.tag ? [note.tag] : []
      }),
      '',
      note.bodyMd.trim()
    ].join('\n') + '\n'
  )
}

// Writing `books/` and `notes/` directly would leave two bare folders in
// Downloads and nothing for Import to be pointed at.
const VAULT_DIR = 'interleaf-vault'

export function exportVault(db: Database, parent: string, coversDir?: string): ExportResult {
  // Overwrites rather than piling up `-2`: a vault mirrors the library.
  const dir = join(parent, VAULT_DIR)
  const booksDir = join(dir, 'books')
  const notesDir = join(dir, 'notes')
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

  return { dir, files }
}

function listMarkdown(dir: string): string[] {
  try {
    if (!statSync(dir).isDirectory()) return []
  } catch {
    return []
  }
  return readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith('.md'))
    .map((f) => join(dir, f))
}

// The file may have been hand-edited and this name becomes a path, so the
// pattern is the whole guard: no slash, no backslash, no colon.
function safeCoverName(value: string | null): string | null {
  if (!value) return null
  return /^[\w.-]+\.(jpg|jpeg|png|webp)$/i.test(value) ? value : null
}

// Null draws the placeholder spine.
function restoreCover(name: string | null, vaultDir: string, coversDir?: string): string | null {
  const safe = safeCoverName(name)
  if (!safe || !coversDir) return null
  return copyCover(safe, join(vaultDir, 'covers'), coversDir) ? safe : null
}

function copyCover(name: string, fromDir: string, toDir: string): boolean {
  try {
    mkdirSync(toDir, { recursive: true })
    copyFileSync(join(fromDir, name), join(toDir, name))
    return true
  } catch {
    // The book still imports, without a jacket.
    return false
  }
}

function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

// Either half is enough: an export may write only one.
function looksLikeVault(dir: string): boolean {
  return isDir(join(dir, 'books')) || isDir(join(dir, 'notes'))
}

// The vault itself, either half of it, or the folder it was exported into.
// Only one level down, or a folder of unrelated Markdown imports as books.
export function resolveVaultRoot(dir: string): string | null {
  if (looksLikeVault(dir)) return dir

  const parent = join(dir, '..')
  if (looksLikeVault(parent) && /[/\\](books|notes)$/i.test(dir)) return parent

  // Several vaults side by side cannot be decided, so only one candidate counts.
  if (!isDir(dir)) return null
  const nested = readdirSync(dir)
    .map((name) => join(dir, name))
    .filter((path) => isDir(path) && looksLikeVault(path))

  return nested.length === 1 ? nested[0] : null
}

export function importVault(db: Database, picked: string, coversDir?: string): ImportResult {
  const dir = resolveVaultRoot(picked) ?? picked
  let importedBooks = 0
  let importedNotes = 0

  const run = db.transaction(() => {
    for (const file of listMarkdown(join(dir, 'books'))) {
      const { frontmatter, body } = parseFrontmatter(readFileSync(file, 'utf8'))
      const title = str(frontmatter.title)
      if (!title) continue

      const existing = db
        .prepare<[string], { id: number }>('SELECT id FROM book WHERE title = ? COLLATE NOCASE')
        .get(title)

      const fields = {
        author: str(frontmatter.author),
        isbn: str(frontmatter.isbn),
        olid: str(frontmatter.olid),
        status: asStatus(str(frontmatter.status)),
        rating: num(frontmatter.rating),
        pageCount: num(frontmatter.pages),
        publishedYear: num(frontmatter.published)
      }

      // `NewBook` has no date or cover fields, so passing these to
      // `createBook` would drop them silently.
      const afterCreate = {
        startedAt: fromIsoDate(str(frontmatter.started)),
        finishedAt: fromIsoDate(str(frontmatter.finished)),
        coverPath: restoreCover(str(frontmatter.cover), dir, coversDir)
      }

      let bookId: number
      if (existing) {
        bookId = books.updateBook(db, existing.id, { ...fields, ...afterCreate })?.id ?? existing.id
      } else {
        bookId = books.createBook(db, { title, ...fields }).id
        books.updateBook(db, bookId, afterCreate)
        importedBooks++
      }

      for (const section of splitSections(body)) {
        const isReview = /^review\b/i.test(section.heading)
        const kind: NoteKind = isReview
          ? 'review'
          : /^highlight/i.test(section.heading)
            ? 'highlight'
            : 'thought'
        if (!section.body.trim()) continue

        const already = db
          .prepare<[number, string], { id: number }>(
            'SELECT id FROM note WHERE book_id = ? AND kind = ? LIMIT 1'
          )
          .get(bookId, kind)

        if (already && kind === 'review') {
          notes.updateNote(db, already.id, { bodyMd: section.body })
        } else {
          notes.createNote(db, {
            bookId,
            kind,
            title: section.heading.replace(/^(review|highlight|note):?\s*/i, '').trim(),
            bodyMd: section.body
          })
          importedNotes++
        }
      }
    }

    for (const file of listMarkdown(join(dir, 'notes'))) {
      const { frontmatter, body } = parseFrontmatter(readFileSync(file, 'utf8'))
      if (!body.trim()) continue

      notes.createNote(db, {
        title: str(frontmatter.title) ?? undefined,
        kind: asKind(str(frontmatter.kind)),
        bodyMd: body
      })
      importedNotes++
    }
  })

  run()
  return { books: importedBooks, notes: importedNotes }
}

interface Section {
  heading: string
  body: string
}

function splitSections(body: string): Section[] {
  const sections: Section[] = []
  const lines = body.split('\n')
  let current: Section | null = null

  for (const line of lines) {
    const h2 = /^##\s+(.*)$/.exec(line)
    if (h2) {
      if (current) sections.push(current)
      current = { heading: h2[1].trim(), body: '' }
      continue
    }
    if (/^#\s+/.test(line) && !current) continue
    if (current) current.body += line + '\n'
  }

  if (current) sections.push(current)
  return sections.map((s) => ({ ...s, body: s.body.trim() }))
}

function str(value: string | string[] | undefined): string | null {
  if (typeof value === 'string') return value || null
  return null
}

function num(value: string | string[] | undefined): number | null {
  const s = str(value)
  if (s === null) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

function asStatus(value: string | null): BookStatus | undefined {
  return value && VALID_STATUS.includes(value) ? (value as BookStatus) : undefined
}

function asKind(value: string | null): NoteKind {
  return value && VALID_KIND.includes(value) ? (value as NoteKind) : 'thought'
}
