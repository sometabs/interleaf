import { useCallback, useState } from 'react'

// `localStorage`, not the database: these belong to this machine. Validated on read.
export function usePersistentState<T>(
  key: string,
  fallback: T,
  parse: (raw: unknown) => T | null
): [T, (next: T) => void] {
  const [value, setValue] = useState<T>(() => readPersistentState(key, fallback, parse))

  const store = useCallback(
    (next: T) => {
      setValue(next)
      try {
        window.localStorage.setItem(key, JSON.stringify(next))
      } catch {
        // A full or disabled store costs the preference its persistence, which
        // is not worth breaking the interaction over.
      }
    },
    [key]
  )

  return [value, store]
}

function readPersistentState<T>(key: string, fallback: T, parse: (raw: unknown) => T | null): T {
  try {
    const raw = window.localStorage.getItem(key)
    if (raw === null) return fallback
    return parse(JSON.parse(raw)) ?? fallback
  } catch {
    return fallback
  }
}
