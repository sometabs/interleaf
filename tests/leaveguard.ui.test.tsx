import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it } from 'vitest'

import ConfirmDialog from '../src/renderer/src/components/ConfirmDialog'
import NewNoteView from '../src/renderer/src/components/NewNoteView'
import { resetConfirm } from '../src/renderer/src/lib/confirm'
import { useView } from '../src/renderer/src/lib/view'
import { installBridge, renderApp } from './helpers/render'

afterEach(() => resetConfirm())

// Stands in for the sidebar, the palette and Escape: anything that changes screen.
function Elsewhere(): ReactNode {
  const { view, navigate } = useView()
  return (
    <>
      <p data-testid="screen">{view.kind}</p>
      <button type="button" onClick={() => navigate({ kind: 'library' })}>
        Go to library
      </button>
    </>
  )
}

function renderDraft(): ReturnType<typeof userEvent.setup> {
  renderApp(
    <>
      <NewNoteView />
      <Elsewhere />
      <ConfirmDialog />
    </>,
    { kind: 'new-note' }
  )
  return userEvent.setup()
}

describe('leaving a screen with an unsaved draft', () => {
  it('asks before dropping it, and stays on Cancel', async () => {
    installBridge({ books: [], notes: [] })
    const user = renderDraft()

    await user.type(screen.getByLabelText('Note title'), 'Half a thought')
    await user.click(screen.getByRole('button', { name: 'Go to library' }))

    expect(await screen.findByText('Discard this draft?')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByTestId('screen').textContent).toBe('new-note')
    expect(screen.getByLabelText<HTMLInputElement>('Note title').value).toBe('Half a thought')
  })

  it('leaves once the draft is discarded', async () => {
    installBridge({ books: [], notes: [] })
    const user = renderDraft()

    await user.type(screen.getByLabelText('Note title'), 'Half a thought')
    await user.click(screen.getByRole('button', { name: 'Go to library' }))
    await user.click(await screen.findByRole('button', { name: 'Discard' }))

    await waitFor(() => expect(screen.getByTestId('screen').textContent).toBe('library'))
  })

  it('leaves at once when nothing was written', async () => {
    installBridge({ books: [], notes: [] })
    const user = renderDraft()

    await user.click(screen.getByRole('button', { name: 'Go to library' }))

    expect(screen.getByTestId('screen').textContent).toBe('library')
    expect(screen.queryByText('Discard this draft?')).toBeNull()
  })

  it('does not ask when Done saves the draft and leaves', async () => {
    const state = installBridge({ books: [], notes: [] })
    const user = renderDraft()

    await user.type(screen.getByLabelText('Note title'), 'A whole thought')
    await user.click(screen.getByRole('button', { name: 'Done' }))

    await waitFor(() => expect(state.created).toHaveLength(1))
    expect(screen.queryByText('Discard this draft?')).toBeNull()
  })
})
