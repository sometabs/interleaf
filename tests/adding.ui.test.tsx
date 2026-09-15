import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import AddBookDialog from '../src/renderer/src/components/AddBookDialog'
import Discover from '../src/renderer/src/components/Discover'
import RecommendationTree from '../src/renderer/src/components/RecommendationTree'
import { installBridge, makeBook, renderApp } from './helpers/render'

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

const OL_BOOK = {
  olid: 'OL1W',
  title: 'Dune',
  author: 'Frank Herbert',
  publishedYear: 1965,
  coverId: null,
  isbn: null,
  pageCount: null,
  subjects: [],
  languages: ['eng']
}

const REC = {
  olid: 'OL9W',
  title: 'Solaris',
  author: 'Stanisław Lem',
  coverId: null,
  score: 0.8,
  subjects: ['Science fiction'],
  becauseOf: null
}

describe('adding from the search dialog', () => {
  it('explains that an empty search found no books', async () => {
    const user = userEvent.setup()
    installBridge({}, { searchOpenLibrary: async () => [] })
    renderApp(<AddBookDialog open onOpenChange={() => {}} />)

    await user.type(screen.getByLabelText('Search for a book'), 'untranslated book')
    await user.click(screen.getByRole('button', { name: 'Search' }))

    await waitFor(() => expect(screen.getByText('No books found.')).toBeDefined())
  })

  it('marks the row it is working on, and only that row', async () => {
    const user = userEvent.setup()
    const slow = deferred<ReturnType<typeof makeBook>>()

    installBridge(
      {},
      {
        searchOpenLibrary: async () => [
          OL_BOOK,
          { ...OL_BOOK, olid: 'OL2W', title: 'Dune Messiah' }
        ],
        addBookFromOpenLibrary: () => slow.promise
      }
    )
    renderApp(<AddBookDialog open onOpenChange={() => {}} />)

    await user.type(screen.getByLabelText('Search for a book'), 'dune')
    await user.click(screen.getByRole('button', { name: 'Search' }))
    await waitFor(() => expect(screen.getByText('Dune Messiah')).toBeDefined())

    await user.click(screen.getByText('Dune'))

    await waitFor(() => expect(screen.getByLabelText('Adding Dune')).toBeDefined())
    expect(screen.getByText('Adding…')).toBeDefined()
    expect(screen.queryByLabelText('Adding Dune Messiah')).toBeNull()

    await act(async () => {
      slow.resolve(makeBook({ id: 1, title: 'Dune' }))
    })
  })

  it('keeps the results up so more than one can be taken from a search', async () => {
    const user = userEvent.setup()
    const closed = vi.fn()
    const added: string[] = []

    installBridge(
      {},
      {
        searchOpenLibrary: async () => [
          OL_BOOK,
          { ...OL_BOOK, olid: 'OL2W', title: 'Dune Messiah' }
        ],
        addBookFromOpenLibrary: async (dto) => {
          added.push(dto.title)
          return makeBook({ id: added.length, title: dto.title })
        }
      }
    )
    renderApp(<AddBookDialog open onOpenChange={closed} />)

    await user.type(screen.getByLabelText('Search for a book'), 'dune')
    await user.click(screen.getByRole('button', { name: 'Search' }))
    await waitFor(() => expect(screen.getByText('Dune Messiah')).toBeDefined())

    await user.click(screen.getByText('Dune'))
    await waitFor(() => expect(added).toEqual(['Dune']))

    expect(closed).not.toHaveBeenCalled()
    expect(screen.getByText('Dune Messiah')).toBeDefined()

    await user.click(screen.getByText('Dune Messiah'))
    await waitFor(() => expect(added).toEqual(['Dune', 'Dune Messiah']))
  })

  it('marks the rows it has already added and will not add them again', async () => {
    const user = userEvent.setup()
    const added: string[] = []

    installBridge(
      {},
      {
        searchOpenLibrary: async () => [
          OL_BOOK,
          { ...OL_BOOK, olid: 'OL2W', title: 'Dune Messiah' }
        ],
        addBookFromOpenLibrary: async (dto) => {
          added.push(dto.title)
          return makeBook({ id: added.length, title: dto.title })
        }
      }
    )
    renderApp(<AddBookDialog open onOpenChange={() => {}} />)

    await user.type(screen.getByLabelText('Search for a book'), 'dune')
    await user.click(screen.getByRole('button', { name: 'Search' }))
    await waitFor(() => expect(screen.getByText('Dune Messiah')).toBeDefined())

    await user.click(screen.getByText('Dune'))
    await waitFor(() => expect(screen.getByText('Added')).toBeDefined())

    await user.click(screen.getByText('Dune'))
    expect(added).toEqual(['Dune'])
  })

  it('shows nothing before anything is clicked', async () => {
    const user = userEvent.setup()
    installBridge({}, { searchOpenLibrary: async () => [OL_BOOK] })
    renderApp(<AddBookDialog open onOpenChange={() => {}} />)

    await user.type(screen.getByLabelText('Search for a book'), 'dune')
    await user.click(screen.getByRole('button', { name: 'Search' }))
    await waitFor(() => expect(screen.getByText('Dune')).toBeDefined())

    expect(screen.queryByLabelText('Adding Dune')).toBeNull()
  })
})

