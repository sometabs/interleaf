import {
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

import { closeDb, getDb, getDbPath } from '../src/main/db/connection'
import { createDatabase, MIGRATIONS } from '../src/main/db/database'
import { registerIpcHandlers } from '../src/main/ipc/handlers'
import { createBook, listBooks, updateBook } from '../src/main/repos/books'
import { trustRenderer } from '../src/main/security'
import { BACKUP_INTERVAL, latestRecoverySnapshot } from '../src/main/services/automaticBackups'
import { DB_NAME, exportBackup, verifySnapshot } from '../src/main/services/backup'
import { coversDir } from '../src/main/services/covers'
import {
  openLibraryWithRecovery,
  restoreLibrary,
  startAutomaticBackups,
  stopAutomaticBackups
} from '../src/main/services/libraryRecovery'

import type { IpcMainInvokeEvent, WebContents } from 'electron'

type Handler = (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>
const { getPath, pick, prompt, showError, handlers } = vi.hoisted(() => ({
  getPath: vi.fn(),
  pick: vi.fn(),
  prompt: vi.fn(),
  showError: vi.fn(),
  handlers: new Map<string, Handler>()
}))

vi.mock('electron', () => ({
  app: { getPath },
  BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] },
  dialog: { showOpenDialog: pick, showMessageBoxSync: prompt, showErrorBox: showError },
  ipcMain: { handle: (name: string, handler: Handler) => handlers.set(name, handler) }
}))

vi.mock('@electron-toolkit/utils', () => ({ is: { dev: false } }))
vi.mock('fs', async (importOriginal) => {
  const fs = await importOriginal<typeof import('fs')>()
  return { ...fs, renameSync: vi.fn(fs.renameSync) }
})

let dir: string
let root: string
let event: IpcMainInvokeEvent

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-13T12:00:00Z'))
  dir = mkdtempSync(join(tmpdir(), 'interleaf-library-recovery-'))
  root = join(dir, 'backups')
  getPath.mockReturnValue(dir)
  pick.mockReset()
  prompt.mockReset().mockReturnValue(0)
  showError.mockReset()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const url = 'file:///C:/Interleaf/out/renderer/index.html'
  const contents = { mainFrame: { url }, isDestroyed: () => false } as unknown as WebContents
  trustRenderer(contents, url)
  event = { sender: contents, senderFrame: contents.mainFrame } as IpcMainInvokeEvent
  registerIpcHandlers()
  expect(openLibraryWithRecovery()).toBe(true)
  startAutomaticBackups()
})

afterEach(() => {
  stopAutomaticBackups()
  closeDb()
  rmSync(dir, { recursive: true, force: true })
  vi.useRealTimers()
  vi.restoreAllMocks()
})

function invoke(name: string, ...args: unknown[]): Promise<unknown> {
  return handlers.get(name)!(event, ...args)
}

function snapshotTitles(): string[] {
  const snapshot = latestRecoverySnapshot(root)
  if (!snapshot) return []
  const copy = createDatabase(join(snapshot.dir, DB_NAME))
  try {
    return listBooks(copy)
      .map(({ title }) => title)
      .sort()
  } finally {
    copy.close()
  }
}
function makeExport(): string {
  const source = createDatabase(':memory:')
  try {
    const book = createBook(source, { title: 'From export' })
    updateBook(source, book.id, { coverPath: 'book-1.jpg' })
    const jackets = join(dir, 'export-covers')
    mkdirSync(jackets, { recursive: true })
    writeFileSync(join(jackets, 'book-1.jpg'), 'export jacket')
    return exportBackup(source, dir, jackets).dir
  } finally {
    source.close()
  }
}

async function saveCurrent(): Promise<void> {
  const book = (await invoke('createBook', { title: 'Current library' })) as { id: number }
  await invoke('updateBook', book.id, { coverPath: 'book-1.jpg' })
  writeFileSync(join(coversDir(), 'book-1.jpg'), 'current jacket')
  vi.advanceTimersByTime(1)
}

