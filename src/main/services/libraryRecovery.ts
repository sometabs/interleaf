import { app, dialog } from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'

import { closeDb, getDb, getDbPath, initDb } from '../db/connection'
import { AutomaticBackups, latestRecoverySnapshot } from './automaticBackups'
import {
  checkDatabaseIntegrity,
  isDatabaseCorruption,
  restoreBackup,
  type RestoreResult
} from './backup'
import { coversDir } from './covers'

function backupDirectory(): string {
  return join(app.getPath('userData'), 'backups')
}

let automatic: AutomaticBackups | undefined

export function startAutomaticBackups(refresh = false): void {
  automatic?.stop()
  automatic = new AutomaticBackups(backupDirectory(), coversDir())
  automatic.start(getDb(), refresh)
}

export function stopAutomaticBackups(): void {
  automatic?.stop()
  automatic = undefined
}

export function scheduleAutomaticBackup(): void {
  automatic?.schedule()
}

function recoverAtStartup(dbPath: string, damaged: boolean): boolean | null {
  const snapshot = latestRecoverySnapshot(backupDirectory())
  if (!snapshot) return null
  const selected = dialog.showMessageBoxSync({
    type: 'warning',
    title: 'Recover library',
    message: damaged
      ? 'Interleaf found a damaged database.'
      : 'Interleaf could not find your database.',
    detail:
      `Restore the automatic backup from ${new Date(snapshot.createdAt).toLocaleString()}?` +
      (damaged ? ' Interleaf will keep a copy of the damaged database.' : ''),
    buttons: ['Restore backup', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    noLink: true
  })
  if (selected !== 0) return false
  restoreBackup(snapshot.dir, dbPath, coversDir(), { preserveDamaged: damaged })
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
      beforeReplace: () => {
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
