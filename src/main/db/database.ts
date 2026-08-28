import Database from 'better-sqlite3'

import { toPlainText } from '../../shared/plaintext'
import init001 from './migrations/001_init.sql?raw'
import lang002 from './migrations/002_candidate_language.sql?raw'
import noteTag003 from './migrations/003_note_tag_column.sql?raw'
import titles004 from './migrations/004_plain_note_titles.sql?raw'
import genres005 from './migrations/005_book_genres.sql?raw'
import reharvest006 from './migrations/006_reharvest_candidates.sql?raw'
import feedbackTitles007 from './migrations/007_feedback_titles.sql?raw'
import upperTags008 from './migrations/008_uppercase_note_tags.sql?raw'
import preferences009 from './migrations/009_preferences.sql?raw'
import editions010 from './migrations/010_candidate_editions.sql?raw'
import dropPreferences011 from './migrations/011_drop_preferences.sql?raw'
import appSettings012 from './migrations/012_app_settings.sql?raw'
import dropAppSettings013 from './migrations/013_drop_app_settings.sql?raw'

// Append only: the index is the version number, so editing a shipped entry
// breaks every database that has already run it.
export const MIGRATIONS: string[] = [
  init001,
  lang002,
  noteTag003,
  titles004,
  genres005,
  reharvest006,
  feedbackTitles007,
  upperTags008,
  preferences009,
  editions010,
  dropPreferences011,
  appSettings012,
  dropAppSettings013
]

/** SQLite has no regex, so migrations that clean up text need this. */
function registerFunctions(db: Database.Database): void {
  db.function('strip_markdown', { deterministic: true }, (value: unknown) =>
    typeof value === 'string' ? toPlainText(value) : value
  )
}

/** Imports no Electron, so tests can open a `:memory:` database directly. */
export function createDatabase(filePath: string): Database.Database {
  const db = new Database(filePath)

  // WAL reads alongside a write and survives crashes better than the default
  // rollback journal. A no-op for :memory:.
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')
  db.pragma('foreign_keys = ON')

  registerFunctions(db)
  applyMigrations(db)
  return db
}

function applyMigrations(db: Database.Database): void {
  const current = db.pragma('user_version', { simple: true }) as number

  if (current > MIGRATIONS.length) {
    throw new Error(
      `Database schema version ${current} is newer than this build understands ` +
        `(${MIGRATIONS.length}). Refusing to open it, because a downgrade would corrupt data.`
    )
  }

  for (let version = current; version < MIGRATIONS.length; version++) {
    // exec() cannot run inside a prepared transaction, so bracket manually.
    db.exec('BEGIN')
    try {
      db.exec(MIGRATIONS[version])
      // A pragma value cannot be bound; `version` is a loop integer.
      db.pragma(`user_version = ${version + 1}`)
      db.exec('COMMIT')
    } catch (err) {
      db.exec('ROLLBACK')
      throw new Error(`Migration ${version + 1} failed: ${(err as Error).message}`, { cause: err })
    }
  }
}
