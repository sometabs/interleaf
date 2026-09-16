import type { CalibreImportPlan } from '@shared/api'
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

export type View =
  | { kind: 'library' }
  | { kind: 'queue' }
  | { kind: 'book'; id: number }
  | { kind: 'note'; id: number }
  | { kind: 'notes' }
  | { kind: 'reviews' }
  | { kind: 'review'; id: number }
  | { kind: 'quotes' }
  // Set when the screen was opened from one book: Discover then ranks against
  // that book alone.
  | { kind: 'discover'; likeBookId?: number }
  | { kind: 'data' }
  // The plan travels with the view: it is read from a file, not from the
  // library, so nothing else can fetch it back.
  | { kind: 'import'; plan: CalibreImportPlan }

// Beside the union, so a new screen cannot be added without naming it.
export const SCREEN_NAMES: Record<View['kind'], string> = {
  library: 'Library',
  queue: 'Reading queue',
  book: 'Back',
  note: 'Back',
  notes: 'Notes',
  reviews: 'Reviews',
  review: 'Back',
  quotes: 'Quotes',
  discover: 'Discover',
  data: 'Data',
  import: 'Import'
}

interface Navigation {
  view: View
  /** The screen `back` would return to, so a control can name it. */
  previous: View | null
  navigate: (view: View) => void
  back: () => void
}

const ViewContext = createContext<Navigation | null>(null)

// A single value, not a router: there are no URLs in a desktop app.
export function ViewProvider({
  children,
  initial = { kind: 'library' }
}: {
  children: ReactNode
  initial?: View
}): ReactNode {
  const [history, setHistory] = useState<View[]>([initial])

  const navigate = useCallback((next: View) => {
    setHistory((current) => [...current.slice(-19), next])
  }, [])

  const back = useCallback(() => {
    setHistory((current) => (current.length > 1 ? current.slice(0, -1) : current))
  }, [])

  const value = useMemo<Navigation>(
    () => ({
      view: history[history.length - 1],
      previous: history[history.length - 2] ?? null,
      navigate,
      back
    }),
    [history, navigate, back]
  )

  return <ViewContext.Provider value={value}>{children}</ViewContext.Provider>
}

export function useView(): Navigation {
  const value = useContext(ViewContext)
  if (!value) throw new Error('useView must be used inside a ViewProvider')
  return value
}
