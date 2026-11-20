import { existsSync, readFileSync, writeFileSync } from 'fs'
import { isAbsolute, join } from 'path'

// Outside the database on purpose: recovery has to find the backups when the database is the
// thing that is broken.
const FILE = 'settings.json'

interface MainSettings {
  backupFolder?: string
}

export function readMainSettings(userData: string): MainSettings {
  const path = join(userData, FILE)
  if (!existsSync(path)) return {}
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<MainSettings>
    const folder = raw.backupFolder
    return typeof folder === 'string' && isAbsolute(folder) ? { backupFolder: folder } : {}
  } catch {
    return {}
  }
}

export function writeMainSettings(userData: string, settings: MainSettings): void {
  writeFileSync(join(userData, FILE), JSON.stringify(settings, null, 2), 'utf8')
}
