export interface Shelf {
  id: number
  name?: string
  itemIds: number[]
  positions: Record<number, number>
}

export interface ShelfRow extends Pick<Shelf, 'itemIds' | 'positions'> {
  start: number
  origin: number
}

export const SHELF_DECORATIONS = {
  plant: { label: 'Plant', width: 48, height: 66 },
  'left-bookend': { label: 'Left bookend', width: 26, height: 58 },
  'right-bookend': { label: 'Right bookend', width: 26, height: 58 },
  'quote-frame': { label: 'Quote frame', width: 120, height: 94 }
} as const

export type DecorationKind = keyof typeof SHELF_DECORATIONS

export type ShelfDecoration =
  | { id: number; kind: Exclude<DecorationKind, 'quote-frame'> }
  | { id: number; kind: 'quote-frame'; quoteId: number }

interface SavedShelf extends Omit<Shelf, 'itemIds'> {
  bookIds: number[]
  decorations?: ShelfDecoration[]
}

export const DEFAULT_SHELF_SPAN = 628
const SPINE_GAP = 0

export function spineWidth(pageCount: number | null): number {
  const pages = Math.max(0, pageCount ?? 250)
  // Leave room for both labels and taper the increase for longer books.
  return 34 + Math.round((40 * pages) / (pages + 900))
}

function isId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

export function parseFaceOutBooks(raw: unknown): number[] | null {
  return Array.isArray(raw) ? [...new Set(raw.filter(isId))] : null
}

export function parseShelves(raw: unknown): SavedShelf[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null

  // The earlier shelf saved a single book order. Keep it when dividing into rows.
  if (raw.every(isId)) return [{ id: 1, bookIds: [...new Set(raw)], positions: {} }]

  const shelves: SavedShelf[] = []
  const shelfIds = new Set<number>()
  const itemIds = new Set<number>()
  for (const shelf of raw) {
    if (!shelf || !isId(shelf.id) || shelfIds.has(shelf.id) || !Array.isArray(shelf.bookIds)) {
      return null
    }
    shelfIds.add(shelf.id)
    const bookIds: number[] = []
    const decorations: ShelfDecoration[] = []
    const positions: Shelf['positions'] = {}
    for (const id of shelf.bookIds) {
      if (!isId(id) || itemIds.has(id)) continue
      itemIds.add(id)
      bookIds.push(id)
    }
    if (Array.isArray(shelf.decorations)) {
      for (const decoration of shelf.decorations) {
        const id = decoration?.id
        const kind = decoration?.kind
        // Book IDs are positive. Decorations use negative IDs in the same layout.
        if (
          !Number.isSafeInteger(id) ||
          id >= 0 ||
          itemIds.has(id) ||
          typeof kind !== 'string' ||
          !Object.hasOwn(SHELF_DECORATIONS, kind)
        ) {
          continue
        }
        if (kind === 'quote-frame') {
          const quoteId: unknown = decoration.quoteId
          if (!isId(quoteId)) continue
          decorations.push({ id, kind, quoteId })
        } else {
          decorations.push({ id, kind: kind as Exclude<DecorationKind, 'quote-frame'> })
        }
        itemIds.add(id)
      }
    }
    for (const id of [...bookIds, ...decorations.map(({ id }) => id)]) {
      const left: unknown = shelf.positions?.[id]
      if (typeof left === 'number' && Number.isSafeInteger(left) && left >= 0) positions[id] = left
    }
    const name = typeof shelf.name === 'string' ? shelf.name.trim() : ''
    shelves.push({ id: shelf.id, name: name || undefined, bookIds, decorations, positions })
  }
  return shelves
}

export function restoreShelf({ id, name, bookIds, decorations, positions }: SavedShelf): Shelf {
  // Undecorated shelves can have a legacy order without positions.
  const itemIds = decorations?.length
    ? [...bookIds, ...decorations.map(({ id }) => id)].sort(
        (a, b) => (positions[a] ?? 0) - (positions[b] ?? 0)
      )
    : bookIds
  return { id, name, itemIds, positions }
}

