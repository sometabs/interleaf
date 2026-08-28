import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'

import ConfirmDialog from '../src/renderer/src/components/ConfirmDialog'
import NoteView from '../src/renderer/src/components/NoteView'
import { confirm, resetConfirm } from '../src/renderer/src/lib/confirm'
import { installBridge, makeNote, renderApp } from './helpers/render'

afterEach(() => resetConfirm())

describe('the confirmation itself', () => {
  it('resolves true only when the confirm button is pressed', async () => {
    const user = userEvent.setup()
    render(<ConfirmDialog />)

    const answered = confirm({ title: 'Delete this?', confirmLabel: 'Delete' })
    await waitFor(() => expect(screen.getByRole('alertdialog')).toBeDefined())

    await user.click(screen.getByRole('button', { name: 'Delete' }))
    expect(await answered).toBe(true)
  })

  it('resolves false when cancelled', async () => {
    const user = userEvent.setup()
    render(<ConfirmDialog />)

    const answered = confirm({ title: 'Delete this?' })
    await waitFor(() => expect(screen.getByRole('alertdialog')).toBeDefined())

    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(await answered).toBe(false)
  })

  it('resolves false on Escape', async () => {
    const user = userEvent.setup()
    render(<ConfirmDialog />)

    const answered = confirm({ title: 'Delete this?' })
    await waitFor(() => expect(screen.getByRole('alertdialog')).toBeDefined())

    await user.keyboard('{Escape}')
    expect(await answered).toBe(false)
  })

  // Radix lands focus on Cancel in an alert dialog, which is why this is one:
  // a held Enter must not delete the library.
  it('starts with the focus on Cancel, so Enter means no', async () => {
    const user = userEvent.setup()
    render(<ConfirmDialog />)

    const answered = confirm({ title: 'Delete this?', destructive: true })
    await waitFor(() => expect(screen.getByRole('alertdialog')).toBeDefined())

    await user.keyboard('{Enter}')
    expect(await answered).toBe(false)
  })

  it('shows the question and what it costs', async () => {
    render(<ConfirmDialog />)
    void confirm({ title: 'Delete “Dune”?', body: 'All 3 notes go with it.' })

    await waitFor(() => expect(screen.getByText('Delete “Dune”?')).toBeDefined())
    expect(screen.getByText('All 3 notes go with it.')).toBeDefined()
  })

  it('renders nothing while nobody is asking', () => {
    render(<ConfirmDialog />)
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('cancels a question that a second one replaces', async () => {
    render(<ConfirmDialog />)
    const first = confirm({ title: 'First?' })
    void confirm({ title: 'Second?' })

    expect(await first).toBe(false)
    await waitFor(() => expect(screen.getByText('Second?')).toBeDefined())
  })
})

describe('deleting a note', () => {
  it('asks first, and keeps the note when the answer is no', async () => {
    const user = userEvent.setup()
    const bridge = installBridge({ notes: [makeNote({ id: 10, title: 'On walls' })] })
    renderApp(
      <>
        <NoteView noteId={10} />
        <ConfirmDialog />
      </>,
      { kind: 'note', id: 10 }
    )

    await waitFor(() => expect(screen.getByText('On walls')).toBeDefined())
    await user.click(screen.getByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(screen.getByText('Delete “On walls”?')).toBeDefined())
    expect(bridge.deleted).toEqual([])

    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(bridge.deleted).toEqual([])
  })

  it('deletes when the answer is yes', async () => {
    const user = userEvent.setup()
    const bridge = installBridge({ notes: [makeNote({ id: 10, title: 'On walls' })] })
    renderApp(
      <>
        <NoteView noteId={10} />
        <ConfirmDialog />
      </>,
      { kind: 'note', id: 10 }
    )

    await waitFor(() => expect(screen.getByText('On walls')).toBeDefined())
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    await user.click(screen.getByRole('button', { name: 'Delete note' }))

    await waitFor(() => expect(bridge.deleted).toEqual([10]))
  })
})