describe('library backup integration', () => {
  it('backs up the library right before a bulk delete and keeps that copy', async () => {
    await saveCurrent()
    await invoke('createBook', { title: 'Added after the last backup' })
    await expect(invoke('deleteEverything')).resolves.toBeUndefined()
    expect(listBooks(getDb())).toEqual([])
    expect(snapshotTitles()).toEqual(['Added after the last backup', 'Current library'])
    vi.advanceTimersByTime(BACKUP_INTERVAL)
    expect(snapshotTitles()).toEqual([])
    expect(readdirSync(root)).toHaveLength(3)
  })

  it('deletes nothing when the backup before a bulk delete fails', async () => {
    await saveCurrent()
    await invoke('createBook', { title: 'Added after the last backup' })
    const rename = vi.mocked(renameSync).getMockImplementation()!
    vi.mocked(renameSync).mockImplementation((from, to) => {
      if (String(to).endsWith('.verified')) throw new Error('Disk full')
      rename(from, to)
    })
    try {
      await expect(invoke('deleteAllBooks')).rejects.toThrow('Nothing was deleted.')
      expect(listBooks(getDb())).toHaveLength(2)
    } finally {
      vi.mocked(renameSync).mockImplementation(rename)
    }
  })

  it('clears Discover thumbnails along with the recommendation cache', async () => {
    getDb()
      .prepare("INSERT INTO book_candidate (olid, title, cover_id) VALUES ('OL1W', 'Cached', 11)")
      .run()
    writeFileSync(join(coversDir(), 'cover-11.jpg'), 'shown in Discover')
    writeFileSync(join(coversDir(), 'cover-22.jpg'), 'left over from an older search')
    await expect(invoke('clearRecommendationCache')).resolves.toBe(1)
    expect(readdirSync(coversDir())).toEqual([])
  })

  it('backs up the restored library and its covers, keeping the previous copy', async () => {
    await saveCurrent()
    const source = makeExport()
    const result = restoreLibrary(source)
    expect(listBooks(getDb())[0].title).toBe('From export')
    expect(snapshotTitles()).toEqual(['From export'])
    expect(readdirSync(root)).toHaveLength(2)
    const latest = latestRecoverySnapshot(root)!
    expect(result.replaced).toBeNull()
    expect(readFileSync(join(latest.dir, 'covers', 'book-1.jpg'), 'utf8')).toBe('export jacket')
    expect(verifySnapshot(join(source, DB_NAME)).books).toBe(1)
  })

  it('validates an export before adding a recovery point or closing the library', async () => {
    await saveCurrent()
    const current = getDb()
    const source = join(dir, 'unrelated')
    mkdirSync(source)
    writeFileSync(join(source, DB_NAME), 'not a library')
    pick.mockResolvedValueOnce({ canceled: false, filePaths: [source] })
    await expect(invoke('restoreBackup')).rejects.toThrow()
    expect(getDb()).toBe(current)
    expect(snapshotTitles()).toEqual(['Current library'])
  })

  it('restores the original cover and database if replacing the live file fails', async () => {
    await saveCurrent()
    const source = makeExport()
    const live = getDbPath()
    const rename = vi.mocked(renameSync).getMockImplementation()!
    vi.mocked(renameSync).mockImplementation((from, to) => {
      if (to === live) throw new Error('Database file locked')
      rename(from, to)
    })
    expect(() => restoreLibrary(source)).toThrow('Database file locked')
    expect(listBooks(getDb())[0].title).toBe('Current library')
    expect(readFileSync(join(coversDir(), 'book-1.jpg'), 'utf8')).toBe('current jacket')
  })

  it('keeps the previous recovery copy if refreshing it after a restore fails, then retries', async () => {
    await saveCurrent()
    const source = makeExport()
    const rename = vi.mocked(renameSync).getMockImplementation()!
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.mocked(renameSync).mockImplementation((from, to) => {
      if (String(to).endsWith('.verified')) throw new Error('Disk full')
      rename(from, to)
    })
    expect(restoreLibrary(source).books).toBe(1)
    expect(listBooks(getDb())[0].title).toBe('From export')
    expect(snapshotTitles()).toEqual(['Current library'])
    vi.mocked(renameSync).mockImplementation(rename)
    vi.advanceTimersByTime(5 * 60 * 1000)
    expect(snapshotTitles()).toEqual(['From export'])
    expect(readdirSync(root)).toHaveLength(2)
  })

  it('offers startup recovery for corruption and keeps the damaged bytes', async () => {
    await saveCurrent()
    const live = getDbPath()
    stopAutomaticBackups()
    closeDb()
    writeFileSync(live, 'corrupt SQLite file')
    expect(openLibraryWithRecovery()).toBe(true)
    expect(prompt).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Interleaf found a damaged database.',
        buttons: ['Restore backup', 'Start an empty library', 'Quit'],
        defaultId: 0,
        cancelId: 2
      })
    )
    expect(listBooks(getDb())[0].title).toBe('Current library')
    const damaged = readdirSync(dir).find((name) => name.startsWith('damaged-library-'))
    expect(readFileSync(join(dir, damaged!, DB_NAME), 'utf8')).toBe('corrupt SQLite file')
  })

  it('leaves the library and snapshots alone when the user quits startup recovery', async () => {
    await saveCurrent()
    const live = getDbPath()
    stopAutomaticBackups()
    closeDb()
    writeFileSync(live, 'corrupt SQLite file')
    prompt.mockReturnValue(2)
    expect(openLibraryWithRecovery()).toBe(false)
    expect(readFileSync(live, 'utf8')).toBe('corrupt SQLite file')
    expect(snapshotTitles()).toEqual(['Current library'])
  })

  it('can start an empty library instead, setting the damaged database aside', async () => {
    await saveCurrent()
    const live = getDbPath()
    stopAutomaticBackups()
    closeDb()
    writeFileSync(live, 'corrupt SQLite file')
    prompt.mockReturnValue(1)
    expect(openLibraryWithRecovery()).toBe(true)
    expect(listBooks(getDb())).toEqual([])
    const damaged = readdirSync(dir).find((name) => name.startsWith('damaged-library-'))
    expect(readFileSync(join(dir, damaged!, DB_NAME), 'utf8')).toBe('corrupt SQLite file')
    expect(snapshotTitles()).toEqual(['Current library'])
  })

  it('can start an empty library when the database is missing', async () => {
    await saveCurrent()
    const live = getDbPath()
    stopAutomaticBackups()
    closeDb()
    rmSync(live)
    prompt.mockReturnValue(1)
    expect(openLibraryWithRecovery()).toBe(true)
    expect(listBooks(getDb())).toEqual([])
    expect(snapshotTitles()).toEqual(['Current library'])
  })

  it('offers recovery if an existing library database goes missing', async () => {
    await saveCurrent()
    const live = getDbPath()
    stopAutomaticBackups()
    closeDb()
    rmSync(live)
    expect(openLibraryWithRecovery()).toBe(true)
    expect(prompt).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Interleaf could not find your database.' })
    )
    expect(listBooks(getDb())[0].title).toBe('Current library')
  })

  it('does not offer to overwrite a database from a newer app version', async () => {
    await saveCurrent()
    getDb().pragma(`user_version = ${MIGRATIONS.length + 1}`)
    stopAutomaticBackups()
    closeDb()
    expect(openLibraryWithRecovery()).toBe(false)
    expect(prompt).not.toHaveBeenCalled()
    expect(showError).toHaveBeenCalledWith(expect.any(String), expect.stringContaining('newer'))
  })
})

