import type { Database } from 'better-sqlite3'
import type { IpcMainInvokeEvent, WebContents } from 'electron'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { IPC_CHANNELS } from '../src/shared/api'
import { createDatabase } from '../src/main/db/database'
import { registerIpcHandlers } from '../src/main/ipc/handlers'
import * as books from '../src/main/repos/books'
import * as notes from '../src/main/repos/notes'
import { trustRenderer } from '../src/main/security'

type Handler = (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>
const { handlers, pick, getDb } = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  pick: vi.fn(),
  getDb: vi.fn()
}))

vi.mock('electron', () => ({
  app: { getPath: () => tmpdir() },
  BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] },
  dialog: { showOpenDialog: pick },
  ipcMain: { handle: (channel: string, handler: Handler) => handlers.set(channel, handler) }
}))
vi.mock('@electron-toolkit/utils', () => ({ is: { dev: false } }))
vi.mock('../src/main/db/connection', () => ({
  getDb,
  closeDb: vi.fn(),
  getDbPath: vi.fn(),
  initDb: vi.fn()
}))
vi.mock('../src/main/services/hybrid', () => ({
  suggestHybridRecommendations: vi.fn(),
  suggestHybridRecommendationTree: vi.fn()
}))

const APP_URL = 'file:///C:/Interleaf/out/renderer/index.html'
let db: Database
let dir: string
let event: IpcMainInvokeEvent

function invoke(channel: string, ...args: unknown[]): Promise<unknown> {
  return handlers.get(channel)!(event, ...args)
}

beforeEach(async () => {
  db = createDatabase(':memory:')
  dir = mkdtempSync(join(tmpdir(), 'interleaf-ipc-security-'))
  getDb.mockReturnValue(db)
  pick.mockReset().mockResolvedValue({ canceled: true, filePaths: [] })
  const contents = {
    mainFrame: { url: APP_URL },
    isDestroyed: () => false
  } as unknown as WebContents
  trustRenderer(contents, APP_URL)
  event = { sender: contents, senderFrame: contents.mainFrame } as IpcMainInvokeEvent
  handlers.clear()
  registerIpcHandlers()
  // Cancelling the picker also clears any selection from the previous test.
  await invoke('readHighlightExport')
  getDb.mockClear()
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
  vi.restoreAllMocks()
})

function exportFile(name = 'highlights.json'): string {
  const file = join(dir, name)
  writeFileSync(
    file,
    JSON.stringify({
      type: 'calibre_annotation_collection',
      annotations: [
        {
          type: 'highlight',
          uuid: 'security-test-quote',
          book_id: 42,
          highlighted_text: 'The glass observatory opened at sunrise.'
        }
      ]
    })
  )
  return file
}

async function choose(file: string): Promise<void> {
  pick.mockResolvedValueOnce({ canceled: false, filePaths: [file] })
  await invoke('readHighlightExport')
}

describe('registered IPC handlers', () => {
  it('rejects untrusted senders before any registered API method runs', async () => {
    const untrusted = { sender: event.sender, senderFrame: null } as IpcMainInvokeEvent
    for (const channel of IPC_CHANNELS) {
      await expect(handlers.get(channel)!(untrusted)).rejects.toThrow(/Interleaf window/)
    }
    expect(getDb).not.toHaveBeenCalled()
    expect(pick).toHaveBeenCalledTimes(1)
  })

  it('allows ordinary library calls from the enrolled main frame', async () => {
    books.createBook(db, { title: 'A Test Book' })
    await expect(invoke('listBooks')).resolves.toMatchObject([{ title: 'A Test Book' }])
  })
})

describe('highlight file selection', () => {
  it('refuses an import without a picker selection', async () => {
    await expect(invoke('importHighlights', exportFile(), [])).rejects.toThrow(
      /Choose a highlights/
    )
    expect(getDb).not.toHaveBeenCalled()
  })

  it('refuses a substituted file path even when the file is a valid export', async () => {
    await choose(exportFile())
    getDb.mockClear()
    await expect(invoke('importHighlights', exportFile('other.json'), [])).rejects.toThrow(
      /Choose a highlights/
    )
    expect(getDb).not.toHaveBeenCalled()
    expect(notes.listNotes(db)).toHaveLength(0)
  })

  it('imports the chosen file and clears its approval after success', async () => {
    const book = books.createBook(db, { title: 'The Glass Observatory' })
    const file = exportFile()
    await choose(file)
    await expect(
      invoke('importHighlights', file, [{ sourceKey: '42', bookId: book.id }])
    ).resolves.toEqual({
      imported: 1,
      skipped: 0,
      books: 1
    })
    expect(notes.listNotes(db)[0].bodyMd).toBe('The glass observatory opened at sunrise.')
    await expect(invoke('importHighlights', file, [])).rejects.toThrow(/Choose a highlights/)
  })

  it('still deduplicates when the same file is selected again', async () => {
    const book = books.createBook(db, { title: 'The Glass Observatory' })
    const file = exportFile()
    await choose(file)
    await invoke('importHighlights', file, [{ sourceKey: '42', bookId: book.id }])
    await choose(file)
    await expect(invoke('importHighlights', file, [])).resolves.toEqual({
      imported: 0,
      skipped: 1,
      books: 0
    })
  })

  it('clears the old selection when another picker is cancelled', async () => {
    const file = exportFile()
    await choose(file)
    await invoke('readHighlightExport')
    await expect(invoke('importHighlights', file, [])).rejects.toThrow(/Choose a highlights/)
  })

  it('clears the old selection when the new file cannot be parsed', async () => {
    const file = exportFile()
    await choose(file)
    const invalid = join(dir, 'invalid.txt')
    writeFileSync(invalid, 'Not a highlights export')
    pick.mockResolvedValueOnce({ canceled: false, filePaths: [invalid] })
    await expect(invoke('readHighlightExport')).rejects.toThrow(/not a Kindle clippings/)
    await expect(invoke('importHighlights', file, [])).rejects.toThrow(/Choose a highlights/)
  })

  it('allows retrying the selected file after an import transaction fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const book = books.createBook(db, { title: 'The Glass Observatory' })
    const file = exportFile()
    await choose(file)
    await expect(
      invoke('importHighlights', file, [{ sourceKey: '42', bookId: 999 }])
    ).rejects.toThrow(/no longer/)
    await expect(
      invoke('importHighlights', file, [{ sourceKey: '42', bookId: book.id }])
    ).resolves.toMatchObject({ imported: 1 })
  })
})
