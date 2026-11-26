import { useCallback, useState } from 'react'

// `localStorage`, not the database: these belong to this machine. Validated on read.
export function usePersistentState<T>(
  key: string,
  fallback: T,
  parse: (raw: unknown) => T | null
): [T, (next: T) => void] {
  const [value, setValue] = useState<T>(() => readPersistentState(key, parse) ?? fallback)

  const store = useCallback(
    (next: T) => {
      setValue(next)
      writePersistentState(key, next)
    },
    [key]
  )

  return [value, store]
}

export function readPersistentState<T>(key: string, parse: (raw: unknown) => T | null): T | null {
  try {
    const raw = window.localStorage.getItem(key)
    if (raw === null) return null
    return parse(JSON.parse(raw))
  } catch {
    return null
  }
}

export function writePersistentState(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // A full or disabled store costs the preference its persistence, which
    // is not worth breaking the interaction over.
  }
}
