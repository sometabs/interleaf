export interface Shelf {
  id: number
  name?: string
  slotIds: number[]
  positions: Record<number, number>
}

interface SavedShelf extends Omit<Shelf, 'slotIds'> {
  bookIds: number[]
  stacks?: { id: number; bookIds: number[] }[]
}

export interface ShelfBookSize {
  uprightWidth: number
  spineLength: number
  thickness: number
}

export type ShelfStacks = ReadonlyMap<number, number[]>

export const SHELF_SPAN = 628
export const STACK_HEIGHT = 188
const SPINE_GAP = 0

export function spineWidth(pageCount: number | null): number {
  const pages = Math.max(0, pageCount ?? 250)
  // Leave room for both labels and taper the increase for longer books.
  return 34 + Math.round((40 * pages) / (pages + 900))
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
    const positions: Shelf['positions'] = {}
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

export function unpackShelves(
  saved: SavedShelf[],
  sizes: ReadonlyMap<number, ShelfBookSize>
): {
  rows: Shelf[]
  stacks: ShelfStacks
} {
  const stacks = new Map<number, number[]>()
  const rows = saved.map(({ id, name, bookIds, positions, stacks: savedStacks }) => {
    const slotByBook = new Map<number, number>()
    for (const stack of savedStacks ?? []) {
      const members: number[] = []
      let height = 0
      for (const bookId of stack.bookIds) {
        const size = sizes.get(bookId)
        if (!size) continue
        // A page-count change can make a previously saved stack too tall.
        if (height + size.thickness > STACK_HEIGHT) break
        height += size.thickness
        members.push(bookId)
        slotByBook.set(bookId, stack.id)
      }
      if (members.length) stacks.set(stack.id, members)
    }
    const slotIds = [...new Set(bookIds.map((bookId) => slotByBook.get(bookId) ?? bookId))]
    return { id, name, slotIds, positions }
  })
  return { rows, stacks }
}

export function packShelves(rows: Shelf[], stacks: ShelfStacks): SavedShelf[] {
  return rows.map(({ id, name, slotIds, positions }) => {
    const bookIds: number[] = []
    const savedStacks: NonNullable<SavedShelf['stacks']> = []
    const savedPositions = { ...positions }
    for (const slotId of slotIds) {
      const members = stacks.get(slotId)
      if (members) {
        savedStacks.push({ id: slotId, bookIds: members })
        bookIds.push(...members)
        // Older versions can still show these books upright at the stack's position.
        for (const bookId of members) savedPositions[bookId] = positions[slotId]
      } else bookIds.push(slotId)
    }
    return { id, name, bookIds, positions: savedPositions, stacks: savedStacks }
  })
}

export function shelfWidths(
  sizes: ReadonlyMap<number, ShelfBookSize>,
  stacks: ShelfStacks
): Map<number, number> {
  const widths = new Map([...sizes].map(([id, size]) => [id, size.uprightWidth]))
  for (const [id, members] of stacks) {
    widths.set(id, Math.max(...members.map((bookId) => sizes.get(bookId)!.spineLength)))
    for (const bookId of members) widths.delete(bookId)
  }
  return widths
}

export function stackHeight(bookIds: number[], sizes: ReadonlyMap<number, ShelfBookSize>): number {
  return bookIds.reduce((height, id) => height + sizes.get(id)!.thickness, 0)
}

export function stackForBook(stacks: ShelfStacks, bookId: number): number | undefined {
  for (const [id, members] of stacks) if (members.includes(bookId)) return id
  return undefined
}

export function nextStackId(stacks: ShelfStacks, reservedId = 0): number {
  return Math.min(0, reservedId, ...stacks.keys()) - 1
}

export function detachShelfBook(
  rows: Shelf[],
  stacks: ShelfStacks,
  bookId: number
): {
  rows: Shelf[]
  stacks: ShelfStacks
} {
  const stackId = stackForBook(stacks, bookId)
  let removedSlot = bookId
  let nextStacks = stacks
  if (stackId !== undefined) {
    const members = stacks.get(stackId)!.filter((id) => id !== bookId)
    const updated = new Map(stacks)
    if (members.length) updated.set(stackId, members)
    else {
      updated.delete(stackId)
      removedSlot = stackId
    }
    nextStacks = updated
  }
  return {
    rows: rows.map((row) =>
      row.slotIds.includes(removedSlot)
        ? { ...row, slotIds: row.slotIds.filter((id) => id !== removedSlot) }
        : row
    ),
    stacks: nextStacks
  }
}

function packedWidth(slotIds: number[], widths: ReadonlyMap<number, number>): number {
  return Math.max(
    0,
    slotIds.reduce((total, id) => total + widths.get(id)! + SPINE_GAP, -SPINE_GAP)
  )
}

function fitPositions(
  slotIds: number[],
  preferred: Shelf['positions'],
  widths: ReadonlyMap<number, number>,
  origin = 0
): Shelf['positions'] {
  const positions: Shelf['positions'] = {}
  let nextLeft = 0
  let remaining = packedWidth(slotIds, widths)
  for (const id of slotIds) {
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
  const assigned = new Set(saved.flatMap((shelf) => shelf.slotIds))
  const added = [...widths.keys()].filter((id) => !assigned.has(id)).sort((a, b) => a - b)
  const initial: Shelf[] = saved.length ? saved : [{ id: 1, slotIds: [], positions: {} }]
  let nextId = Math.max(...initial.map((shelf) => shelf.id)) + 1

  const rows = initial.flatMap<Shelf>((shelf) => {
    let group: number[] = []
    const groups = [group]
    let nextLeft = 0
    for (const id of shelf.slotIds) {
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

    return groups.map((slotIds, index) => ({
      id: index === 0 ? shelf.id : nextId++,
      name: index === 0 ? shelf.name : undefined,
      slotIds,
      positions: fitPositions(
        slotIds,
        shelf.positions,
        widths,
        index === 0 ? 0 : (shelf.positions[slotIds[0]] ?? 0)
      )
    }))
  })

  let last = rows.at(-1)!
  for (const id of added) {
    const previous = last.slotIds.at(-1)
    let left =
      previous === undefined ? 0 : last.positions[previous] + widths.get(previous)! + SPINE_GAP
    if (left + widths.get(id)! > SHELF_SPAN) {
      last = { id: nextId++, slotIds: [], positions: {} }
      rows.push(last)
      left = 0
    }
    last.slotIds.push(id)
    last.positions[id] = left
  }
  return rows
}

export function shelfInsertion(
  shelf: Shelf,
  slotId: number,
  widths: ReadonlyMap<number, number>,
  desiredLeft: number,
  neighbor?: { slotId: number; after: boolean }
): Shelf | null {
  const otherIds = shelf.slotIds.filter((id) => id !== slotId)
  const target = neighbor
    ? otherIds.indexOf(neighbor.slotId)
    : otherIds.findIndex((id) => shelf.positions[id] >= desiredLeft)
  const index = target < 0 ? otherIds.length : target + Number(neighbor?.after ?? false)
  const previous = otherIds[index - 1]
  const minimum =
    previous === undefined ? 0 : shelf.positions[previous] + widths.get(previous)! + SPINE_GAP
  const preferred = neighbor
    ? neighbor.after
      ? minimum
      : shelf.positions[neighbor.slotId] - widths.get(slotId)! - SPINE_GAP
    : desiredLeft
  otherIds.splice(index, 0, slotId)
  if (packedWidth(otherIds, widths) > SHELF_SPAN) return null
  return {
    ...shelf,
    slotIds: otherIds,
    positions: fitPositions(
      otherIds,
      { ...shelf.positions, [slotId]: Math.max(minimum, preferred) },
      widths
    )
  }
}
