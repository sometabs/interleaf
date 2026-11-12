import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import App from '../src/renderer/src/App'
import { installBridge, makeBook, renderApp } from './helpers/render'

describe('Settings', () => {
  it('applies theme and motion immediately and remembers both after reopening', async () => {
    installBridge()
    const first = renderApp(<App />)
    const user = userEvent.setup()
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(document.documentElement.dataset.motion).toBe('on')
    await user.click(screen.getByRole('button', { name: 'Settings' }))
    const dialog = await screen.findByRole('dialog', { name: 'Settings' })
    expect(within(dialog).getByRole('button', { name: 'Light', pressed: true })).toBeTruthy()
    await user.click(within(dialog).getByRole('button', { name: 'Dark' }))
    await user.click(within(dialog).getByRole('switch', { name: 'Motion', checked: true }))
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(document.documentElement.dataset.motion).toBe('off')
    expect(window.localStorage.getItem('interleaf.theme')).toBe('"dark"')
    expect(window.localStorage.getItem('interleaf.motionEnabled')).toBe('false')

    first.unmount()
    renderApp(<App />)
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(document.documentElement.dataset.motion).toBe('off')
    await user.click(screen.getByRole('button', { name: 'Settings' }))
    await user.click(screen.getByRole('button', { name: 'System' }))
    await user.click(screen.getByRole('switch', { name: 'Motion', checked: false }))
    expect(document.documentElement.dataset.theme).toBe('system')
    expect(document.documentElement.dataset.motion).toBe('on')
  })

  it('stays available when the sidebar is collapsed', async () => {
    installBridge()
    renderApp(<App />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Hide sidebar' }))
    await user.click(screen.getByRole('button', { name: 'Settings' }))
    await user.click(await screen.findByRole('button', { name: 'Dark' }))
    expect(document.documentElement.dataset.theme).toBe('dark')
  })

  it('dismisses with Escape without navigating away and returns focus', async () => {
    installBridge({ books: [makeBook({ title: 'Solaris', status: 'read' })] })
    renderApp(<App />)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: /^Solaris/ }))
    const trigger = screen.getByRole('button', { name: 'Settings' })
    await user.click(trigger)
    await screen.findByRole('dialog', { name: 'Settings' })
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Settings' })).toBeNull()
    expect(screen.getByRole('heading', { name: 'Solaris' })).toBeDefined()
    expect(document.activeElement).toBe(trigger)
  })

  it('shows the downloaded model even with Advanced turned off', async () => {
    window.localStorage.setItem('interleaf.advancedDownloadAcknowledged', 'true')
    installBridge(
      {},
      {
        getAppDiagnostics: async () => ({
          version: 'test',
          schemaVersion: 0,
          dataDirectory: '',
          advancedModelInstalled: true
        })
      }
    )
    renderApp(<App />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Settings' }))
    await screen.findByText('Downloaded')
    await user.click(
      screen.getByRole('switch', { name: 'Advanced recommendations', checked: true })
    )
    expect(
      screen.getByRole('switch', { name: 'Advanced recommendations', checked: false })
    ).toBeTruthy()
    expect(screen.getByText('Downloaded')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Remove model' })).toBeNull()
  })
})
