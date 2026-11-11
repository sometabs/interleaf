import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import App from '../src/renderer/src/App'
import { installBridge, makeBook, renderApp } from './helpers/render'

describe('Appearance', () => {
  it('defaults to light, switches immediately and remembers the selection after reopening', async () => {
    installBridge()
    const first = renderApp(<App />)
    const user = userEvent.setup()
    expect(document.documentElement.dataset.theme).toBe('light')
    await user.click(screen.getByRole('button', { name: 'Appearance' }))
    const popover = await screen.findByRole('dialog', { name: 'Appearance' })
    expect(
      within(popover).getByRole('button', { name: 'Light' }).getAttribute('aria-pressed')
    ).toBe('true')
    await user.click(within(popover).getByRole('button', { name: 'Dark' }))
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(window.localStorage.getItem('interleaf.theme')).toBe('"dark"')
    expect(screen.queryByRole('dialog', { name: 'Appearance' })).toBeNull()

    first.unmount()
    renderApp(<App />)
    expect(document.documentElement.dataset.theme).toBe('dark')
    await user.click(screen.getByRole('button', { name: 'Appearance' }))
    expect(screen.getByRole('button', { name: 'Dark' }).getAttribute('aria-pressed')).toBe('true')

    await user.click(screen.getByRole('button', { name: 'System' }))
    expect(document.documentElement.dataset.theme).toBe('system')
    expect(window.localStorage.getItem('interleaf.theme')).toBe('"system"')
  })

  it('keeps appearance available when the sidebar is collapsed', async () => {
    installBridge()
    renderApp(<App />)
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Hide sidebar' }))
    await user.click(screen.getByRole('button', { name: 'Appearance' }))
    await user.click(await screen.findByRole('button', { name: 'Dark' }))
    expect(document.documentElement.dataset.theme).toBe('dark')
    await user.click(screen.getByRole('button', { name: 'Show sidebar' }))
    expect(screen.getByRole('button', { name: 'Appearance' }).textContent).toContain('Dark')
  })

  it('dismisses outside and with Escape without navigating away, and returns keyboard focus', async () => {
    installBridge({ books: [makeBook({ title: 'Solaris', status: 'read' })] })
    renderApp(<App />)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: /^Solaris/ }))
    await user.click(screen.getByRole('button', { name: 'Appearance' }))
    const selected = await screen.findByRole('button', { name: 'Light' })
    expect(document.activeElement).toBe(selected)
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Appearance' })).toBeNull()
    expect(screen.getByRole('heading', { name: 'Solaris' })).toBeDefined()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Appearance' }))

    await user.click(screen.getByRole('button', { name: 'Appearance' }))
    await screen.findByRole('dialog', { name: 'Appearance' })
    await user.click(screen.getByRole('heading', { name: 'Solaris' }))
    expect(screen.queryByRole('dialog', { name: 'Appearance' })).toBeNull()
    expect(screen.getByRole('heading', { name: 'Solaris' })).toBeDefined()
  })
})
