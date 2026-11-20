import type { Database } from 'better-sqlite3'
import { app } from 'electron'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'fs'
import { basename, extname, join } from 'path'

import type { AttachEpubResult, EpubCandidate } from '../../shared/api'
import * as files from '../repos/bookFiles'
import { EpubError, inspectEpub, NOT_AN_EPUB } from './epub'

// Larger than any real novel, small enough to hash in memory without trouble.
const MAX_EPUB_BYTES = 300 * 1024 * 1024

export function epubDir(): string {
  const dir = join(app.getPath('userData'), 'books')
  mkdirSync(dir, { recursive: true })
  return dir
}

function readEpubFile(path: string): Uint8Array {
  if (extname(path).toLowerCase() !== '.epub') throw new EpubError(NOT_AN_EPUB)
  let size: number
  try {
    size = statSync(path).size
  } catch {
    throw new Error('That file could not be found.')
  }
  if (size === 0 || size > MAX_EPUB_BYTES) throw new EpubError(NOT_AN_EPUB)
  return readFileSync(path)
}

export async function describeEpub(db: Database, path: string): Promise<EpubCandidate> {
  const details = await inspectEpub(readEpubFile(path))
  return {
    path,
    fileName: basename(path),
    title: details.title,
    author: details.author,
    isbn: details.isbn,
    bookId: files.bookHoldingFile(db, details.sha256)
  }
}

export async function attachEpub(
  db: Database,
  dir: string,
  bookId: number,
  path: string,
  replace: boolean
): Promise<AttachEpubResult> {
  const bytes = readEpubFile(path)
  const { sha256 } = await inspectEpub(bytes)

  const holder = files.bookHoldingFile(db, sha256)
  if (holder === bookId) return { kind: 'already-attached' }
  if (holder !== null) return { kind: 'held-by', bookId: holder }
  const previous = files.bookFileHash(db, bookId)
  if (previous && !replace) return { kind: 'replace-needed' }

  const stored = join(dir, `${sha256}.epub`)
  if (!existsSync(stored)) writeFileSync(stored, bytes)
  files.setBookFile(db, bookId, { sha256, fileName: basename(path), size: bytes.length })
  if (previous) removeUnusedEpub(db, dir, previous)
  return { kind: 'attached' }
}

export function detachEpub(db: Database, dir: string, bookId: number): void {
  const previous = files.bookFileHash(db, bookId)
  files.removeBookFile(db, bookId)
  if (previous) removeUnusedEpub(db, dir, previous)
}

export function readStoredEpub(db: Database, dir: string, bookId: number): Uint8Array {
  const sha256 = files.bookFileHash(db, bookId)
  if (!sha256) throw new Error('This book has no EPUB attached.')
  try {
    return readFileSync(join(dir, `${sha256}.epub`))
  } catch {
    throw new Error('The EPUB file for this book is missing. Attach it again.')
  }
}

function removeUnusedEpub(db: Database, dir: string, sha256: string): void {
  if (files.bookHoldingFile(db, sha256) !== null) return
  rmSync(join(dir, `${sha256}.epub`), { force: true })
}

export function pruneOrphanEpubs(dir: string, keep: ReadonlySet<string>): number {
  let removed = 0
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.epub') || keep.has(name)) continue
    try {
      rmSync(join(dir, name), { force: true })
      removed++
    } catch {
      // A locked file is not worth failing a launch over.
    }
  }
  return removed
}
