import type Database from 'better-sqlite3'
import { app } from 'electron'
import { mkdirSync } from 'fs'

import { createDatabase } from './database'
import { resolveDbPath } from './userdata'

// The Electron-aware half of the data layer; `database.ts` imports no Electron.

let db: Database.Database | null = null

export function getDbPath(): string {
  return resolveDbPath(app.getPath('userData'))
}

export function getDb(): Database.Database {
  if (!db) throw new Error('Database not initialized. Call initDb() first.')
  return db
}

export function initDb(): Database.Database {
  if (db) return db
  mkdirSync(app.getPath('userData'), { recursive: true })
  db = createDatabase(getDbPath())
  return db
}

export function closeDb(): void {
  if (db) {
    db.close()
    db = null
  }
}