describe('restoring keeps the library it replaces', () => {
  function titlesInEverySnapshot(folder: string): string[] {
    return readdirSync(folder)
      .filter((name) => name.startsWith('snapshot-'))
      .flatMap((name) => {
        const copy = createDatabase(join(folder, name, DB_NAME))
        try {
          return listBooks(copy).map(({ title }) => title)
        } finally {
          copy.close()
        }
      })
  }

  it('saves the current library as an automatic backup before replacing it', async () => {
    await saveCurrent()
    const source = makeExport()

    restoreLibrary(source)

    expect(listBooks(getDb())[0].title).toBe('From export')
    expect(titlesInEverySnapshot(root)).toContain('Current library')
  })

  it('restores nothing when the current library cannot be saved first', async () => {
    await saveCurrent()
    // Not yet in any automatic backup, so the restore has to save it first.
    await invoke('createBook', { title: 'Unsaved change' })
    const source = makeExport()
    const rename = vi.mocked(renameSync).getMockImplementation()!
    vi.mocked(renameSync).mockImplementation((from, to) => {
      if (String(to).endsWith('.verified')) throw new Error('Disk full')
      rename(from, to)
    })
    try {
      expect(() => restoreLibrary(source)).toThrow(/Nothing was restored/)
      expect(listBooks(getDb()).map(({ title }) => title)).toContain('Unsaved change')
    } finally {
      vi.mocked(renameSync).mockImplementation(rename)
    }
  })
})

describe('choosing where automatic backups go', () => {
  it('starts in the default folder', async () => {
    await expect(invoke('getBackupStatus')).resolves.toMatchObject({
      folder: root,
      isDefault: true
    })
  })

  it('moves to a chosen folder, backing up there at once, and can move back', async () => {
    await saveCurrent()
    const synced = join(dir, 'synced')
    pick.mockResolvedValueOnce({ canceled: false, filePaths: [synced] })

    const moved = (await invoke('chooseBackupFolder')) as { folder: string; latestAt: number }

    expect(moved).toMatchObject({ folder: synced, isDefault: false })
    expect(moved.latestAt).not.toBeNull()
    expect(latestRecoverySnapshot(synced)).not.toBeNull()
    await expect(invoke('useDefaultBackupFolder')).resolves.toMatchObject({
      folder: root,
      isDefault: true
    })
  })

  it('changes nothing when the folder picker is cancelled', async () => {
    pick.mockResolvedValueOnce({ canceled: true, filePaths: [] })

    await expect(invoke('chooseBackupFolder')).resolves.toBeNull()
    await expect(invoke('getBackupStatus')).resolves.toMatchObject({ isDefault: true })
  })
})
