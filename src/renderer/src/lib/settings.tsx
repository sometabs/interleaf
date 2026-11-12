import { createContext, useContext, useLayoutEffect, type ReactNode } from 'react'

import { usePersistentState } from './persistent'

type Theme = 'light' | 'dark' | 'system'
type DiscoverLayout = 'grid' | 'tree'

interface Settings {
  theme: Theme
  setTheme: (value: Theme) => void
  motionEnabled: boolean
  setMotionEnabled: (value: boolean) => void
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

export function useSettings(): Settings {
  const settings = useContext(SettingsContext)
  if (!settings) throw new Error('Missing SettingsProvider')
  return settings
}
