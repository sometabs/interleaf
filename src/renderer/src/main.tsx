import { MutationCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import App from './App'
import './assets/main.css'
import { fail } from './lib/feedback'
import { ViewProvider } from './lib/view'

function createClient(): QueryClient {
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
        retry: false
      }
    }
  })
}

const host = document.getElementById('app')
if (!host) throw new Error('Missing #app root element')

createRoot(host).render(
  <StrictMode>
    <QueryClientProvider client={createClient()}>
      <ViewProvider>
        <App />
      </ViewProvider>
    </QueryClientProvider>
  </StrictMode>
)
