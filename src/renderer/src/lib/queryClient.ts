import { MutationCache, QueryClient } from '@tanstack/react-query'

import { fail } from './feedback'

export function createQueryClient(): QueryClient {
  return new QueryClient({
    // Every failed write surfaces as a banner without a try/catch at the call
    // site. Reads fail quietly: a stale list beats an alarm.
    mutationCache: new MutationCache({ onError: (error) => fail(error) }),
    defaultOptions: {
      queries: {
        // Reads are local SQLite over IPC and only this process writes, so
        // refetching on focus would burst on every alt-tab for nothing.
        refetchOnWindowFocus: false,
        staleTime: 30_000,
        retry: false,
        // Everything goes to the local database; the default pauses while the system reports no network.
        networkMode: 'always'
      },
      mutations: { networkMode: 'always' }
    }
  })
}
