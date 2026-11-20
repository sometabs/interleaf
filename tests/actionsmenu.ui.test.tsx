import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import ActionsMenu from '../src/renderer/src/components/ActionsMenu'

function setup(): { refresh: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn> } {
  const refresh = vi.fn()
  const remove = vi.fn()
  render(
    <>
      <ActionsMenu
        label="More book actions"
        actions={[
          { label: 'Refresh metadata', onSelect: refresh },
          { label: 'Disabled thing', onSelect: vi.fn(), disabled: true },
          { label: 'Delete book', onSelect: remove, danger: true }
        ]}
      />
      <p>Outside</p>
    </>
  )
  return { refresh, remove }
}

describe('actions menu', () => {
  it('opens with the first action focused and runs the one picked', async () => {
    const user = userEvent.setup()
    const { remove } = setup()

    await user.click(screen.getByRole('button', { name: 'More book actions' }))

    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Refresh metadata' }))
    await user.click(screen.getByRole('menuitem', { name: 'Delete book' }))
    expect(remove).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('moves through actions with the arrow keys, skipping disabled ones', async () => {
    const user = userEvent.setup()
    const { remove } = setup()
    await user.click(screen.getByRole('button', { name: 'More book actions' }))

    await user.keyboard('{ArrowDown}')
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Delete book' }))
    await user.keyboard('{ArrowDown}')
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Refresh metadata' }))
    await user.keyboard('{ArrowUp}{Enter}')
    expect(remove).toHaveBeenCalledTimes(1)
  })

  // The app treats Escape as "go back", so the menu must take it first.
  it('closes on Escape without letting the key reach the app', async () => {
    const user = userEvent.setup()
    setup()
    const reachedApp = vi.fn()
    window.addEventListener('keydown', reachedApp)
    try {
      await user.click(screen.getByRole('button', { name: 'More book actions' }))
      await user.keyboard('{Escape}')

      expect(screen.queryByRole('menu')).toBeNull()
      expect(reachedApp).not.toHaveBeenCalled()
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'More book actions' }))
    } finally {
      window.removeEventListener('keydown', reachedApp)
    }
  })

  it('closes when clicking elsewhere', async () => {
    const user = userEvent.setup()
    const { refresh } = setup()
    await user.click(screen.getByRole('button', { name: 'More book actions' }))

    await user.click(screen.getByText('Outside'))

    expect(screen.queryByRole('menu')).toBeNull()
    expect(refresh).not.toHaveBeenCalled()
  })
})
