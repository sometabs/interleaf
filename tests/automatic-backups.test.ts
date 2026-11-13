import type { Database } from 'better-sqlite3'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createDatabase } from '../src/main/db/database'
import { createBook, listBooks, updateBook } from '../src/main/repos/books'
import { createNote, listNotes } from '../src/main/repos/notes'
import {
  AutomaticBackups,
  BACKUP_INTERVAL,
  latestRecoverySnapshot
} from '../src/main/services/automaticBackups'
import { DB_NAME, restoreBackup, verifySnapshot } from '../src/main/services/backup'

vi.mock('fs', async (importOriginal) => {
  const fs = await importOriginal<typeof import('fs')>()
  return { ...fs, renameSync: vi.fn(fs.renameSync) }
})

let directory: string
let root: string
let covers: string
let db: Database
let backups: AutomaticBackups

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-13T12:00:00Z'))
  directory = mkdtempSync(join(tmpdir(), 'interleaf-auto-backup-'))
  root = join(directory, 'backups')
  covers = join(directory, 'covers')
  mkdirSync(covers)
  db = createDatabase(join(directory, DB_NAME))
  backups = new AutomaticBackups(root, covers)
  backups.start(db)
})

afterEach(() => {
  backups.stop()
  if (db.open) db.close()
  rmSync(directory, { recursive: true, force: true })
  vi.useRealTimers()
  vi.restoreAllMocks()
})

function save(title: string): void {
  createBook(db, { title })
  backups.schedule()
  vi.advanceTimersByTime(1)
}

function snapshotDirectories(): string[] {
  return existsSync(root) ? readdirSync(root) : []
}

function bookCount(): number | null {
  const snapshot = latestRecoverySnapshot(root)
  return snapshot ? verifySnapshot(join(snapshot.dir, DB_NAME)).books : null
}

describe('automatic backups', () => {
  it('skips idle time, saves the first edit, and groups further edits until the deadline', () => {
    vi.advanceTimersByTime(2 * BACKUP_INTERVAL)
    expect(snapshotDirectories()).toEqual([])
    save('First')
    save('Second')
    save('Third')
    expect(bookCount()).toBe(1)
    vi.advanceTimersByTime(BACKUP_INTERVAL - 3)
    expect(bookCount()).toBe(3)
    expect(snapshotDirectories()).toHaveLength(1)
    vi.advanceTimersByTime(2 * BACKUP_INTERVAL)
    expect(bookCount()).toBe(3)
  })

  it('catches up at launch after an overdue change, even without a timer or quit handler', () => {
    save('First')
    // Simulate a committed write immediately before a process crash.
    createBook(db, { title: 'Saved before closing' })
    backups.stop()
    db.close()
    vi.advanceTimersByTime(BACKUP_INTERVAL + 1)
    db = createDatabase(join(directory, DB_NAME))
    backups = new AutomaticBackups(root, covers)
    backups.start(db)
    vi.advanceTimersByTime(1)
    expect(bookCount()).toBe(2)
    expect(snapshotDirectories()).toHaveLength(1)
  })

  it('ignores rolled-back writes and recommendation cache changes', () => {
    db.exec('BEGIN')
    createBook(db, { title: 'Rolled back' })
    db.exec('ROLLBACK')
    db.prepare("INSERT INTO book_candidate (olid, title) VALUES ('OL1W', 'Candidate')").run()
    backups.schedule()
    vi.advanceTimersByTime(2 * BACKUP_INTERVAL)
    expect(snapshotDirectories()).toEqual([])
  })

  it('includes WAL changes and referenced covers, with no Markdown export', () => {
    const book = createBook(db, { title: 'Solaris', author: 'Stanisław Lem' })
    updateBook(db, book.id, { coverPath: 'book-1.jpg', rating: 5 })
    createNote(db, { bookId: book.id, kind: 'highlight', bodyMd: 'A line worth keeping.' })
    writeFileSync(join(covers, 'book-1.jpg'), 'cover bytes')
    writeFileSync(join(covers, 'cover-44.jpg'), 'cached recommendation')
    backups.schedule()
    vi.advanceTimersByTime(1)
    const snapshot = latestRecoverySnapshot(root)!.dir
    expect(readdirSync(snapshot).sort()).toEqual(['.verified', 'covers', DB_NAME].sort())
    expect(readdirSync(join(snapshot, 'covers'))).toEqual(['book-1.jpg'])
    const copy = createDatabase(join(snapshot, DB_NAME))
    try {
      expect(listBooks(copy)[0]).toMatchObject({ title: 'Solaris', rating: 5 })
      expect(listNotes(copy, book.id)[0].bodyMd).toBe('A line worth keeping.')
    } finally {
      copy.close()
    }
  })

  it('keeps the current copy when publication fails and retries the pending write', () => {
    save('First')
    createBook(db, { title: 'Second' })
    const previous = snapshotDirectories()
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.mocked(renameSync).mockImplementationOnce(() => {
      throw new Error('Disk unavailable')
    })
    createBook(db, { title: 'Third' })
    backups.schedule()
    vi.advanceTimersByTime(BACKUP_INTERVAL + 1)
    expect(snapshotDirectories()).toEqual(previous)
    expect(bookCount()).toBe(1)
    expect(warning).toHaveBeenCalled()
    vi.advanceTimersByTime(5 * 60 * 1000)
    expect(bookCount()).toBe(3)
    expect(snapshotDirectories()).toHaveLength(1)
  })

  it('skips a damaged snapshot and preserves the damaged live database and sidecars during recovery', () => {
    save('First')
    const bad = join(root, 'snapshot-1794571200001-00000000-0000-0000-0000-000000000000')
    mkdirSync(bad)
    writeFileSync(join(bad, DB_NAME), 'damaged snapshot')
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const verified = latestRecoverySnapshot(root)!.dir
    expect(verified).not.toBe(bad)
    backups.stop()
    db.close()
    const live = join(directory, DB_NAME)
    writeFileSync(live, 'damaged library')
    writeFileSync(live + '-wal', 'uncheckpointed bytes')
    const result = restoreBackup(verified, live, covers, { preserveDamaged: true })
    expect(readFileSync(result.replaced!, 'utf8')).toBe('damaged library')
    expect(readFileSync(result.replaced! + '-wal', 'utf8')).toBe('uncheckpointed bytes')
    db = createDatabase(live)
    expect(listBooks(db).map(({ title }) => title)).toEqual(['First'])
  })

  it('ignores a snapshot left on disk before publication', () => {
    save('First')
    const unpublished = join(
      root,
      'snapshot-1794571200001-00000000-0000-0000-0000-000000000000-scheduled'
    )
    mkdirSync(unpublished)
    expect(bookCount()).toBe(1)
  })

  it('keeps only the newest verified copy from an older two-backup library', () => {
    save('First')
    const older = join(root, 'snapshot-1794571199999-00000000-0000-0000-0000-000000000000')
    mkdirSync(older)
    writeFileSync(
      join(older, DB_NAME),
      readFileSync(join(latestRecoverySnapshot(root)!.dir, DB_NAME))
    )
    backups.start(db)
    expect(bookCount()).toBe(1)
    expect(snapshotDirectories()).toHaveLength(1)
  })
})
