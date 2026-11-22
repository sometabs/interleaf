import { useSyncExternalStore } from 'react'

// Full screen shows only one element and what is inside it, so overlays must open there.
export function useOverlayContainer(): HTMLElement | undefined {
  return useSyncExternalStore(subscribe, current, () => undefined)
}

function current(): HTMLElement | undefined {
  const element = document.fullscreenElement
  return element instanceof HTMLElement ? element : undefined
}

function subscribe(listener: () => void): () => void {
  document.addEventListener('fullscreenchange', listener)
  return () => document.removeEventListener('fullscreenchange', listener)
}
