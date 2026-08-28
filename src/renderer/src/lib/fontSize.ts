import { useSyncExternalStore } from 'react'

// Module-level rather than per-component: a book page has several editors on
// screen, which component state would leave disagreeing until a reload.
export const FONT_SIZES = [
  { id: 'small', label: 'Small', px: 14 },
  { id: 'medium', label: 'Medium', px: 16 },
  { id: 'large', label: 'Large', px: 18 },
  { id: 'xlarge', label: 'Extra large', px: 21 }
] as const

export type FontSizeId = (typeof FONT_SIZES)[number]['id']

const KEY = 'interleaf.noteFontSize'

/** What the same preference was stored under before the app was renamed. */
const LEGACY_KEY = 'bookhook.noteFontSize'

const DEFAULT: FontSizeId = 'medium'

function isFontSize(value: unknown): value is FontSizeId {
  return FONT_SIZES.some((size) => size.id === value)
}

function load(): FontSizeId {
  try {
    const raw = window.localStorage.getItem(KEY)
    if (isFontSize(raw)) return raw

    // Only written by builds from before the rename; writes always use KEY.
    const legacy = window.localStorage.getItem(LEGACY_KEY)
    return isFontSize(legacy) ? legacy : DEFAULT
  } catch {
    return DEFAULT
  }
}

let current: FontSizeId = load()
const listeners = new Set<() => void>()

export function setNoteFontSize(id: FontSizeId): void {
  if (id === current) return
  current = id
  try {
    window.localStorage.setItem(KEY, id)
  } catch {
    // A full or disabled store costs the preference its persistence, which is
    // not worth breaking the interaction over.
  }
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useNoteFontSize(): FontSizeId {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => DEFAULT
  )
}

export function pixelsFor(id: FontSizeId): number {
  return FONT_SIZES.find((size) => size.id === id)?.px ?? 16
}
