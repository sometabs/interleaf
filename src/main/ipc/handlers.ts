import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { is } from '@electron-toolkit/utils'
import { existsSync, readdirSync } from 'fs'
import { join } from 'path'

import {
  HARVEST_PROGRESS_CHANNEL,
  type InterleafApi,
  IPC_CHANNELS,
  METADATA_REFRESH_PROGRESS_CHANNEL,
  SEMANTIC_PROGRESS_CHANNEL,
  type MetadataRefreshProgress,
  type MetadataRefreshResult,
  type SemanticProgress
} from '../../shared/api'
import { closeDb, getDb } from '../db/connection'
import { assertTrustedIpcSender } from '../security'
import * as books from '../repos/books'
import * as bookshelf from '../repos/bookshelf'
import * as readerLook from '../repos/readerLook'
import * as goals from '../repos/goals'
import * as bookFiles from '../repos/bookFiles'
import * as bookmarks from '../repos/bookmarks'
import * as readingTime from '../repos/readingTime'
import {
  attachEpub,
  describeEpub,
  detachEpub,
  epubDir,
  readStoredEpub
} from '../services/bookFiles'
import * as data from '../repos/data'
import * as meta from '../repos/metadata'
import * as notes from '../repos/notes'
import * as searchRepo from '../repos/search'
import * as backup from '../services/backup'
import {
  backupBeforeBulkDelete,
  backupStatus,
  restoreLibrary,
  scheduleAutomaticBackup,
  setBackupFolder,
  stopAutomaticBackups
} from '../services/libraryRecovery'
import * as highlights from '../services/highlights'
import { harvestCandidates } from '../services/harvest'
import {
  addFromOpenLibrary,
  refreshAllBookMetadata,
  refreshOneBookMetadata,
  retryBookMetadata
} from '../services/library'
import { coversDir, importCoverFile, pruneDiscoverCovers } from '../services/covers'
import * as ol from '../services/openlibrary'
import { suggest, suggestTree } from '../services/suggestions'
import { suggestHybridRecommendations, suggestHybridRecommendationTree } from '../services/hybrid'
import { getSpineColors } from '../services/spineColors'
import { installReadyUpdate, readyUpdate } from '../services/updates'

let metadataRefreshActive = false
let metadataRefreshCancelled = false
let selectedHighlightExport: string | null = null
let pendingIpc = 0
let restarting = false

const libraryWrites = new Set<keyof InterleafApi>([
  'getBookshelfLayout',
  'saveBookshelfLayout',
  'saveReaderLook',
  'setReadingGoal',
  'attachEpub',
  'removeEpub',
  'createBook',
  'updateBook',
  'reorderPriority',
  'deleteBook',
  'createNote',
  'updateNote',
  'deleteNote',
  'deleteBookNotes',
  'addBookFromOpenLibrary',
  'enrichBook',
  'refreshAllMetadata',
  'retryMetadataRefresh',
  'chooseCover',
  'removeCover',
  'dismissRecommendation',
  'saveRecommendation',
  'restoreDismissed',
  'importHighlights',
  'deleteAllBooks',
  'deleteAllThoughts',
  'deleteAllQuotes',
  'deleteAllReviews',
  'deleteEverything'
])

function restoreAndRestart(dir: string): backup.RestoreResult {
  if (pendingIpc > 1)
    throw new Error('Wait for other library operations to finish, then retry the restore.')
  const result = restoreLibrary(dir)
  restarting = true
  // Let the IPC reply reach the renderer before restarting.
  setTimeout(() => {
    stopAutomaticBackups()
    closeDb()
    app.relaunch(backup.relaunchOptions())
    app.exit(0)
  }, 200)
  return result
}

function sendMetadataProgress(progress: MetadataRefreshProgress): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(METADATA_REFRESH_PROGRESS_CHANNEL, progress)
    }
  }
}

function sendSemanticProgress(progress: SemanticProgress): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(SEMANTIC_PROGRESS_CHANNEL, progress)
  }
}

function semanticModelsDir(): string {
  return join(app.getPath('userData'), 'semantic-models')
}

function semanticModelInstalled(): boolean {
  const dir = semanticModelsDir()
  if (!existsSync(dir)) return false

  try {
    const files = readdirSync(dir, { recursive: true, encoding: 'utf8' })
    return (
      files.some((file) => file.toLowerCase().endsWith('.onnx')) &&
      files.some((file) => file.toLowerCase().endsWith('tokenizer.json'))
    )
  } catch {
    return false
  }
}

async function runMetadataRefresh(bookIds?: number[]): Promise<MetadataRefreshResult> {
  if (metadataRefreshActive) throw new Error('A metadata refresh is already running.')
  metadataRefreshActive = true
  metadataRefreshCancelled = false

  try {
    const cancelled = (): boolean => metadataRefreshCancelled
    return bookIds === undefined
      ? await refreshAllBookMetadata(getDb(), sendMetadataProgress, cancelled)
      : await retryBookMetadata(getDb(), bookIds, sendMetadataProgress, cancelled)
  } finally {
    metadataRefreshActive = false
  }
}

