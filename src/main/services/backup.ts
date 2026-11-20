import Database from 'better-sqlite3'
import { randomUUID } from 'crypto'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync
} from 'fs'
import { basename, dirname, join, resolve } from 'path'

import { createDatabase, MIGRATIONS } from '../db/database'
import { writeVault } from './vault'

const BACKUP_DIR = 'interleaf-backup'
const MARKDOWN_EXPORT_DIR = 'interleaf-markdown'
export const DB_NAME = 'interleaf.db'
const COVERS_DIR = 'covers'
const EPUB_DIR = 'books'
const SIDECARS = ['-wal', '-shm', '-journal']

// An AppImage runs from a temporary mount, and the path Electron would relaunch
// is gone by the time the replacement process reaches it.
export function relaunchOptions(appImage = process.env.APPIMAGE): { execPath: string } | undefined {
  return appImage ? { execPath: appImage } : undefined
}

export interface BackupResult {
  dir: string
  books: number
  notes: number
  covers: number
  epubs: number
}

export interface MarkdownExportResult {
  dir: string
  files: number
}

export interface RestoreResult {
  books: number
  notes: number
  covers: number
  replaced: string | null
}

export class BackupError extends Error {}
export class DatabaseIntegrityError extends BackupError {}

export function isDatabaseCorruption(err: unknown): boolean {
  const cause = err as (Error & { code?: string }) | null
  return (
    err instanceof DatabaseIntegrityError ||
    cause?.code === 'SQLITE_NOTADB' ||
    Boolean(cause?.code?.startsWith('SQLITE_CORRUPT')) ||
    (cause?.cause !== undefined && isDatabaseCorruption(cause.cause))
  )
}

