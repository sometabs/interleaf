import { parseShelfBookIds, parseShelves, type BookshelfLayout } from '@shared/bookshelf'

import { readPersistentState } from './persistent'

const SHELVES = 'interleaf.bookshelves'
const ORDER = 'interleaf.bookshelfOrder'
const FACE_OUT = 'interleaf.bookshelfFaceOut'
const HIDDEN = 'interleaf.bookshelfHidden'

export function readLegacyBookshelf(): BookshelfLayout | undefined {
  const shelves =
    readPersistentState(SHELVES, null, parseShelves) ??
    readPersistentState(ORDER, null, parseShelves)
  const faceOutBookIds = readPersistentState(FACE_OUT, null, parseShelfBookIds)
  const hiddenBookIds = readPersistentState(HIDDEN, null, parseShelfBookIds)
  if (shelves === null && faceOutBookIds === null && hiddenBookIds === null) return undefined
  return {
    shelves: shelves ?? [],
    faceOutBookIds: faceOutBookIds ?? [],
    hiddenBookIds: hiddenBookIds ?? []
  }
}

export function clearLegacyBookshelf(): void {
  try {
    for (const key of [SHELVES, ORDER, FACE_OUT, HIDDEN]) window.localStorage.removeItem(key)
  } catch {
    // SQLite already has the layout. A later launch can retry removing these keys.
  }
}
