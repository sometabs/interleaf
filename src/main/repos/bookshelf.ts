import type { Database } from 'better-sqlite3'

import {
  EMPTY_BOOKSHELF_LAYOUT,
  parseBookshelfLayout,
  type BookshelfLayout
} from '../../shared/bookshelf'

export function getBookshelfLayout(db: Database): BookshelfLayout {
  const saved = db
    .prepare<[], { layout: string }>('SELECT layout FROM bookshelf_layout WHERE id = 1')
    .get()
  if (!saved) return EMPTY_BOOKSHELF_LAYOUT
  return parseBookshelfLayout(JSON.parse(saved.layout)) ?? EMPTY_BOOKSHELF_LAYOUT
}

export function saveBookshelfLayout(db: Database, raw: unknown): BookshelfLayout {
  const layout = parseBookshelfLayout(raw)
  if (layout === null) throw new Error('Invalid bookshelf layout.')
  db.prepare(
    `INSERT INTO bookshelf_layout (id, layout) VALUES (1, ?)
      ON CONFLICT (id) DO UPDATE SET layout = excluded.layout
      WHERE bookshelf_layout.layout <> excluded.layout`
  ).run(JSON.stringify(layout))
  return layout
}
