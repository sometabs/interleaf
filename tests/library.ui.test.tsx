import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import Library from '../src/renderer/src/components/Library'
import { installBridge, makeBook, renderApp } from './helpers/render'

// The grouping rules themselves are covered in `shelves.test.ts`.

const SOLARIS = makeBook({ id: 1, title: 'Solaris', author: 'Stanisław Lem', status: 'read' })
const PICNIC = makeBook({
  id: 2,
  title: 'Roadside Picnic',
  author: 'Strugatsky',
  status: 'reading'
})
const HALL = makeBook({ id: 3, title: 'Wolf Hall', author: 'Hilary Mantel', status: 'want' })

const SUBJECTS = [
  { bookId: 1, subjects: ['Science fiction'] },
  { bookId: 2, subjects: ['Science fiction'] },
  { bookId: 3, subjects: ['Great Britain', 'History'] }
]

function show(subjects = SUBJECTS): ReturnType<typeof userEvent.setup> {
  installBridge({ books: [SOLARIS, PICNIC, HALL], subjects })
  renderApp(<Library onAdd={() => {}} />)
  return userEvent.setup()
}

// Shelf headings read "Label · count" and are the only h2 on the page.
async function headings(): Promise<string[]> {
  const found = await screen.findAllByRole('heading', { level: 2 })
  return found.map((node) => node.textContent ?? '')
}

describe('grouping the library', () => {
  it('groups by status until told otherwise', async () => {
    show()

    expect(await headings()).toEqual(['Reading · 1', 'Want to read · 1', 'Read · 1'])
  })

  it('regroups by category on request', async () => {
    const user = show()

    await user.click(await screen.findByRole('radio', { name: 'Category' }))

    expect(await headings()).toEqual(['Science Fiction · 2', 'History · 1'])
  })

  it('regroups alphabetically on request, ignoring a leading article', async () => {
    const user = show()

    await user.click(await screen.findByRole('radio', { name: 'A–Z' }))

    expect(await headings()).toEqual(['R · 1', 'S · 1', 'W · 1'])
  })

  it('marks the active grouping for assistive technology', async () => {
    const user = show()
    const control = await screen.findByRole('radiogroup', { name: 'Group by' })

    await user.click(within(control).getByRole('radio', { name: 'Category' }))

    expect(within(control).getByRole('radio', { name: 'Category' })).toHaveProperty(
      'ariaChecked',
      'true'
    )
    expect(within(control).getByRole('radio', { name: 'Status' })).toHaveProperty(
      'ariaChecked',
      'false'
    )
  })

  it('goes back to status without losing a book', async () => {
    const user = show()

    await user.click(await screen.findByRole('radio', { name: 'A–Z' }))
    await user.click(await screen.findByRole('radio', { name: 'Status' }))

    expect(await headings()).toEqual(['Reading · 1', 'Want to read · 1', 'Read · 1'])
  })
})

describe('filtering inside a grouping', () => {
  it('narrows the shelves rather than the covers', async () => {
    const user = show()

    await user.click(await screen.findByRole('radio', { name: 'Category' }))
    await user.type(screen.getByLabelText('Filter library'), 'wolf')

    await waitFor(async () => expect(await headings()).toEqual(['History · 1']))
    expect(screen.queryByText('Solaris')).toBeNull()
  })

  it('says so when nothing matches', async () => {
    const user = show()

    await user.type(await screen.findByLabelText('Filter library'), 'zzz')

    expect(await screen.findByText(/Nothing matches/)).toBeTruthy()
  })
})

describe('a library Open Library has never seen', () => {
  it('explains the empty category view instead of filing everything blind', async () => {
    const user = show([])

    await user.click(await screen.findByRole('radio', { name: 'Category' }))

    expect(await screen.findByText(/no subjects yet/)).toBeTruthy()
  })

  it('stays quiet when the books do have subjects', async () => {
    const user = show()

    await user.click(await screen.findByRole('radio', { name: 'Category' }))
    await screen.findByText('Science Fiction · 2')

    expect(screen.queryByText(/no subjects yet/)).toBeNull()
  })

  it('tells a failed load apart from an empty one', async () => {
    // A main process older than the renderer: the channel exists in the preload
    // but nothing answers it, which must not read as "no subjects".
    installBridge(
      { books: [SOLARIS, HALL] },
      {
        listBookSubjects: async () => {
          throw new Error("No handler registered for 'listBookSubjects'")
        }
      }
    )
    renderApp(<Library onAdd={() => {}} />)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('radio', { name: 'Category' }))

    expect(await screen.findByText(/could not be loaded/)).toBeTruthy()
    expect(screen.queryByText(/no subjects yet/)).toBeNull()
  })

  it('stays quiet when subjects are known but none of them names a genre', async () => {
    // Both have subjects but neither names a genre, so both fall back.
    installBridge({
      books: [SOLARIS, HALL],
      subjects: [
        { bookId: 1, subjects: ['Accessible book'] },
        { bookId: 3, subjects: ['Tudor England'] }
      ]
    })
    renderApp(<Library onAdd={() => {}} />)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('radio', { name: 'Category' }))
    await screen.findByText('Non-fiction · 2')

    expect(screen.queryByText(/no subjects yet/)).toBeNull()
  })
})

