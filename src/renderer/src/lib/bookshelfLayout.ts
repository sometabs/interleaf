export interface Shelf {
  id: number
  name?: string
  itemIds: number[]
  positions: Record<number, number>
}

export const SHELF_DECORATIONS = {
  plant: { label: 'Plant', width: 48, height: 66 },
  'left-bookend': { label: 'Left bookend', width: 26, height: 58 },
  'right-bookend': { label: 'Right bookend', width: 26, height: 58 }
} as const

export type DecorationKind = keyof typeof SHELF_DECORATIONS

export interface ShelfDecoration {
  id: number
  kind: DecorationKind
}

interface SavedShelf extends Omit<Shelf, 'itemIds'> {
  bookIds: number[]
  decorations?: ShelfDecoration[]
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
        itemIds.add(id)
        decorations.push({ id, kind: kind as DecorationKind })
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
  origin = 0
): Shelf['positions'] {
  const positions: Shelf['positions'] = {}
  let nextLeft = 0
  let remaining = packedWidth(itemIds, widths)
  for (const id of itemIds) {
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
  const assigned = new Set(saved.flatMap((shelf) => shelf.itemIds))
  const added = [...widths.keys()]
    .filter((id) => !assigned.has(id))
    .sort((a, b) => Math.abs(a) - Math.abs(b))
  const initial: Shelf[] = saved.length ? saved : [{ id: 1, itemIds: [], positions: {} }]
  let nextId = Math.max(...initial.map((shelf) => shelf.id)) + 1

  const rows = initial.flatMap<Shelf>((shelf) => {
    let group: number[] = []
    const groups = [group]
    let nextLeft = 0
    for (const id of shelf.itemIds) {
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

    return groups.map((itemIds, index) => ({
      id: index === 0 ? shelf.id : nextId++,
      name: index === 0 ? shelf.name : undefined,
      itemIds,
      positions: fitPositions(
        itemIds,
        shelf.positions,
        widths,
        index === 0 ? 0 : (shelf.positions[itemIds[0]] ?? 0)
      )
    }))
  })

  let last = rows.at(-1)!
  for (const id of added) {
    const previous = last.itemIds.at(-1)
    let left =
      previous === undefined ? 0 : last.positions[previous] + widths.get(previous)! + SPINE_GAP
    if (left + widths.get(id)! > SHELF_SPAN) {
      last = { id: nextId++, itemIds: [], positions: {} }
      rows.push(last)
      left = 0
    }
    last.itemIds.push(id)
    last.positions[id] = left
  }
  return rows
}

export function shelfInsertion(
  shelf: Shelf,
  itemId: number,
  widths: ReadonlyMap<number, number>,
  desiredLeft: number,
  neighbor?: { itemId: number; after: boolean }
): Shelf | null {
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
  if (packedWidth(otherIds, widths) > SHELF_SPAN) return null
  return {
    ...shelf,
    itemIds: otherIds,
    positions: fitPositions(
      otherIds,
      { ...shelf.positions, [itemId]: Math.max(minimum, preferred) },
      widths
    )
  }
}
