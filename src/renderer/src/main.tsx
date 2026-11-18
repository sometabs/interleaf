import { QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import App from './App'
import './assets/main.css'
import { createQueryClient } from './lib/queryClient'
import { SettingsProvider } from './lib/settings'
import { ViewProvider } from './lib/view'

const host = document.getElementById('app')
if (!host) throw new Error('Missing #app root element')

createRoot(host).render(
  <StrictMode>
    <QueryClientProvider client={createQueryClient()}>
      <ViewProvider>
        <SettingsProvider>
          <App />
        </SettingsProvider>
      </ViewProvider>
    </QueryClientProvider>
  </StrictMode>
)