describe('filtering by group, then by genre', () => {
  const MEMOIR = makeBook({ id: 4, title: "Can't Hurt Me", author: 'David Goggins' })
  const MIXED = [SOLARIS, PICNIC, HALL, MEMOIR]
  const MIXED_SUBJECTS = [
    { bookId: 1, subjects: ['Science fiction'] },
    { bookId: 2, subjects: ['Science fiction', 'Suspense'] },
    { bookId: 3, subjects: ['Historical fiction'] },
    { bookId: 4, subjects: ['Athletes, biography', 'Triathlon'] }
  ]

  async function openCategory(): Promise<ReturnType<typeof userEvent.setup>> {
    installBridge({ books: MIXED, subjects: MIXED_SUBJECTS })
    renderApp(<Library onAdd={() => {}} />)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('radio', { name: 'Category' }))
    return user
  }

  async function genreChips(): Promise<string[]> {
    const row = await screen.findByRole('group', { name: 'Genre' })
    return within(row)
      .getAllByRole('button')
      .map((node) => node.textContent ?? '')
  }

  it('offers the two groups only in the category view', async () => {
    const user = await openCategory()
    expect(screen.getByRole('radiogroup', { name: 'Group' })).toBeTruthy()

    await user.click(screen.getByRole('radio', { name: 'Status' }))

    expect(screen.queryByRole('radiogroup', { name: 'Group' })).toBeNull()
    expect(screen.queryByRole('group', { name: 'Genre' })).toBeNull()
  })

  it('narrows to fiction, and the genre row follows', async () => {
    const user = await openCategory()

    await user.click(screen.getByRole('radio', { name: 'Fiction' }))

    await waitFor(async () =>
      expect(await genreChips()).toEqual([
        'All genres',
        'Science Fiction',
        'Historical Fiction',
        'Thriller & Suspense'
      ])
    )
    expect(screen.queryByText("Can't Hurt Me")).toBeNull()
  })

  it('offers only the other half under non-fiction', async () => {
    const user = await openCategory()

    await user.click(screen.getByRole('radio', { name: 'Non-fiction' }))

    await waitFor(async () =>
      expect(await genreChips()).toEqual(['All genres', 'Biography & Memoir', 'Sports'])
    )
    expect(await headings()).toEqual(['Biography & Memoir · 1', 'Sports · 1'])
  })

  it('then narrows to a single genre, shown as one shelf', async () => {
    const user = await openCategory()

    await user.click(screen.getByRole('radio', { name: 'Fiction' }))
    await user.click(await screen.findByRole('button', { name: 'Thriller & Suspense' }))

    expect(await headings()).toEqual(['Thriller & Suspense · 1'])
    // The title appears twice per card: on the cover and beneath it.
    expect(screen.getAllByText('Roadside Picnic').length).toBeGreaterThan(0)
    expect(screen.queryByText('Solaris')).toBeNull()
  })

  it('clears the genre when the group changes, so no empty grid can appear', async () => {
    const user = await openCategory()

    await user.click(screen.getByRole('radio', { name: 'Fiction' }))
    await user.click(await screen.findByRole('button', { name: 'Science Fiction' }))
    await user.click(screen.getByRole('radio', { name: 'Non-fiction' }))

    expect(await headings()).toEqual(['Biography & Memoir · 1', 'Sports · 1'])
  })

  it('forgets the genre when the group changes, rather than reviving it later', async () => {
    const user = await openCategory()

    await user.click(await screen.findByRole('button', { name: 'Science Fiction' }))
    await user.click(screen.getByRole('radio', { name: 'Non-fiction' }))
    await user.click(screen.getByRole('radio', { name: 'Fiction' }))

    await waitFor(async () =>
      expect(await headings()).toEqual([
        'Science Fiction · 2',
        'Historical Fiction · 1',
        'Thriller & Suspense · 1'
      ])
    )
    expect(await screen.findByRole('button', { name: 'All genres' })).toHaveProperty(
      'ariaPressed',
      'true'
    )
  })

  it('drops a genre that the search box has filtered out of existence', async () => {
    const user = await openCategory()

    await user.click(await screen.findByRole('button', { name: 'Thriller & Suspense' }))
    await user.type(screen.getByLabelText('Filter library'), 'solaris')

    // The selected genre no longer exists here, so it must fall back to what
    // does match rather than to an empty page.
    await waitFor(async () => expect(await headings()).toEqual(['Science Fiction · 1']))
  })

  it('toggles a genre off when it is pressed again', async () => {
    const user = await openCategory()

    await user.click(await screen.findByRole('button', { name: 'Science Fiction' }))
    expect(await headings()).toEqual(['Science Fiction · 2'])

    await user.click(await screen.findByRole('button', { name: 'Science Fiction' }))
    expect((await headings()).length).toBeGreaterThan(1)
  })
})
