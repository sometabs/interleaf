import { useCallback, useState } from 'react'

// `localStorage`, not the database: these belong to this machine. Validated on
// read, and `legacyKey` covers a key written before the app was renamed.
export function usePersistentState<T>(
  key: string,
  fallback: T,
  parse: (raw: unknown) => T | null,
  legacyKey?: string
): [T, (next: T) => void] {
  const [value, setValue] = useState<T>(() => {
    const stored = readPersistentState(key, null, parse)
    if (stored !== null) return stored
    return legacyKey ? readPersistentState(legacyKey, fallback, parse) : fallback
  })

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

export function readPersistentState<T>(
  key: string,
  fallback: T,
  parse: (raw: unknown) => T | null
): T {
  try {
    const raw = window.localStorage.getItem(key)
    if (raw === null) return fallback
    return parse(JSON.parse(raw)) ?? fallback
  } catch {
    return fallback
  }
}
