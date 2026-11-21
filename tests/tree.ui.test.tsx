import type { RecommendationNode } from '@shared/api'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import RecommendationTree from '../src/renderer/src/components/RecommendationTree'
import { installBridge, renderApp } from './helpers/render'

function node(
  olid: string,
  score: number,
  depth: number,
  children: RecommendationNode[] = [],
  similarityToParent: number | null = null
): RecommendationNode {
  return {
    olid,
    title: `Book ${olid}`,
    author: 'Someone',
    editionOlid: null,
    coverId: null,
    isbn: null,
    pageCount: null,
    publishedYear: null,
    description: null,
    score,
    becauseOf: { bookId: 1, title: 'The Dispossessed' },
    subjects: ['Science fiction'],
    similarityToParent,
    depth,
    children
  }
}

const tree = [
  node('root', 0.9, 0, [
    node('child-a', 0.7, 1, [node('grandchild', 0.4, 2, [], 0.55)], 0.8),
    node('child-b', 0.6, 1, [], 0.6)
  ])
]

function show(roots = tree, onSave = vi.fn()): ReturnType<typeof userEvent.setup> {
  installBridge()
  renderApp(
    <RecommendationTree roots={roots} onSave={onSave} onDismiss={() => {}} savingOlid={null} />
  )
  return userEvent.setup()
}

const titles = (column: string): string[] =>
  Array.from(
    screen.getByRole('region', { name: column }).querySelectorAll('[data-testid=tree-node]'),
    (row) => row.querySelector('.font-medium')?.textContent ?? ''
  )

describe('RecommendationTree', () => {
  it('opens on the top pick, with the books like it beside it', () => {
    show()

    expect(titles('Closest to your taste')).toEqual(['Book root'])
    expect(titles('Like Book root')).toEqual(['Book child-a', 'Book child-b'])
  })

  it('opens the books like a book in the next column when it is chosen', async () => {
    const user = show()

    await user.click(screen.getByRole('button', { name: /^Book child-a/, pressed: false }))

    expect(titles('Like Book child-a')).toEqual(['Book grandchild'])
    expect(screen.getByRole('button', { name: /^Book child-a/, pressed: true })).toBeDefined()
  })

  it('closes the deeper column when another branch is chosen', async () => {
    const user = show()
    await user.click(screen.getByRole('button', { name: /^Book child-a/ }))

    await user.click(screen.getByRole('button', { name: /^Book child-b/ }))

    expect(screen.queryByRole('region', { name: 'Like Book child-a' })).toBeNull()
  })

  // One meaning per number: likeness to the book chosen in the column before.
  it('calls the first book the top pick and gives every other book its likeness', () => {
    show()

    const rows = screen.getAllByTestId('tree-node')
    const root = rows.find((row) => row.textContent?.includes('Book root'))!
    expect(root.textContent).toContain('Top pick')
    expect(root.title).toContain('90% match with your taste')
    expect(rows.find((row) => row.textContent?.includes('Book child-a'))?.textContent).toContain(
      '80% alike'
    )
  })

  it('never claims a root grew from one book, because it did not', () => {
    show()

    expect(screen.queryByText(/Grown from/)).toBeNull()
    expect(screen.queryByText(/The Dispossessed/)).toBeNull()
  })

  // Four columns fit; deeper, the first ones step aside and a trail leads back.
  it('keeps four columns in view and offers a way back', async () => {
    let chain = node('d5', 0.3, 5, [], 0.7)
    for (let depth = 4; depth >= 1; depth--) chain = node(`d${depth}`, 0.3, depth, [chain], 0.7)
    const user = show([node('d0', 0.9, 0, [chain])])

    for (const depth of [1, 2, 3, 4])
      await user.click(screen.getByRole('button', { name: new RegExp(`^Book d${depth}`) }))

    const columns = screen
      .getAllByRole('region')
      .filter((region) => !region.getAttribute('aria-label')?.startsWith('About'))
    expect(columns).toHaveLength(4)
    expect(screen.queryByRole('region', { name: 'Closest to your taste' })).toBeNull()
    const trail = screen.getByRole('navigation', { name: 'Path so far' })
    await user.click(within(trail).getByRole('button', { name: 'Book d0' }))

    expect(screen.getByRole('region', { name: 'Closest to your taste' })).toBeDefined()
  })

  it('shows the last book chosen in full below the columns', async () => {
    const user = show()
    await user.click(screen.getByRole('button', { name: /^Book child-a/ }))

    const about = screen.getByRole('region', { name: 'About Book child-a' })
    expect(about.textContent).toContain('80% alike to Book root')
    expect(about.textContent).toContain('70% match with your taste')
    expect(within(about).getByText('Science fiction')).toBeDefined()
  })

  // Under "Find books like this" the scores measure that one book, not your taste.
  it('names the book the scores were measured against', () => {
    installBridge()
    renderApp(
      <RecommendationTree
        roots={tree}
        rankedAgainst="Dune"
        onSave={() => {}}
        onDismiss={() => {}}
        savingOlid={null}
      />
    )

    const about = screen.getByRole('region', { name: 'About Book root' })
    expect(about.textContent).toContain('90% alike to Dune')
    expect(about.textContent).not.toContain('your taste')
  })

  it('adds or turns down the book shown below from its own buttons', async () => {
    const onSave = vi.fn()
    const user = show(tree, onSave)

    const about = screen.getByRole('region', { name: 'About Book root' })
    await user.click(within(about).getByRole('button', { name: 'Want to read' }))

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ olid: 'root' }))
  })

  it('acts on the book whose button was pressed', async () => {
    const onSave = vi.fn()
    const user = show(tree, onSave)
    await user.click(screen.getByRole('button', { name: /^Book child-a/ }))

    await user.click(screen.getByLabelText('Want to read Book grandchild'))

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ olid: 'grandchild' }))
  })

  it('reaches a row’s actions from the keyboard', async () => {
    const user = show()

    await user.tab()
    await user.tab()

    expect(document.activeElement?.getAttribute('aria-label')).toBe('Want to read Book root')
  })

  it('says so when there is nothing to arrange', () => {
    show([])

    expect(screen.getByText('Nothing to arrange yet')).toBeDefined()
  })
})
