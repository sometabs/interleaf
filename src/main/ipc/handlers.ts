import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { is } from '@electron-toolkit/utils'

import { HARVEST_PROGRESS_CHANNEL, type InterleafApi, IPC_CHANNELS } from '../../shared/api'
import { READING_LANGUAGES } from '../../shared/languages'
import { closeDb, getDb, getDbPath, initDb } from '../db/connection'
import * as books from '../repos/books'
import * as data from '../repos/data'
import * as meta from '../repos/metadata'
import * as notes from '../repos/notes'
import * as searchRepo from '../repos/search'
import * as backup from '../services/backup'
import { harvestCandidates } from '../services/harvest'
import { addFromOpenLibrary, enrich } from '../services/library'
import { coversDir, importCoverFile } from '../services/covers'
import * as ol from '../services/openlibrary'
import { suggest, suggestTree } from '../services/suggestions'

// Typed as `InterleafApi` so drift from the contract is a compile error.
const api: InterleafApi = {
  async listBooks() {
    return books.listBooks(getDb())
  },
  async createBook(input) {
    return books.createBook(getDb(), input)
  },
  async updateBook(id, patch) {
    const db = getDb()
    const updated = books.updateBook(db, id, patch)
    return updated
  },
  async deleteBook(id) {
    books.deleteBook(getDb(), id)
  },

  async listNotes(bookId) {
    return notes.listNotes(getDb(), bookId)
  },
  async getNote(id) {
    return notes.getNote(getDb(), id)
  },
  async createNote(input) {
    return notes.createNote(getDb(), input)
  },
  async updateNote(id, patch) {
    return notes.updateNote(getDb(), id, patch)
  },
  async deleteNote(id) {
    notes.deleteNote(getDb(), id)
  },

  async search(query, limit) {
    return searchRepo.search(getDb(), query, limit)
  },

  async searchOpenLibrary(query) {
    const found = await ol.searchBooks(query, 12)
    // Thrown, not returned empty: the dialog has to tell "no such book" from
    // "the lookup did not happen".
    if (found === null) {
      throw new Error('Open Library did not answer. Check your connection and try again.')
    }
    return found.map((b) => ({
      olid: b.olid,
      title: b.title,
      author: b.author,
      firstPublishYear: b.firstPublishYear,
      coverId: b.coverId,
      isbn: b.isbn,
      pageCount: b.pageCount
    }))
  },
  async addBookFromOpenLibrary(book) {
    return addFromOpenLibrary(getDb(), book)
  },
  async enrichBook(bookId) {
    return enrich(getDb(), bookId)
  },
  async chooseCover(bookId) {
    const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const options = {
      title: 'Choose a cover image',
      buttonLabel: 'Use this image',
      filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp'] }],
      properties: ['openFile' as const]
    }
    const picked = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options)

    if (picked.canceled || picked.filePaths.length === 0) return null

    // Throws a CoverError, whose message is written to reach the toast as-is.
    const fileName = importCoverFile(bookId, picked.filePaths[0])
    return books.updateBook(getDb(), bookId, { coverPath: fileName })
  },
  async removeCover(bookId) {
    // Only the link is dropped. The file is content-addressed, so another book
    // may be using it.
    return books.updateBook(getDb(), bookId, { coverPath: null })
  },

  async getBookMetadata(bookId) {
    return meta.getBookMetadata(getDb(), bookId)
  },
  async listBookSubjects() {
    return meta.listBookSubjects(getDb())
  },

  async refreshRecommendations() {
    return harvestCandidates(getDb(), READING_LANGUAGES, (progress) => {
      // Every window, not the caller's: the generic handler loop below does not
      // thread the event through, and the app opens exactly one window.
      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed()) window.webContents.send(HARVEST_PROGRESS_CHANNEL, progress)
      }
    })
  },
  async getRecommendations(query) {
    return suggest(getDb(), query)
  },
  async getRecommendationTree(query) {
    return suggestTree(getDb(), query)
  },
  async dismissRecommendation(olid) {
    meta.recordFeedback(getDb(), olid, 'dismissed')
  },
  async saveRecommendation(olid) {
    const db = getDb()
    meta.recordFeedback(db, olid, 'saved')

    // The candidate already holds title, author and cover, and search cannot
    // resolve an olid anyway.
    const candidate = meta.getCandidate(db, olid)
    return addFromOpenLibrary(db, {
      olid,
      title: candidate?.title ?? olid,
      author: candidate?.author ?? null,
      firstPublishYear: null,
      coverId: candidate?.coverId ?? null,
      isbn: null,
      pageCount: null
    })
  },

  async exportBackup() {
    const dir = await pickDirectory('Choose where to write the backup', 'Back up here')
    if (!dir) return null
    return backup.exportBackup(getDb(), dir, coversDir())
  },
  async restoreBackup() {
    const dir = await pickDirectory('Choose a backup folder to restore', 'Restore from here')
    if (!dir) return null

    // The file is replaced rather than edited, so nothing may hold it open.
    closeDb()
    let result: backup.RestoreResult
    try {
      result = backup.restoreBackup(dir, getDbPath(), coversDir())
    } catch (err) {
      // A refused restore leaves the old library untouched; reopen it.
      initDb()
      throw err
    }

    // Not in this tick: the reply is still on its way out, and the caller's
    // promise would never settle.
    setTimeout(() => {
      app.relaunch()
      // `quit` runs a teardown a window handler can cancel or delay, which lets
      // the replacement process start while this one still holds userData.
      app.exit(0)
    }, 200)
    return result
  },

  async listDismissed() {
    return meta.dismissedBooks(getDb())
  },
  async restoreDismissed(olid) {
    meta.undismiss(getDb(), olid)
  },

  async dataCounts() {
    return data.dataCounts(getDb())
  },
  async deleteAllBooks() {
    return data.deleteAllBooks(getDb())
  },
  async deleteAllNotes() {
    return data.deleteAllNotes(getDb())
  },
  async deleteEverything() {
    data.deleteEverything(getDb())
  }
}

async function pickDirectory(title: string, buttonLabel: string): Promise<string | null> {
  const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  const options = {
    title,
    buttonLabel,
    properties: ['openDirectory', 'createDirectory'] as const
  }

  const result = window
    ? await dialog.showOpenDialog(window, { ...options, properties: [...options.properties] })
    : await dialog.showOpenDialog({ ...options, properties: [...options.properties] })

  return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0]
}

export function registerIpcHandlers(): void {
  for (const channel of IPC_CHANNELS) {
    ipcMain.handle(channel, async (_event, ...args: unknown[]) => {
      const handler = api[channel] as (...a: unknown[]) => Promise<unknown>
      try {
        const result = await handler(...args)
        if (is.dev) console.log(`[ipc] ${channel} ok`)
        return result
      } catch (err) {
        // IPC serializes a thrown error by message only, losing the stack.
        console.error(`[ipc] ${channel} failed:`, err)
        throw err
      }
    })
  }
}
