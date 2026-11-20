import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { describe, expect, it } from 'vitest'

import ContinueReading from '../src/renderer/src/components/ContinueReading'
import { useView } from '../src/renderer/src/lib/view'
import { installBridge, makeBook, renderApp } from './helpers/render'

function Where(): ReactNode {
  const { view } = useView()
  return <p data-testid="where">{JSON.stringify(view)}</p>
}

const books = [
  makeBook({ id: 1, title: 'The Glass Orchard', author: 'Mira Halden' }),
  makeBook({ id: 2, title: 'Salt and Cinder', author: 'Ines Varga' })
]

describe('continue reading', () => {
  it('shows recently read books with their progress, and continues straight into the reader', async () => {
    const user = userEvent.setup()
    installBridge(
      { books },
      { recentReading: async () => [{ bookId: 2, fraction: 0.41, updatedAt: 200 }] }
    )
    renderApp(
      <>
        <ContinueReading />
        <Where />
      </>
    )

    expect(
      await screen.findByRole('progressbar', { name: 'Salt and Cinder: 41% read' })
    ).toBeDefined()
    expect(screen.queryByText('The Glass Orchard')).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(JSON.parse(screen.getByTestId('where').textContent!)).toEqual({
      kind: 'reader',
      bookId: 2
    })
  })

  it('opens the book page from the rest of the card', async () => {
    const user = userEvent.setup()
    installBridge(
      { books },
      { recentReading: async () => [{ bookId: 1, fraction: 0.2, updatedAt: 100 }] }
    )
    renderApp(
      <>
        <ContinueReading />
        <Where />
      </>
    )

    await user.click(await screen.findByRole('button', { name: 'Open The Glass Orchard' }))
    expect(JSON.parse(screen.getByTestId('where').textContent!)).toEqual({ kind: 'book', id: 1 })
  })

  it('stays out of the way when nothing is being read', async () => {
    installBridge({ books })
    renderApp(<ContinueReading />)

    await screen.findByText((_, element) => element === document.body)
    expect(screen.queryByRole('heading', { name: 'Continue reading' })).toBeNull()
  })
})
