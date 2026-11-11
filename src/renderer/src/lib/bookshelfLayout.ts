export interface Shelf {
  id: number
  bookIds: number[]
  positions: Record<number, number>
}

export const SHELF_SPAN = 628
const SPINE_GAP = 0

export function spineWidth(pageCount: number | null): number {
  const pages = Math.max(0, pageCount ?? 250)
  // Leave room for both labels and taper the increase for longer books.
  return 34 + Math.round((40 * pages) / (pages + 900))
}

function isId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

export function parseShelves(raw: unknown): Shelf[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null

  // The earlier shelf saved a single book order. Keep it when dividing into rows.
  if (raw.every(isId)) return [{ id: 1, bookIds: [...new Set(raw)], positions: {} }]

  const shelves: Shelf[] = []
  const shelfIds = new Set<number>()
  const bookIds = new Set<number>()
  for (const shelf of raw) {
    if (!shelf || !isId(shelf.id) || shelfIds.has(shelf.id) || !Array.isArray(shelf.bookIds)) {
      return null
    }
    shelfIds.add(shelf.id)
    const ordered: number[] = []
    const positions: Shelf['positions'] = {}
    for (const id of shelf.bookIds) {
      if (!isId(id) || bookIds.has(id)) continue
      bookIds.add(id)
      ordered.push(id)
      const left: unknown = shelf.positions?.[id]
      if (typeof left === 'number' && Number.isSafeInteger(left) && left >= 0) positions[id] = left
    }
    shelves.push({ id: shelf.id, bookIds: ordered, positions })
  }
  return shelves
}

function packedWidth(bookIds: number[], widths: ReadonlyMap<number, number>): number {
  return Math.max(
    0,
    bookIds.reduce((total, id) => total + widths.get(id)! + SPINE_GAP, -SPINE_GAP)
  )
}

function fitPositions(
  bookIds: number[],
  preferred: Shelf['positions'],
  widths: ReadonlyMap<number, number>,
  origin = 0
): Shelf['positions'] {
  const positions: Shelf['positions'] = {}
  let nextLeft = 0
  let remaining = packedWidth(bookIds, widths)
  for (const id of bookIds) {
    // Preserve the saved gap when there is still room for the rest of the row.
    const left = Math.min(SHELF_SPAN - remaining, Math.max(nextLeft, (preferred[id] ?? 0) - origin))
    positions[id] = left
    const step = widths.get(id)! + SPINE_GAP
    nextLeft = left + step
    remaining -= step
  }
  return positions
}

export function arrangeShelves(saved: Shelf[], widths: ReadonlyMap<number, number>): Shelf[] {
  const assigned = new Set(saved.flatMap((shelf) => shelf.bookIds))
  const added = [...widths.keys()].filter((id) => !assigned.has(id)).sort((a, b) => a - b)
  const initial: Shelf[] = saved.length ? saved : [{ id: 1, bookIds: [], positions: {} }]
  let nextId = Math.max(...initial.map((shelf) => shelf.id)) + 1

  const rows = initial.flatMap((shelf) => {
    let group: number[] = []
    const groups = [group]
    let nextLeft = 0
    for (const id of shelf.bookIds) {
      const width = widths.get(id)
      if (width === undefined) continue
      if (nextLeft + width > SHELF_SPAN) {
        group = []
        groups.push(group)
        nextLeft = 0
      }
      group.push(id)
      nextLeft += width + SPINE_GAP
    }

    return groups.map((bookIds, index) => ({
      id: index === 0 ? shelf.id : nextId++,
      bookIds,
      positions: fitPositions(
        bookIds,
        shelf.positions,
        widths,
        index === 0 ? 0 : (shelf.positions[bookIds[0]] ?? 0)
      )
    }))
  })

  let last = rows.at(-1)!
  for (const id of added) {
    const previous = last.bookIds.at(-1)
    let left =
      previous === undefined ? 0 : last.positions[previous] + widths.get(previous)! + SPINE_GAP
    if (left + widths.get(id)! > SHELF_SPAN) {
      last = { id: nextId++, bookIds: [], positions: {} }
      rows.push(last)
      left = 0
    }
    last.bookIds.push(id)
    last.positions[id] = left
  }
  return rows
}

export function shelfInsertion(
  shelf: Shelf,
  bookId: number,
  widths: ReadonlyMap<number, number>,
  desiredLeft: number,
  neighbor?: { bookId: number; after: boolean }
): Shelf | null {
  const otherIds = shelf.bookIds.filter((id) => id !== bookId)
  const target = neighbor
    ? otherIds.indexOf(neighbor.bookId)
    : otherIds.findIndex((id) => shelf.positions[id] >= desiredLeft)
  const index = target < 0 ? otherIds.length : target + Number(neighbor?.after ?? false)
  const previous = otherIds[index - 1]
  const minimum =
    previous === undefined ? 0 : shelf.positions[previous] + widths.get(previous)! + SPINE_GAP
  const preferred = neighbor
    ? neighbor.after
      ? minimum
      : shelf.positions[neighbor.bookId] - widths.get(bookId)! - SPINE_GAP
    : desiredLeft
  otherIds.splice(index, 0, bookId)
  if (packedWidth(otherIds, widths) > SHELF_SPAN) return null
  return {
    id: shelf.id,
    bookIds: otherIds,
    positions: fitPositions(
      otherIds,
      { ...shelf.positions, [bookId]: Math.max(minimum, preferred) },
      widths
    )
  }
}
