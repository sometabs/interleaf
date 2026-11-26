import type { Database } from 'better-sqlite3'

import { parseLook, type ReaderLook } from '../../shared/readerLook'

export function getReaderLook(db: Database): ReaderLook | null {
  const saved = db.prepare<[], { look: string }>('SELECT look FROM reader_look WHERE id = 1').get()
  return saved ? parseLook(JSON.parse(saved.look)) : null
}

export function saveReaderLook(db: Database, raw: unknown): ReaderLook {
  const look = parseLook(raw)
  if (look === null) throw new Error('Invalid reader settings.')
  db.prepare(
    `INSERT INTO reader_look (id, look) VALUES (1, ?)
      ON CONFLICT (id) DO UPDATE SET look = excluded.look
      WHERE reader_look.look <> excluded.look`
  ).run(JSON.stringify(look))
  return look
}
