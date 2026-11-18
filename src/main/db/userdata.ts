import { join } from 'path'

const APP_DIR = 'Interleaf'
const DEV_APP_DIR = 'Interleaf Dev'
const DB_FILE = 'interleaf.db'

// Source and preview runs get their own profile, so development never touches the real library.
export function resolveUserDataDir(appDataRoot: string, isPackaged: boolean): string {
  return join(appDataRoot, isPackaged ? APP_DIR : DEV_APP_DIR)
}

export function resolveDbPath(userDataDir: string): string {
  return join(userDataDir, DB_FILE)
}
