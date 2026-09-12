import { existsSync, renameSync } from 'fs'
import { join } from 'path'

// Electron derives the userData directory from the app name, so a rename would
// point a fresh, empty folder at an existing library.

const APP_DIR = 'Interleaf'
const DEV_APP_DIR = 'Interleaf Dev'
const DB_FILE = 'interleaf.db'

const LEGACY_APP_DIR = 'bookhook'
const LEGACY_DB_FILE = 'bookhook.db'

// The whole directory, so the cover cache and Local Storage travel with it. A
// failed move returns the old path rather than starting empty.
export function resolveUserDataDir(appDataRoot: string, isPackaged: boolean): string {
  // Source and preview runs get a completely separate Electron profile. Return
  // before the legacy checks so development can never move production data.
  if (!isPackaged) return join(appDataRoot, DEV_APP_DIR)

  const dir = join(appDataRoot, APP_DIR)
  if (existsSync(dir)) return dir

  const legacy = join(appDataRoot, LEGACY_APP_DIR)
  if (!existsSync(legacy)) return dir

  try {
    renameSync(legacy, dir)
    return dir
  } catch {
    return legacy
  }
}

// `-wal` and `-shm` move with it, or uncheckpointed commits are stranded.
export function resolveDbPath(userDataDir: string): string {
  const current = join(userDataDir, DB_FILE)
  if (existsSync(current)) return current

  const legacy = join(userDataDir, LEGACY_DB_FILE)
  if (!existsSync(legacy)) return current

  try {
    for (const suffix of ['', '-wal', '-shm']) {
      if (existsSync(legacy + suffix)) renameSync(legacy + suffix, current + suffix)
    }
    return current
  } catch {
    return legacy
  }
}
