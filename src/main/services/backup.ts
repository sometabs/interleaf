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
import { basename, dirname, join } from 'path'

import { createDatabase, MIGRATIONS } from '../db/database'
import { writeVault } from './vault'

const BACKUP_DIR = 'interleaf-backup'
const DB_NAME = 'interleaf.db'
const COVERS_DIR = 'covers'

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

function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
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
  keep?: ReadonlySet<string>
): number {
  if (!fromDir || !isDir(fromDir)) return 0
  mkdirSync(toDir, { recursive: true })

  let copied = 0
  for (const name of readdirSync(fromDir)) {
    if (!safeCoverName(name)) continue
    if (keep && !keep.has(name)) continue
    try {
      copyFileSync(join(fromDir, name), join(toDir, name))
      copied++
    } catch {
      // One unreadable jacket is not worth failing a backup over.
    }
  }
  return copied
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
    // A snapshot, not a file copy: WAL keeps recent writes outside the .db.
    const target = join(pendingDir, DB_NAME)
    db.prepare('VACUUM INTO ?').run(target)
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

function assertRestorable(file: string): { books: number; notes: number } {
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

    return counts(db)
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

// The caller closes the live connection first: the file is replaced, not edited.
export function restoreBackup(
  sourceDir: string,
  dbPath: string,
  coversDir?: string
): RestoreResult {
  const root = resolveBackupRoot(sourceDir)
  if (!root) {
    throw new BackupError(`No ${DB_NAME} in that folder. Pick the folder a backup was written to.`)
  }

  const source = join(root, DB_NAME)
  assertRestorable(source)
  const pendingDir = mkdtempSync(join(dirname(dbPath), '.restore-'))
  try {
    const target = join(pendingDir, DB_NAME)
    // Capture WAL too if the chosen folder contains an uncheckpointed database.
    const sourceDb = readable(source)
    try {
      sourceDb.prepare('VACUUM INTO ?').run(target)
    } finally {
      sourceDb.close()
    }
    // Test upgrades on the staged copy, never on the installed library or backup.
    const staged = createDatabase(target)
    try {
      if (staged.pragma('quick_check', { simple: true }) !== 'ok') {
        throw new BackupError('That backup contains a damaged database.')
      }
    } finally {
      staged.close()
    }
    const found = assertRestorable(target)

    let replaced: string | null = null
    if (existsSync(dbPath)) {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-')
      replaced = `${dbPath}.${stamp}-${randomUUID()}.bak`
      copyFileSync(dbPath, replaced)
    }

    const covers = copyCovers(join(root, COVERS_DIR), coversDir ?? join(root, COVERS_DIR))
    // The caller has closed the live connection, so these are stale sidecars.
    for (const suffix of ['-wal', '-shm']) rmSync(`${dbPath}${suffix}`, { force: true })
    renameSync(target, dbPath)
    if (replaced) dropOlderCopies(dbPath, replaced)

    return { ...found, covers, replaced }
  } finally {
    rmSync(pendingDir, { recursive: true, force: true })
  }
}
