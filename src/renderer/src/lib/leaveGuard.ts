import { useEffect, useRef } from 'react'

import { confirm } from './confirm'

// Drafts exist only on screen until Done, so any way of leaving the screen would
// drop them: Escape, the sidebar, the palette, a link.
const drafts = new Set<{ current: () => boolean }>()

/** Asked at the moment of leaving, so a save already under way can answer no. */
export function useUnsavedDraft(unsaved: () => boolean): void {
  const latest = useRef(unsaved)
  useEffect(() => {
    latest.current = unsaved
  })
  useEffect(() => {
    drafts.add(latest)
    return () => {
      drafts.delete(latest)
    }
  }, [])
}

/** Runs `go` at once, or after the user agrees to drop an unsaved draft. */
export function leaveScreen(go: () => void): void {
  if (![...drafts].some((draft) => draft.current())) {
    go()
    return
  }
  void confirm({
    title: 'Discard this draft?',
    body: 'It has not been saved.',
    confirmLabel: 'Discard',
    destructive: true
  }).then((discard) => {
    if (discard) go()
  })
}
