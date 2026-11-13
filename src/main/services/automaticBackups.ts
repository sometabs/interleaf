import type { Database } from 'better-sqlite3'
import { randomUUID } from 'crypto'
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'

import { BackupError, DB_NAME, verifySnapshot, writeRecoverySnapshot } from './backup'

export const BACKUP_INTERVAL = 24 * 60 * 60 * 1000
const RETRY_INTERVAL = 5 * 60 * 1000
const READY_MARKER = '.verified'
const SNAPSHOT_NAME =
  /^snapshot-(\d{13})-[a-f0-9-]{36}(?:-(scheduled|before-delete|before-restore|restored))?$/

interface Snapshot {
  dir: string
  createdAt: number
  requiresMarker: boolean
}

interface VerifiedSnapshot extends Snapshot {
  revision: string | null
}

function listSnapshots(root: string): Snapshot[] {
  try {
    return readdirSync(root, { withFileTypes: true })
      .flatMap((entry) => {
        const match = SNAPSHOT_NAME.exec(entry.name)
        return entry.isDirectory() && match
          ? [
              {
                dir: join(root, entry.name),
                createdAt: Number(match[1]),
                requiresMarker: match[2] !== undefined
              }
            ]
          : []
      })
      .sort((a, b) => b.createdAt - a.createdAt)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }
}

function verified(snapshot: Snapshot): VerifiedSnapshot | null {
  if (snapshot.requiresMarker && !existsSync(join(snapshot.dir, READY_MARKER))) return null
  try {
    return { ...snapshot, revision: verifySnapshot(join(snapshot.dir, DB_NAME)).revision }
  } catch (err) {
    console.warn('Skipping an unreadable automatic backup.', snapshot.dir, err)
    return null
  }
}

export function latestRecoverySnapshot(root: string): VerifiedSnapshot | null {
  for (const snapshot of listSnapshots(root)) {
    const result = verified(snapshot)
    if (result) return result
  }
  return null
}

export class AutomaticBackups {
  private latest: VerifiedSnapshot | null = null
  private db: Database | null = null
  private timer: ReturnType<typeof setTimeout> | undefined
  private dueAt = 0
  private retryAfter = 0
  private refreshPending = false

  constructor(
    private readonly root: string,
    private readonly covers: string
  ) {}

  start(db: Database, refresh = false): void {
    this.stop()
    this.db = db
    this.latest = null
    this.refreshPending = refresh
    try {
      this.latest = latestRecoverySnapshot(this.root)
      if (refresh) this.checkpoint()
      else {
        this.prune()
        this.schedule()
      }
    } catch (err) {
      this.retry(err)
    }
  }

  stop(): void {
    clearTimeout(this.timer)
    this.timer = undefined
    this.db = null
    this.retryAfter = 0
    this.refreshPending = false
  }

  /** Call after a library write, including a partially successful async operation. */
  schedule(): void {
    if (!this.db) return
    try {
      const revision = this.revision(this.db)
      if (!this.refreshPending && revision === (this.latest?.revision ?? '')) return
      const now = Date.now()
      const dueAt =
        this.latest && !this.refreshPending
          ? Math.max(now, this.latest.createdAt + BACKUP_INTERVAL)
          : now
      this.scheduleAt(Math.max(this.retryAfter, Math.min(now + BACKUP_INTERVAL, dueAt)))
    } catch (err) {
      this.retry(err)
    }
  }

  private checkpoint(): void {
    if (!this.db) throw new BackupError('The library is not open.')
    try {
      const revision = this.revision(this.db)
      const createdAt = Math.max(Date.now(), (this.latest?.createdAt ?? 0) + 1)
      mkdirSync(this.root, { recursive: true })
      const dir = join(
        this.root,
        `snapshot-${String(createdAt).padStart(13, '0')}-${randomUUID()}-scheduled`
      )
      mkdirSync(dir)
      try {
        writeRecoverySnapshot(this.db, dir, this.covers)
        // Publish a file within the folder. Windows can refuse to rename the
        // folder itself while its freshly written contents are being scanned.
        const marker = join(dir, '.pending')
        writeFileSync(marker, '')
        renameSync(marker, join(dir, READY_MARKER))
      } catch (err) {
        rmSync(dir, { recursive: true, force: true })
        throw err
      }
      this.latest = { dir, createdAt, revision, requiresMarker: true }
      this.refreshPending = false
      this.retryAfter = 0
      clearTimeout(this.timer)
      this.timer = undefined
      this.prune()
    } catch (err) {
      throw new BackupError(`Could not create an automatic backup. ${(err as Error).message}`, {
        cause: err
      })
    }
  }

  private prune(): void {
    if (!this.latest) return
    try {
      for (const snapshot of listSnapshots(this.root)) {
        if (snapshot.dir !== this.latest.dir) {
          rmSync(snapshot.dir, { recursive: true, force: true })
        }
      }
    } catch (err) {
      console.warn('Could not remove old automatic backups.', err)
    }
  }

  private revision(db: Database): string {
    const row = db
      .prepare<[], { revision: string }>('SELECT revision FROM library_revision WHERE id = 1')
      .get()
    if (!row) throw new BackupError('The library revision is missing.')
    return row.revision
  }

  private scheduleAt(dueAt: number): void {
    if (this.timer && dueAt >= this.dueAt) return
    clearTimeout(this.timer)
    this.dueAt = dueAt
    this.timer = setTimeout(
      () => {
        this.timer = undefined
        if (!this.db) return
        try {
          // Re-evaluate after a clock change instead of using an expired delay.
          const now = Date.now()
          if (
            !this.refreshPending &&
            this.latest &&
            this.latest.createdAt <= now &&
            now < this.latest.createdAt + BACKUP_INTERVAL
          ) {
            this.schedule()
            return
          }
          if (this.refreshPending || this.revision(this.db) !== (this.latest?.revision ?? '')) {
            this.checkpoint()
          }
        } catch (err) {
          this.retry(err)
        }
      },
      Math.max(0, dueAt - Date.now())
    )
    this.timer.unref()
  }

  private retry(err: unknown): void {
    console.warn('Automatic backup failed. Interleaf will retry.', err)
    this.retryAfter = Date.now() + RETRY_INTERVAL
    this.scheduleAt(this.retryAfter)
  }
}