// Typed as `InterleafApi` so drift from the contract is a compile error.
const api: InterleafApi = {
  async listBooks() {
    return books.listBooks(getDb())
  },
  async getBookshelfLayout() {
    return bookshelf.getBookshelfLayout(getDb())
  },
  async saveBookshelfLayout(layout) {
    return bookshelf.saveBookshelfLayout(getDb(), layout)
  },
  async getReaderLook() {
    return readerLook.getReaderLook(getDb())
  },
  async saveReaderLook(look) {
    return readerLook.saveReaderLook(getDb(), look)
  },
  async listReadingGoals() {
    return goals.listReadingGoals(getDb())
  },
  async setReadingGoal(year, count) {
    goals.setReadingGoal(getDb(), year, count)
  },
  async listBookFiles() {
    return bookFiles.listBookFiles(getDb())
  },
  async chooseEpub() {
    const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const options = {
      title: 'Choose an EPUB',
      properties: ['openFile' as const],
      filters: [{ name: 'EPUB', extensions: ['epub'] }]
    }
    const result = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length === 0) return null
    return describeEpub(getDb(), result.filePaths[0])
  },
  async inspectEpub(path) {
    return describeEpub(getDb(), String(path))
  },
  async attachEpub(bookId, path, replace) {
    return attachEpub(getDb(), epubDir(), bookId, String(path), replace === true)
  },
  async removeEpub(bookId) {
    detachEpub(getDb(), epubDir(), bookId)
  },
  async readEpub(bookId) {
    return readStoredEpub(getDb(), epubDir(), bookId)
  },
  async getReadingPosition(bookId) {
    return bookFiles.getReadingPosition(getDb(), bookId)
  },
  async saveReadingPosition(bookId, position) {
    bookFiles.saveReadingPosition(getDb(), bookId, position)
  },
  async recentReading() {
    return bookFiles.recentReading(getDb())
  },
  async listBookmarks(bookId) {
    return bookmarks.listBookmarks(getDb(), bookId)
  },
  async addBookmark(bookId, bookmark) {
    return bookmarks.addBookmark(getDb(), bookId, bookmark)
  },
  async removeBookmark(id) {
    bookmarks.removeBookmark(getDb(), id)
  },
  async recordReadingSession(bookId, startedAt, seconds) {
    readingTime.recordSession(getDb(), bookId, startedAt, seconds)
  },
  async bookReadingTime(bookId) {
    return readingTime.bookReadingTime(getDb(), bookId)
  },
  async readingTimeSummary() {
    return readingTime.readingTimeSummary(getDb())
  },
  getSpineColors,
  async createBook(input) {
    return books.createBook(getDb(), input)
  },
  async updateBook(id, patch) {
    const db = getDb()
    const updated = books.updateBook(db, id, patch)
    return updated
  },
  async reorderPriority(bookIds) {
    books.reorderPriority(getDb(), Array.isArray(bookIds) ? bookIds : [])
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
  async deleteBookNotes(bookId, kind) {
    return notes.deleteBookNotes(getDb(), bookId, kind)
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
      editionOlid: b.editionOlid,
      title: b.title,
      author: b.author,
      publishedYear: b.publishedYear,
      coverId: b.coverId,
      isbn: b.isbn,
      pageCount: b.pageCount,
      subjects: b.subjects,
      description: b.description
    }))
  },
  async addBookFromOpenLibrary(book) {
    return addFromOpenLibrary(getDb(), book)
  },
  async enrichBook(bookId) {
    return refreshOneBookMetadata(getDb(), bookId)
  },
  async refreshAllMetadata() {
    return runMetadataRefresh()
  },
  async retryMetadataRefresh(bookIds) {
    return runMetadataRefresh(Array.isArray(bookIds) ? bookIds : [])
  },
  async cancelMetadataRefresh() {
    if (metadataRefreshActive) metadataRefreshCancelled = true
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

  async refreshRecommendations(query) {
    try {
      return await harvestCandidates(
        getDb(),
        (progress) => {
          // Every window, not the caller's: the generic handler loop below does not
          // thread the event through, and the app opens exactly one window.
          for (const window of BrowserWindow.getAllWindows()) {
            if (!window.isDestroyed()) window.webContents.send(HARVEST_PROGRESS_CHANNEL, progress)
          }
        },
        query?.likeBookId
      )
    } finally {
      pruneDiscoverThumbnails()
    }
  },
  async getRecommendations(query) {
    return suggest(getDb(), query)
  },
  async getHybridRecommendations(query) {
    return suggestHybridRecommendations(getDb(), query, semanticModelsDir(), sendSemanticProgress)
  },
  async getRecommendationTree(query) {
    return suggestTree(getDb(), query)
  },
  async getHybridRecommendationTree(query) {
    return suggestHybridRecommendationTree(
      getDb(),
      query,
      semanticModelsDir(),
      sendSemanticProgress
    )
  },
  async dismissRecommendation(olid) {
    meta.recordFeedback(getDb(), olid, 'dismissed')
  },
  async saveRecommendation(book) {
    const db = getDb()
    const added = await addFromOpenLibrary(db, book)
    meta.recordFeedback(db, book.olid, 'saved')
    return added
  },

  async exportBackup() {
    const dir = await pickDirectory('Choose where to save the backup', 'Back up here')
    if (!dir) return null
    return backup.exportBackup(getDb(), dir, coversDir(), epubDir())
  },
  async restoreBackup() {
    const dir = await pickDirectory('Choose a backup folder', 'Restore from here')
    return dir ? restoreAndRestart(dir) : null
  },
  async exportMarkdown() {
    const dir = await pickDirectory('Choose where to export your journal', 'Export here')
    if (!dir) return null
    return backup.exportMarkdown(getDb(), dir, coversDir())
  },
  async getBackupStatus() {
    return backupStatus()
  },
  async chooseBackupFolder() {
    const dir = await pickDirectory('Choose a folder for automatic backups', 'Use this folder')
    return dir ? setBackupFolder(dir) : null
  },
  async useDefaultBackupFolder() {
    return setBackupFolder(null)
  },

  async listDismissed() {
    return meta.dismissedBooks(getDb())
  },
  async restoreDismissed(olid) {
    meta.undismiss(getDb(), olid)
  },

  async readHighlightExport() {
    // A cancelled or invalid new selection must not leave an older file approved.
    selectedHighlightExport = null
    const file = await pickFile('Choose a highlights export', 'Read this file', [
      {
        name: 'Calibre or Kindle highlights',
        extensions: ['calibre_annotation_collection', 'json', 'txt']
      }
    ])
    if (!file) return null
    const plan = highlights.planImport(getDb(), file)
    selectedHighlightExport = file
    return plan
  },
  async importHighlights(filePath, links) {
    if (
      typeof filePath !== 'string' ||
      !selectedHighlightExport ||
      filePath !== selectedHighlightExport
    ) {
      throw new Error('Choose a highlights export before importing it.')
    }
    const result = highlights.runImport(getDb(), selectedHighlightExport, links)
    selectedHighlightExport = null
    return result
  },

  async getAppDiagnostics() {
    return {
      version: app.getVersion(),
      dataDirectory: app.getPath('userData'),
      schemaVersion: getDb().pragma('user_version', { simple: true }) as number,
      advancedModelInstalled: semanticModelInstalled()
    }
  },
  async checkOpenLibrary() {
    return ol.checkAvailability()
  },
  async getReadyUpdate() {
    return readyUpdate()
  },
  async restartToUpdate() {
    installReadyUpdate()
  },

  async dataCounts() {
    return data.dataCounts(getDb())
  },
  async deleteAllBooks() {
    backupBeforeBulkDelete()
    return data.deleteAllBooks(getDb())
  },
  async deleteAllThoughts() {
    backupBeforeBulkDelete()
    return data.deleteAllThoughts(getDb())
  },
  async deleteAllQuotes() {
    backupBeforeBulkDelete()
    return data.deleteAllQuotes(getDb())
  },
  async deleteAllReviews() {
    backupBeforeBulkDelete()
    return data.deleteAllReviews(getDb())
  },
  async clearRecommendationCache() {
    const cleared = data.clearRecommendationCache(getDb())
    pruneDiscoverThumbnails()
    return cleared
  },
  async deleteEverything() {
    backupBeforeBulkDelete()
    data.deleteEverything(getDb())
    pruneDiscoverThumbnails()
  }
}

