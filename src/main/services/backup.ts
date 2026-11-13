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
export const DB_NAME = 'interleaf.db'
const COVERS_DIR = 'covers'
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
  // Markdown files, written for reading rather than for restoring.
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

export function writeDatabaseSnapshot(db: Database.Database, target: string): void {
  // Copy the committed WAL contents along with the main file.
  db.prepare('VACUUM INTO ?').run(target)
}

export function writeRecoverySnapshot(db: Database.Database, dir: string, coversDir: string): void {
  const target = join(dir, DB_NAME)
  writeDatabaseSnapshot(db, target)
  copyCovers(coversDir, join(dir, COVERS_DIR), referencedCovers(db), true)
  verifySnapshot(target)
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
  coversDir?: string
): BackupResult {
  const dir = join(parent, BACKUP_DIR)
  mkdirSync(dir, { recursive: true })

  const pendingDir = mkdtempSync(join(dir, '.pending-'))
  try {
    const target = join(pendingDir, DB_NAME)
    writeDatabaseSnapshot(db, target)
    const covers = copyCovers(coversDir, join(dir, COVERS_DIR), referencedCovers(db))
    const files = writeVault(db, dir, coversDir)
    const result = { dir, ...counts(db), covers, files }
    // Only replace the restorable database after the new export has finished.
    renameSync(target, join(dir, DB_NAME))
    return result
  } catch (err) {
    throw new BackupError(`The backup could not be written. ${(err as Error).message}`)
  } finally {
    rmSync(pendingDir, { recursive: true, force: true })
  }
}

// The backup folder, or the folder it was written into.
export function resolveBackupRoot(dir: string): string | null {
  if (existsSync(join(dir, DB_NAME))) return dir

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

interface RestoreOptions {
  /** Runs after validation, immediately before touching live files. Close the live connection here. */
  beforeReplace?: () => void
  preservePrevious?: boolean
  preserveDamaged?: boolean
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
    throw new BackupError(`No ${DB_NAME} in that folder. Pick the folder a backup was written to.`)
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
