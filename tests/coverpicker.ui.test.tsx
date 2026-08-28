import type { Book } from '@shared/api'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import ConfirmDialog from '../src/renderer/src/components/ConfirmDialog'
import CoverPicker from '../src/renderer/src/components/CoverPicker'
import { resetConfirm } from '../src/renderer/src/lib/confirm'
import { installBridge, makeBook, renderApp } from './helpers/render'

// Refreshing metadata only fetches when there is no cover at all, so without
// this a wrong jacket is permanent.
afterEach(resetConfirm)

function setup(book: Partial<Book> = {}): {
  chooseCover: ReturnType<typeof vi.fn>
  removeCover: ReturnType<typeof vi.fn>
} {
  const full = makeBook({ id: 1, ...book })
  const spies = {
    chooseCover: vi.fn(async () => ({ ...full, coverPath: 'book-1-abc.jpg' })),
    removeCover: vi.fn(async () => ({ ...full, coverPath: null }))
  }
  installBridge({ books: [full] }, spies)
  renderApp(
    <>
      <CoverPicker book={full} />
      <ConfirmDialog />
    </>
  )
  return spies
}

describe('the cover controls', () => {
  it('offers to add one when the book has no cover', async () => {
    setup({ coverPath: null })

    expect(await screen.findByRole('button', { name: 'Add cover' })).toBeDefined()
  })

  it('offers to change one when the book has a cover', async () => {
    setup({ coverPath: 'book-1-old.jpg' })

    expect(await screen.findByRole('button', { name: 'Change cover' })).toBeDefined()
  })

  it('does not offer to remove a cover that is not there', async () => {
    setup({ coverPath: null })

    await screen.findByRole('button', { name: 'Add cover' })
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull()
  })

  it('opens the picker when asked for a cover', async () => {
    const { chooseCover } = setup({ coverPath: null })

    await userEvent.click(await screen.findByRole('button', { name: 'Add cover' }))

    await waitFor(() => expect(chooseCover).toHaveBeenCalledWith(1))
  })

  it('asks before removing one', async () => {
    const { removeCover } = setup({ coverPath: 'book-1-old.jpg' })

    await userEvent.click(await screen.findByRole('button', { name: 'Remove' }))

    await screen.findByText('Remove this cover?')
    expect(removeCover).not.toHaveBeenCalled()
  })

  it('removes it once confirmed', async () => {
    const { removeCover } = setup({ coverPath: 'book-1-old.jpg' })

    await userEvent.click(await screen.findByRole('button', { name: 'Remove' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Remove cover' }))

    await waitFor(() => expect(removeCover).toHaveBeenCalledWith(1))
  })

  it('keeps the cover when the question is declined', async () => {
    const { removeCover } = setup({ coverPath: 'book-1-old.jpg' })

    await userEvent.click(await screen.findByRole('button', { name: 'Remove' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }))

    expect(removeCover).not.toHaveBeenCalled()
  })
})
