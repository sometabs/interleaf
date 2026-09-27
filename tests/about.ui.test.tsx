import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import App from '../src/renderer/src/App'
import { installBridge, renderApp } from './helpers/render'

const DIAGNOSTICS = {
  version: '1.8.8',
  dataDirectory: 'C:\\Users\\reader\\Interleaf',
  schemaVersion: 19,
  advancedModelInstalled: true
}

describe('About & diagnostics', () => {
  it('checks Open Library only after opening and reuses the recent result', async () => {
    const checkOpenLibrary = vi.fn().mockResolvedValue(true)
    installBridge(
      {},
      {
        getAppDiagnostics: async () => DIAGNOSTICS,
        checkOpenLibrary
      }
    )
    renderApp(<App />)
    const user = userEvent.setup()

    expect(checkOpenLibrary).not.toHaveBeenCalled()
    await user.click(await screen.findByRole('button', { name: 'About & diagnostics' }))

    expect(await screen.findByText('Available')).toBeDefined()
    expect(screen.getByText('1.8.8')).toBeDefined()
    expect(screen.getByText('Downloaded')).toBeDefined()
    expect(checkOpenLibrary).toHaveBeenCalledOnce()

    await user.click(screen.getByRole('button', { name: 'Close' }))
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'About & diagnostics' })).toBeNull()
    )
    await user.click(screen.getByRole('button', { name: 'About & diagnostics' }))
    await screen.findByText('Available')
    expect(checkOpenLibrary).toHaveBeenCalledOnce()

    await user.click(screen.getByRole('button', { name: 'Check again' }))
    await waitFor(() => expect(checkOpenLibrary).toHaveBeenCalledTimes(2))
  })

  it('does not contact Open Library when the device reports being offline', async () => {
    vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false)
    const checkOpenLibrary = vi.fn().mockResolvedValue(true)
    installBridge(
      {},
      {
        getAppDiagnostics: async () => DIAGNOSTICS,
        checkOpenLibrary
      }
    )
    renderApp(<App />)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'About & diagnostics' }))

    expect(await screen.findByText('Not checked — offline')).toBeDefined()
    expect(checkOpenLibrary).not.toHaveBeenCalled()
  })
})