function isDir(path: string, strict: boolean): boolean {
  try {
    return statSync(path).isDirectory()
  } catch (err) {
    if (strict && (err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    return false
  }
}

// Cover names become paths, so the pattern is the whole guard.
function safeCoverName(name: string): boolean {
  return /^[\w.-]+\.(jpg|jpeg|png|webp)$/i.test(name)
}

// `keep` is the set of jackets books point at. Without it a backup carries the
// whole Discover thumbnail cache, which is megabytes of other people's books.
function copyCovers(
  fromDir: string | undefined,
  toDir: string,
  keep?: ReadonlySet<string>,
  strict = false
): number {
  if (!fromDir || !isDir(fromDir, strict)) return 0
  mkdirSync(toDir, { recursive: true })
  const sameDirectory = resolve(fromDir) === resolve(toDir)

  let copied = 0
  for (const name of readdirSync(fromDir)) {
    if (!safeCoverName(name)) continue
    if (keep && !keep.has(name)) continue
    if (sameDirectory) {
      copied++
      continue
    }
    try {
      copyFileSync(join(fromDir, name), join(toDir, name))
      copied++
    } catch (err) {
      if (strict) throw err
      // One unreadable jacket is not worth failing a backup over.
    }
  }
  return copied
}

// Named by content hash, so a file already at the destination is the same file.
function copyEpubs(fromDir: string | undefined, toDir: string, keep: ReadonlySet<string>): number {
  if (!fromDir || !isDir(fromDir, false)) return 0
  if (resolve(fromDir) === resolve(toDir)) return keep.size
  let copied = 0
  for (const name of readdirSync(fromDir)) {
    if (!/^[0-9a-f]{64}\.epub$/.test(name) || !keep.has(name)) continue
    if (!existsSync(join(toDir, name))) {
      mkdirSync(toDir, { recursive: true })
      copyFileSync(join(fromDir, name), join(toDir, name))
    }
    copied++
  }
  return copied
}

function referencedEpubs(db: Database.Database): Set<string> {
  const rows = db.prepare<[], { sha256: string }>('SELECT sha256 FROM book_file').all()
  return new Set(rows.map((row) => `${row.sha256}.epub`))
}

export function writeDatabaseSnapshot(db: Database.Database, target: string): void {
  // Copy the committed WAL contents along with the main file.
  db.prepare('VACUUM INTO ?').run(target)
}

// EPUBs go into a `books` folder beside the snapshots, shared by all of them: the files
// never change, so three snapshots need not hold three copies.
export function writeRecoverySnapshot(
  db: Database.Database,
  dir: string,
  coversDir: string,
  epubDir?: string
): void {
  const target = join(dir, DB_NAME)
  writeDatabaseSnapshot(db, target)
  copyCovers(coversDir, join(dir, COVERS_DIR), referencedCovers(db), true)
  copyEpubs(epubDir, join(dirname(dir), EPUB_DIR), referencedEpubs(db))
  verifySnapshot(target)
}

export function sharedEpubDir(snapshotsRoot: string): string {
  return join(snapshotsRoot, EPUB_DIR)
}

export function epubNamesIn(snapshot: string): Set<string> {
  let db: Database.Database
  try {
    db = new Database(snapshot, { readonly: true, fileMustExist: true })
  } catch {
    return new Set()
  }
  try {
    return referencedEpubs(db)
  } catch {
    // Written before EPUBs existed.
    return new Set()
  } finally {
    db.close()
  }
}

function stamp(now: Date): string {
  const two = (n: number): string => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}-${two(now.getHours())}${two(now.getMinutes())}`
}

// A new folder every time, so an older backup is never overwritten.
function datedFolder(parent: string, prefix: string, now: Date): string {
  const base = join(parent, `${prefix}-${stamp(now)}`)
  let dir = base
  for (let n = 2; existsSync(dir); n++) dir = `${base}-${n}`
  mkdirSync(dir, { recursive: true })
  return dir
}

export function referencedCovers(db: Database.Database): Set<string> {
  const rows = db
    .prepare<[], { cover_path: string }>('SELECT cover_path FROM book WHERE cover_path IS NOT NULL')
    .all()
  return new Set(rows.map((row) => row.cover_path))
}

function counts(db: Database.Database): { books: number; notes: number } {
  const one = (sql: string): number => (db.prepare<[], { n: number }>(sql).get()?.n ?? 0) as number
  return {
    books: one('SELECT count(*) AS n FROM book'),
    notes: one('SELECT count(*) AS n FROM note')
  }
}

export function exportBackup(
  db: Database.Database,
  parent: string,
  coversDir?: string,
  epubDir?: string,
  now = new Date()
): BackupResult {
  let dir: string | null = null
  try {
    dir = datedFolder(parent, BACKUP_DIR, now)
    const pendingDir = mkdtempSync(join(dir, '.pending-'))
    try {
      const target = join(pendingDir, DB_NAME)
      writeDatabaseSnapshot(db, target)
      const covers = copyCovers(coversDir, join(dir, COVERS_DIR), referencedCovers(db))
      const epubs = copyEpubs(epubDir, join(dir, EPUB_DIR), referencedEpubs(db))
      // The database lands last, so a folder holding one is a finished backup.
      renameSync(target, join(dir, DB_NAME))
      return { dir, ...counts(db), covers, epubs }
    } finally {
      rmSync(pendingDir, { recursive: true, force: true })
    }
  } catch (err) {
    if (dir) rmSync(dir, { recursive: true, force: true })
    throw new BackupError(`The backup could not be written. ${(err as Error).message}`)
  }
}

export function exportMarkdown(
  db: Database.Database,
  parent: string,
  coversDir?: string,
  now = new Date()
): MarkdownExportResult {
  let dir: string | null = null
  try {
    dir = datedFolder(parent, MARKDOWN_EXPORT_DIR, now)
    return { dir, files: writeVault(db, dir, coversDir) }
  } catch (err) {
    if (dir) rmSync(dir, { recursive: true, force: true })
    throw new BackupError(`The Markdown export could not be written. ${(err as Error).message}`)
  }
}

// The backup folder, or the folder it was written into.
export function resolveBackupRoot(dir: string): string | null {
  if (existsSync(join(dir, DB_NAME))) return dir

  // Backups made before they were dated sat in one fixed folder.
  const nested = join(dir, BACKUP_DIR)
  if (existsSync(join(nested, DB_NAME))) return nested

  return null
}

function readable(file: string): Database.Database {
  try {
    return new Database(file, { readonly: true, fileMustExist: true })
  } catch {
    throw new BackupError('That file is not a readable Interleaf backup.')
  }
}

export function checkDatabaseIntegrity(db: Database.Database): void {
  if (db.pragma('quick_check', { simple: true }) !== 'ok') {
    throw new DatabaseIntegrityError('The database failed its integrity check.')
  }
}

export function verifySnapshot(file: string): {
  books: number
  notes: number
  revision: string | null
} {
  const db = readable(file)
  try {
    const version = db.pragma('user_version', { simple: true }) as number
    if (version > MIGRATIONS.length) {
      throw new BackupError(
        `That backup was written by a newer version of Interleaf (schema ${version}, ` +
          `this build understands ${MIGRATIONS.length}). Update Interleaf and try again.`
      )
    }

    const hasBooks = db
      .prepare<[], { name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'book'"
      )
      .get()
    if (!hasBooks) throw new BackupError('That file is not an Interleaf library.')

    checkDatabaseIntegrity(db)
    const revision =
      version >= 20
        ? db
            .prepare<[], { revision: string }>('SELECT revision FROM library_revision WHERE id = 1')
            .get()?.revision
        : null
    if (version >= 20 && revision === undefined)
      throw new BackupError('The library revision is missing.')
    return { ...counts(db), revision: revision ?? null }
  } finally {
    db.close()
  }
}

function dropOlderCopies(dbPath: string, keep: string): void {
  const dir = dirname(dbPath)
  const prefix = `${basename(dbPath)}.`

  for (const name of readdirSync(dir)) {
    if (!name.startsWith(prefix) || !name.endsWith('.bak')) continue
    const full = join(dir, name)
    if (full === keep) continue
    try {
      rmSync(full, { force: true })
    } catch {
      // A locked copy is not worth failing a finished restore over.
    }
  }
}

/** Moves a damaged database and its sidecars into a `damaged-library-*` folder beside it. */
export function setAsideDatabase(dbPath: string): string {
  const damagedDir = mkdtempSync(join(dirname(dbPath), 'damaged-library-'))
  const moved = join(damagedDir, basename(dbPath))
  for (const suffix of ['', ...SIDECARS]) {
    if (existsSync(dbPath + suffix)) renameSync(dbPath + suffix, moved + suffix)
  }
  return moved
}

interface RestoreOptions {
  /** Runs after validation, immediately before touching live files. Close the live connection here. */
  beforeReplace?: () => void
  preservePrevious?: boolean
  preserveDamaged?: boolean
  // Where EPUB files live. Only added to, so a failed restore leaves nothing to undo.
  epubDir?: string
}

// The live connection must be closed before publication.
export function restoreBackup(
  sourceDir: string,
  dbPath: string,
  coversDir?: string,
  options: RestoreOptions = {}
): RestoreResult {
  const root = resolveBackupRoot(sourceDir)
  if (!root) {
    throw new BackupError(
      `No ${DB_NAME} in that folder. Pick the backup folder itself, named like ${BACKUP_DIR}-2026-11-20-1430.`
    )
  }

  const source = join(root, DB_NAME)
  verifySnapshot(source)
  const pendingDir = mkdtempSync(join(dirname(dbPath), '.restore-'))
  let keepStaging = false
  try {
    const target = join(pendingDir, DB_NAME)
    // Capture WAL too if the chosen folder contains an uncheckpointed database.
    const sourceDb = readable(source)
    try {
      writeDatabaseSnapshot(sourceDb, target)
    } finally {
      sourceDb.close()
    }
    // Test upgrades on the staged copy, never on the installed library or backup.
    const staged = createDatabase(target)
    try {
      checkDatabaseIntegrity(staged)
    } finally {
      staged.close()
    }
    const { books, notes } = verifySnapshot(target)

    const snapshot = readable(target)
    const stagedCovers = join(pendingDir, COVERS_DIR)
    const destination = coversDir ?? join(root, COVERS_DIR)
    let covers: number
    try {
      covers = copyCovers(join(root, COVERS_DIR), stagedCovers, referencedCovers(snapshot), true)
      if (options.epubDir) {
        // A manual backup holds its own EPUBs; automatic snapshots share the folder beside them.
        const own = join(root, EPUB_DIR)
        const source = isDir(own, false) ? own : sharedEpubDir(dirname(root))
        copyEpubs(source, options.epubDir, referencedEpubs(snapshot))
      }
    } finally {
      snapshot.close()
    }

    options.beforeReplace?.()
    let replaced: string | null = null
    if (options.preserveDamaged && existsSync(dbPath)) {
      const damagedDir = mkdtempSync(join(dirname(dbPath), 'damaged-library-'))
      replaced = join(damagedDir, basename(dbPath))
      for (const suffix of ['', ...SIDECARS]) {
        if (existsSync(dbPath + suffix)) copyFileSync(dbPath + suffix, replaced + suffix)
      }
    } else if (options.preservePrevious !== false && existsSync(dbPath)) {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-')
      replaced = `${dbPath}.${stamp}-${randomUUID()}.bak`
      copyFileSync(dbPath, replaced)
    }

    // A damaged database can have a live WAL. Set it aside before publishing the
    // replacement and put it back if publication fails.
    const moved: string[] = []
    const installedCovers: { path: string; previous?: string }[] = []
    try {
      if (covers > 0 && resolve(destination) !== resolve(join(root, COVERS_DIR))) {
        mkdirSync(destination, { recursive: true })
        const previousDir = join(pendingDir, 'original-covers')
        mkdirSync(previousDir)
        for (const name of readdirSync(stagedCovers)) {
          const path = join(destination, name)
          const previous = existsSync(path) ? join(previousDir, name) : undefined
          if (previous) copyFileSync(path, previous)
          renameSync(join(stagedCovers, name), path)
          installedCovers.push({ path, previous })
        }
      }
      for (const suffix of SIDECARS) {
        if (!existsSync(dbPath + suffix)) continue
        renameSync(dbPath + suffix, join(pendingDir, 'original' + suffix))
        moved.push(suffix)
      }
      renameSync(target, dbPath)
    } catch (err) {
      try {
        for (const suffix of moved) {
          renameSync(join(pendingDir, 'original' + suffix), dbPath + suffix)
        }
        for (const { path, previous } of installedCovers) {
          if (previous) renameSync(previous, path)
          else rmSync(path, { force: true })
        }
      } catch (rollbackError) {
        keepStaging = true
        throw new BackupError(`Restore failed. The staged recovery files are in ${pendingDir}.`, {
          cause: new AggregateError([err, rollbackError])
        })
      }
      throw err
    }
    if (replaced && !options.preserveDamaged) dropOlderCopies(dbPath, replaced)

    return { books, notes, covers, replaced }
  } finally {
    if (!keepStaging) {
      try {
        rmSync(pendingDir, { recursive: true, force: true })
      } catch (err) {
        console.warn('Could not clean up staged restore files.', err)
      }
    }
  }
}
