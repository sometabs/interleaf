import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import Stats from '../src/renderer/src/components/Stats'
import { installBridge, makeBook, makeNote, renderApp } from './helpers/render'

describe('Stats', () => {
  it('shows local reading and journal information', async () => {
    const year = new Date().getFullYear()
    const finishedAt = Math.floor(new Date(year, 0, 12, 12).getTime() / 1000)
    installBridge({
      books: [
        makeBook({
          id: 1,
          status: 'read',
          pageCount: 320,
          rating: 5,
          finishedAt
        }),
        makeBook({ id: 2, title: 'A Wizard of Earthsea', status: 'read', pageCount: null })
      ],
      notes: [makeNote({ kind: 'review' }), makeNote({ id: 11, kind: 'highlight' })]
    })

    renderApp(<Stats />)

    expect(await screen.findByRole('heading', { name: 'Stats' })).toBeDefined()
    expect(screen.getByText('Based on 1 of 2 books with page counts')).toBeDefined()
    expect(screen.getByLabelText('Jan: 1 book')).toBeDefined()
    expect(screen.getByText('Ursula K. Le Guin')).toBeDefined()
    expect(screen.getByText('Reviews')).toBeDefined()
    expect(screen.getByText('Quotes')).toBeDefined()
  })
})
