import type { RecommendationScope } from '@shared/api'

import { usePersistentState } from './persistent'

// Remembered between visits, hence not component state.
const KEY = 'interleaf.discover.filters'

/** What the same preference was stored under before the app was renamed. */
const LEGACY_KEY = 'bookhook.discover.filters'

/** Anything unrecognised is dropped rather than trusted. */
function parse(raw: unknown): RecommendationScope | null {
  // Older builds wrote the scope bare, and as one field of a wider object.
  const value =
    typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>).scope : raw

  if (value === 'same-authors') return 'same-authors'
  return value === 'all' ? 'all' : null
}

export function useDiscoverScope(): [RecommendationScope, (next: RecommendationScope) => void] {
  const [scope, setScope] = usePersistentState<RecommendationScope>(KEY, 'all', parse, LEGACY_KEY)
  return [scope, setScope]
}
