export interface SavedShelf {
  id: number
  name?: string
  positions: Record<number, number>
  bookIds: number[]
  stacks?: { id: number; bookIds: number[] }[]
}

export interface BookshelfLayout {
  shelves: SavedShelf[]
  faceOutBookIds: number[]
  hiddenBookIds: number[]
}

export const EMPTY_BOOKSHELF_LAYOUT: BookshelfLayout = {
  shelves: [],
  faceOutBookIds: [],
  hiddenBookIds: []
}

function isId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

export function parseShelfBookIds(raw: unknown): number[] | null {
  return Array.isArray(raw) ? [...new Set(raw.filter(isId))] : null
}

export function parseShelves(raw: unknown): SavedShelf[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null

  // The earlier shelf saved a single book order. Keep it when dividing into rows.
  if (raw.every(isId)) return [{ id: 1, bookIds: [...new Set(raw)], positions: {} }]

  const shelves: SavedShelf[] = []
  const shelfIds = new Set<number>()
  const bookIds = new Set<number>()
  const stackIds = new Set<number>()
  for (const shelf of raw) {
    if (!shelf || !isId(shelf.id) || shelfIds.has(shelf.id) || !Array.isArray(shelf.bookIds)) {
      return null
    }
    shelfIds.add(shelf.id)
    const ordered: number[] = []
    const positions: SavedShelf['positions'] = {}
    for (const id of shelf.bookIds) {
      if (!isId(id) || bookIds.has(id)) continue
      bookIds.add(id)
      ordered.push(id)
      const left: unknown = shelf.positions?.[id]
      if (typeof left === 'number' && Number.isSafeInteger(left) && left >= 0) positions[id] = left
    }
    const name = typeof shelf.name === 'string' ? shelf.name.trim() : ''
    const stacks: NonNullable<SavedShelf['stacks']> = []
    const available = new Set(ordered)
    if (Array.isArray(shelf.stacks)) {
      for (const stack of shelf.stacks) {
        const id = stack?.id
        if (
          !Number.isSafeInteger(id) ||
          id >= 0 ||
          stackIds.has(id) ||
          !Array.isArray(stack.bookIds)
        ) {
          continue
        }
        const members = stack.bookIds.filter(
          (bookId: unknown) => isId(bookId) && available.delete(bookId)
        )
        if (!members.length) continue
        stacks.push({ id, bookIds: members })
        stackIds.add(id)
        const left: unknown = shelf.positions?.[id]
        if (typeof left === 'number' && Number.isSafeInteger(left) && left >= 0)
          positions[id] = left
      }
    }
    shelves.push({ id: shelf.id, name: name || undefined, bookIds: ordered, positions, stacks })
  }
  return shelves
}

export function parseBookshelfLayout(raw: unknown): BookshelfLayout | null {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Partial<BookshelfLayout>
  const shelves =
    Array.isArray(value.shelves) && value.shelves.length === 0 ? [] : parseShelves(value.shelves)
  const faceOutBookIds = parseShelfBookIds(value.faceOutBookIds)
  const hiddenBookIds = parseShelfBookIds(value.hiddenBookIds)
  return shelves && faceOutBookIds && hiddenBookIds
    ? { shelves, faceOutBookIds, hiddenBookIds }
    : null
}
