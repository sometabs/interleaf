import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useState,
  type ReactNode
} from 'react'

import { usePersistentState } from './persistent'

type Theme = 'light' | 'dark' | 'system'
type LibraryLayout = 'grid' | 'shelf'
type DiscoverLayout = 'grid' | 'tree'

interface Settings {
  theme: Theme
  setTheme: (value: Theme) => void
  motionEnabled: boolean
  setMotionEnabled: (value: boolean) => void
  libraryLayout: LibraryLayout
  setLibraryLayout: (value: LibraryLayout) => void
  discoverLayout: DiscoverLayout
  setDiscoverLayout: (value: DiscoverLayout) => void
  advancedEnabled: boolean
  downloadAcknowledged: boolean
  setAdvancedEnabled: (value: boolean) => void
}

const SettingsContext = createContext<Settings | null>(null)
const parseBoolean = (raw: unknown): boolean | null => (typeof raw === 'boolean' ? raw : null)

export function SettingsProvider({ children }: { children: ReactNode }): ReactNode {
  const [theme, setTheme] = usePersistentState<Theme>('interleaf.theme', 'light', (raw) =>
    raw === 'light' || raw === 'dark' || raw === 'system' ? raw : null
  )
  const [motionEnabled, setMotionEnabled] = usePersistentState(
    'interleaf.motionEnabled',
    true,
    parseBoolean
  )
  const [libraryLayout, setLibraryLayout] = usePersistentState<LibraryLayout>(
    'interleaf.libraryLayout',
    'grid',
    (raw) => (raw === 'grid' || raw === 'shelf' ? raw : null)
  )
  const [discoverLayout, setDiscoverLayout] = usePersistentState<DiscoverLayout>(
    'interleaf.recommendationLayout',
    'grid',
    (raw) => (raw === 'grid' || raw === 'tree' ? raw : null)
  )
  const [downloadAcknowledged, setDownloadAcknowledged] = usePersistentState(
    'interleaf.advancedDownloadAcknowledged',
    false,
    parseBoolean
  )
  const [hybridDisabled, setHybridDisabled] = usePersistentState(
    'interleaf.hybridDisabled',
    false,
    parseBoolean
  )

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme
    document.documentElement.dataset.motion = motionEnabled ? 'on' : 'off'
  }, [theme, motionEnabled])

  function setAdvancedEnabled(enabled: boolean): void {
    if (enabled && !downloadAcknowledged) setDownloadAcknowledged(true)
    setHybridDisabled(!enabled)
  }

  return (
    <SettingsContext.Provider
      value={{
        theme,
        setTheme,
        motionEnabled,
        setMotionEnabled,
        libraryLayout,
        setLibraryLayout,
        discoverLayout,
        setDiscoverLayout,
        advancedEnabled: downloadAcknowledged && !hybridDisabled,
        downloadAcknowledged,
        setAdvancedEnabled
      }}
    >
      {children}
    </SettingsContext.Provider>
  )
}

const DARK_QUERY = '(prefers-color-scheme: dark)'

function systemDark(): boolean {
  return window.matchMedia?.(DARK_QUERY).matches ?? false
}

// Whether the app is showing its dark colours right now, following the system when set to.
export function useAppDark(): boolean {
  const { theme } = useSettings()
  const [system, setSystem] = useState(systemDark)
  useEffect(() => {
    const query = window.matchMedia?.(DARK_QUERY)
    if (!query) return
    const onChange = (): void => setSystem(query.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])
  return theme === 'dark' || (theme === 'system' && system)
}

export function useSettings(): Settings {
  const settings = useContext(SettingsContext)
  if (!settings) throw new Error('Missing SettingsProvider')
  return settings
}