// Never fails the operation it follows: a leftover thumbnail only costs disk space.
function pruneDiscoverThumbnails(): void {
  try {
    pruneDiscoverCovers(coversDir(), meta.candidateCoverIds(getDb()))
  } catch (err) {
    console.warn('Could not remove unused Discover thumbnails.', err)
  }
}

async function pickFile(
  title: string,
  buttonLabel: string,
  filters: { name: string; extensions: string[] }[]
): Promise<string | null> {
  const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  const options = { title, buttonLabel, filters, properties: ['openFile' as const] }

  const result = window
    ? await dialog.showOpenDialog(window, options)
    : await dialog.showOpenDialog(options)

  return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0]
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
    ipcMain.handle(channel, async (event, ...args: unknown[]) => {
      assertTrustedIpcSender(event)
      if (restarting) throw new Error('Interleaf is restarting after restoring your library.')
      const handler = api[channel] as (...a: unknown[]) => Promise<unknown>
      pendingIpc++
      try {
        const result = await handler(...args)
        if (is.dev) console.log(`[ipc] ${channel} ok`)
        return result
      } catch (err) {
        // IPC serializes a thrown error by message only, losing the stack.
        console.error(`[ipc] ${channel} failed:`, err)
        throw err
      } finally {
        pendingIpc--
        if (libraryWrites.has(channel)) scheduleAutomaticBackup()
      }
    })
  }
}