describe('adding from the Discover grid', () => {
  it('marks the card it is working on', async () => {
    const user = userEvent.setup()
    const slow = deferred<ReturnType<typeof makeBook>>()

    installBridge(
      { books: [makeBook({ id: 1, rating: 5 })] },
      {
        getRecommendations: async () => [REC, { ...REC, olid: 'OL8W', title: 'Roadside Picnic' }],
        getRecommendationTree: async () => [],
        saveRecommendation: () => slow.promise
      }
    )
    renderApp(<Discover />, { kind: 'discover' })

    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: 'Want to read' })).toHaveLength(2)
    )
    await user.click(screen.getAllByRole('button', { name: 'Want to read' })[0])

    await waitFor(() => expect(screen.getByLabelText('Adding Solaris')).toBeDefined())
    expect(screen.getByText('Adding…')).toBeDefined()
    expect(screen.getByRole('button', { name: /Adding/ })).toHaveProperty('disabled', true)
    expect(screen.queryByLabelText('Adding Roadside Picnic')).toBeNull()

    await act(async () => {
      slow.resolve(makeBook({ id: 2, title: 'Solaris' }))
    })
  })
})

describe('adding from the recommendation tree', () => {
  const node = {
    olid: 'OL9W',
    title: 'Solaris',
    author: 'Stanisław Lem',
    coverId: null,
    score: 0.8,
    subjects: ['Science fiction'],
    becauseOf: null,
    similarityToParent: null,
    depth: 0,
    children: []
  }

  it('replaces the add button with a spinner on that node alone', () => {
    installBridge()
    renderApp(
      <RecommendationTree
        roots={[node, { ...node, olid: 'OL8W', title: 'Roadside Picnic' }]}
        onSave={() => {}}
        onDismiss={() => {}}
        savingOlid="OL9W"
      />
    )

    expect(screen.getByLabelText('Adding Solaris')).toBeDefined()
    expect(screen.queryByLabelText('Want to read Solaris')).toBeNull()
    expect(screen.getByLabelText('Want to read Roadside Picnic')).toBeDefined()
  })

  it('shows every add button when nothing is being added', () => {
    installBridge()
    renderApp(
      <RecommendationTree roots={[node]} onSave={() => {}} onDismiss={() => {}} savingOlid={null} />
    )

    expect(screen.getByLabelText('Want to read Solaris')).toBeDefined()
    expect(screen.queryByLabelText('Adding Solaris')).toBeNull()
  })
})

// jsdom loads no stylesheet, so these read the CSS as text.
describe('the spinner itself', () => {
  async function css(): Promise<string> {
    const fs = await import('node:fs')
    return fs.readFileSync('src/renderer/src/assets/main.css', 'utf8')
  }

  it('turns slowly, not once a second', async () => {
    const match = /--spin-duration:\s*([\d.]+)s/.exec(await css())

    expect(match).not.toBeNull()
    expect(Number(match?.[1])).toBeGreaterThanOrEqual(2)
  })

  it('keeps the duration in one place', async () => {
    const source = await css()
    const literals = source.match(/animation:\s*interleaf-spin\s+[\d.]+s/g) ?? []

    expect(literals).toHaveLength(0)
    expect(source.match(/animation:\s*interleaf-spin\s+var\(--spin-duration\)/g)).toHaveLength(2)
  })

  // Reduced motion flattens animations to 0.01ms, which speeds an infinite one
  // up rather than slowing it: the repeat has to stop too.
  it('stops animations repeating when motion is reduced', async () => {
    const source = await css()
    const block = /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\n {2}\}/.exec(source)

    expect(block).not.toBeNull()
    expect(block?.[0]).toContain('animation-duration: 0.01ms !important')
    expect(block?.[0]).toContain('animation-iteration-count: 1 !important')
  })

  // Exempted from the rule above: a frozen ring indicates nothing.
  it('keeps spinning even when motion is reduced', async () => {
    const source = await css()
    const block = /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\n {2}\}/.exec(source)

    expect(block?.[0]).toMatch(
      /\.spinner \{[\s\S]*?animation: interleaf-spin var\(--spin-duration\)[\s\S]*?!important/
    )
  })
})