export function saveShelves(
  shelves: Shelf[],
  decorations: ReadonlyMap<number, ShelfDecoration>
): SavedShelf[] {
  return shelves.map(({ id, name, itemIds, positions }) => ({
    id,
    name,
    bookIds: itemIds.filter((itemId) => itemId > 0),
    decorations: itemIds.flatMap((itemId) => decorations.get(itemId) ?? []),
    positions
  }))
}

function packedWidth(itemIds: number[], widths: ReadonlyMap<number, number>): number {
  return Math.max(
    0,
    itemIds.reduce((total, id) => total + widths.get(id)! + SPINE_GAP, -SPINE_GAP)
  )
}

function fitPositions(
  itemIds: number[],
  preferred: Shelf['positions'],
  widths: ReadonlyMap<number, number>,
  span: number,
  origin = 0
): Shelf['positions'] {
  const positions: Shelf['positions'] = {}
  let nextLeft = 0
  let remaining = packedWidth(itemIds, widths)
  for (const id of itemIds) {
    // Preserve the saved gap when there is still room for the rest of the row.
    const left = Math.min(span - remaining, Math.max(nextLeft, (preferred[id] ?? 0) - origin))
    positions[id] = left
    const step = widths.get(id)! + SPINE_GAP
    nextLeft = left + step
    remaining -= step
  }
  return positions
}

export function arrangeShelves(saved: Shelf[], widths: ReadonlyMap<number, number>): Shelf[] {
  const assigned = new Set(saved.flatMap((shelf) => shelf.itemIds))
  const added = [...widths.keys()]
    .filter((id) => !assigned.has(id))
    .sort((a, b) => Math.abs(a) - Math.abs(b))
  const initial: Shelf[] = saved.length ? saved : [{ id: 1, itemIds: [], positions: {} }]
  return initial.map((shelf, index) => {
    const itemIds = shelf.itemIds.filter((id) => widths.has(id))
    if (index === initial.length - 1) itemIds.push(...added)
    return {
      ...shelf,
      itemIds,
      positions: fitPositions(itemIds, shelf.positions, widths, Infinity)
    }
  })
}

export function wrapShelf(
  shelf: Shelf,
  widths: ReadonlyMap<number, number>,
  span: number
): ShelfRow[] {
  const rows: ShelfRow[] = []
  let start = 0
  let used = 0
  function addRow(end: number): void {
    const itemIds = shelf.itemIds.slice(start, end)
    const previous = shelf.itemIds[start - 1]
    const origin = start === 0 ? 0 : shelf.positions[previous] + widths.get(previous)!
    rows.push({
      start,
      origin,
      itemIds,
      positions: fitPositions(itemIds, shelf.positions, widths, span, origin)
    })
    start = end
    used = 0
  }

  shelf.itemIds.forEach((id, index) => {
    const width = widths.get(id)!
    if (used > 0 && used + width > span) {
      addRow(index)
    }
    used += width + SPINE_GAP
  })
  addRow(shelf.itemIds.length)
  return rows
}

export function shelfInsertion(
  shelf: ShelfRow,
  itemId: number,
  widths: ReadonlyMap<number, number>,
  span: number,
  desiredLeft: number,
  neighbor?: { itemId: number; after: boolean }
): ShelfRow | null {
  const otherIds = shelf.itemIds.filter((id) => id !== itemId)
  const target = neighbor
    ? otherIds.indexOf(neighbor.itemId)
    : otherIds.findIndex((id) => shelf.positions[id] >= desiredLeft)
  const index = target < 0 ? otherIds.length : target + Number(neighbor?.after ?? false)
  const previous = otherIds[index - 1]
  const minimum =
    previous === undefined ? 0 : shelf.positions[previous] + widths.get(previous)! + SPINE_GAP
  const preferred = neighbor
    ? neighbor.after
      ? minimum
      : shelf.positions[neighbor.itemId] - widths.get(itemId)! - SPINE_GAP
    : desiredLeft
  otherIds.splice(index, 0, itemId)
  if (packedWidth(otherIds, widths) > span) return null
  return {
    ...shelf,
    itemIds: otherIds,
    positions: fitPositions(
      otherIds,
      { ...shelf.positions, [itemId]: Math.max(minimum, preferred) },
      widths,
      span
    )
  }
}
