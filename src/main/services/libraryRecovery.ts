import { app, dialog } from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'

import { closeDb, getDb, getDbPath, initDb } from '../db/connection'
import { AutomaticBackups, latestRecoverySnapshot } from './automaticBackups'
import {
  BackupError,
  checkDatabaseIntegrity,
  isDatabaseCorruption,
  restoreBackup,
  setAsideDatabase,
  type RestoreResult
} from './backup'
import type { BackupStatus } from '../../shared/api'
import { epubDir } from './bookFiles'
import { readMainSettings, writeMainSettings } from './mainSettings'
import { coversDir } from './covers'

function defaultBackupDirectory(): string {
  return join(app.getPath('userData'), 'backups')
}

// A chosen folder, such as one a sync service mirrors off this computer.
function backupDirectory(): string {
  return readMainSettings(app.getPath('userData')).backupFolder ?? defaultBackupDirectory()
}

let automatic: AutomaticBackups | undefined

export function startAutomaticBackups(refresh = false): void {
  automatic?.stop()
  automatic = new AutomaticBackups(backupDirectory(), coversDir(), epubDir())
  automatic.start(getDb(), refresh)
}

export function backupStatus(): BackupStatus {
  const folder = backupDirectory()
  return {
    folder,
    isDefault: folder === defaultBackupDirectory(),
    latestAt: automatic?.latestAt() ?? null
  }
}

// Null returns to the default folder. The next backup is written right away, so the new
// folder is never empty.
export function setBackupFolder(folder: string | null): BackupStatus {
  const userData = app.getPath('userData')
  writeMainSettings(userData, folder === null ? {} : { backupFolder: folder })
  startAutomaticBackups(true)
  return backupStatus()
}

export function stopAutomaticBackups(): void {
  automatic?.stop()
  automatic = undefined
}

export function scheduleAutomaticBackup(): void {
  automatic?.schedule()
}

export function backupBeforeBulkDelete(): void {
  try {
    if (!automatic) throw new BackupError('Automatic backups are not running.')
    automatic.backupNow()
  } catch (err) {
    throw new BackupError(`Nothing was deleted. ${(err as Error).message}`, { cause: err })
  }
}

const RESTORE = 0
const START_EMPTY = 1
const QUIT = 2

function recoverAtStartup(dbPath: string, damaged: boolean): boolean | null {
  // A chosen folder can be offline, such as an unplugged drive.
  const snapshot =
    latestRecoverySnapshot(backupDirectory()) ?? latestRecoverySnapshot(defaultBackupDirectory())
  if (!snapshot) return null
  const selected = dialog.showMessageBoxSync({
    type: 'warning',
    title: 'Recover library',
    message: damaged
      ? 'Interleaf found a damaged database.'
      : 'Interleaf could not find your database.',
    detail:
      `Restore the automatic backup from ${new Date(snapshot.createdAt).toLocaleString()}, ` +
      'or start an empty library.' +
      (damaged ? ' Either way, Interleaf keeps a copy of the damaged database.' : ''),
    buttons: ['Restore backup', 'Start an empty library', 'Quit'],
    defaultId: RESTORE,
    cancelId: QUIT,
    noLink: true
  })
  if (selected === QUIT) return false
  if (selected === START_EMPTY) {
    if (damaged) setAsideDatabase(dbPath)
  } else {
    restoreBackup(snapshot.dir, dbPath, coversDir(), {
      preserveDamaged: damaged,
      epubDir: epubDir()
    })
  }
  checkDatabaseIntegrity(initDb())
  return true
}

export function openLibraryWithRecovery(): boolean {
  const dbPath = getDbPath()
  try {
    if (!existsSync(dbPath)) {
      const recovered = recoverAtStartup(dbPath, false)
      if (recovered !== null) return recovered
    }
    checkDatabaseIntegrity(initDb())
    return true
  } catch (err) {
    closeDb()
    if (isDatabaseCorruption(err)) {
      try {
        const recovered = recoverAtStartup(dbPath, true)
        if (recovered !== null) return recovered
      } catch (recoveryError) {
        closeDb()
        dialog.showErrorBox('Library recovery failed', (recoveryError as Error).message)
        return false
      }
    }
    dialog.showErrorBox('Interleaf could not open your library', (err as Error).message)
    return false
  }
}

export function restoreLibrary(source: string): RestoreResult {
  let closed = false
  let result: RestoreResult
  const dbPath = getDbPath()
  const covers = coversDir()
  try {
    result = restoreBackup(source, dbPath, covers, {
      preservePrevious: false,
      epubDir: epubDir(),
      // Runs once the chosen backup has checked out: the library about to be replaced
      // becomes an automatic backup, so a wrong restore can be undone.
      beforeReplace: () => {
        try {
          if (!automatic) throw new BackupError('Automatic backups are not running.')
          automatic.backupNow()
        } catch (err) {
          throw new BackupError(
            `Nothing was restored: your current library could not be saved first. ${(err as Error).message}`,
            { cause: err }
          )
        }
        stopAutomaticBackups()
        closeDb()
        closed = true
      }
    })
  } catch (err) {
    if (closed) {
      initDb()
      startAutomaticBackups()
    }
    throw err
  }

  checkDatabaseIntegrity(initDb())
  startAutomaticBackups(true)
  return result
}
