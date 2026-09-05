import Database from 'better-sqlite3'
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'fs'
import { basename, dirname, join } from 'path'

import { MIGRATIONS } from '../db/database'
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

  const target = join(dir, DB_NAME)
  // VACUUM INTO refuses an existing file, and a backup replaces its predecessor.
  rmSync(target, { force: true })

  try {
    // A snapshot, not a file copy: WAL keeps recent writes outside the .db.
    db.prepare('VACUUM INTO ?').run(target)
  } catch (err) {
    throw new BackupError(`The backup could not be written. ${(err as Error).message}`)
  }

  const covers = copyCovers(coversDir, join(dir, COVERS_DIR), referencedCovers(db))
  const files = writeVault(db, dir, coversDir)
  return { dir, ...counts(db), covers, files }
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
  const found = assertRestorable(source)

  let replaced: string | null = null
  if (existsSync(dbPath)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    replaced = `${dbPath}.${stamp}.bak`
    copyFileSync(dbPath, replaced)
    // Only the newest is an undo. Older ones are copies of libraries that were
    // themselves already replaced, and they never stop accumulating.
    dropOlderCopies(dbPath, replaced)
  }

  // The sidecars belong to the database being replaced: left behind, SQLite
  // would replay them over the restored file.
  for (const suffix of ['-wal', '-shm']) rmSync(`${dbPath}${suffix}`, { force: true })
  copyFileSync(source, dbPath)

  const covers = copyCovers(join(root, COVERS_DIR), coversDir ?? join(root, COVERS_DIR))
  return { ...found, covers, replaced }
}
