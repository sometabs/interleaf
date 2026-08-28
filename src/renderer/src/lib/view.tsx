import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

export type View =
  | { kind: 'library' }
  | { kind: 'book'; id: number }
  | { kind: 'note'; id: number }
  | { kind: 'notes' }
  | { kind: 'quotes' }
  | { kind: 'discover' }
  | { kind: 'data' }

interface Navigation {
  view: View
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
    () => ({ view: history[history.length - 1], navigate, back }),
    [history, navigate, back]
  )

  return <ViewContext.Provider value={value}>{children}</ViewContext.Provider>
}

export function useView(): Navigation {
  const value = useContext(ViewContext)
  if (!value) throw new Error('useView must be used inside a ViewProvider')
  return value
}
