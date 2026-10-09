import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import {
  useCreateBook,
  useCreateNote,
  useDataCounts,
  useSearch
} from '../src/renderer/src/lib/queries'
import { installBridge } from './helpers/render'

function Writes(): React.JSX.Element {
  const addBook = useCreateBook()
  const addNote = useCreateNote()
  const counts = useDataCounts()
  const search = useSearch('new')
  return (
    <>
      <span>Books: {counts.data?.books}</span>
      <span>Notes: {counts.data?.notes}</span>
      <span>Matches: {search.data?.length}</span>
      <button onClick={() => addBook.mutate({ title: 'New book' })}>Add book</button>
      <button onClick={() => addNote.mutate({ bodyMd: 'New note' })}>Add note</button>
    </>
  )
}

function setup(): void {
  const bridge = installBridge(
    {},
    {
      dataCounts: async () => ({
        books: bridge.books.length,
        notes: bridge.notes.length,
        quotes: 0,
        reviews: 0,
        candidates: 0,
        dismissed: 0
      }),
      search: async () => [
        ...bridge.books.map((book) => ({
          kind: 'book' as const,
          id: book.id,
          title: book.title,
          subtitle: null,
          snippet: ''
        })),
        ...bridge.notes.map((note) => ({
          kind: 'note' as const,
          id: note.id,
          title: note.title,
          subtitle: null,
          snippet: ''
        }))
      ]
    }
  )
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } }
  })
  render(
    <QueryClientProvider client={client}>
      <Writes />
    </QueryClientProvider>
  )
}

describe('library write cache consistency', () => {
  it('updates cached search results and data counts after adding a book', async () => {
    setup()
    expect(await screen.findByText('Books: 0')).toBeTruthy()
    expect(await screen.findByText('Matches: 0')).toBeTruthy()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Add book' }))
    expect(await screen.findByText('Books: 1')).toBeTruthy()
    expect(await screen.findByText('Matches: 1')).toBeTruthy()
  })

  it('updates cached search results and data counts after saving writing', async () => {
    setup()
    expect(await screen.findByText('Notes: 0')).toBeTruthy()
    expect(await screen.findByText('Matches: 0')).toBeTruthy()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Add note' }))
    expect(await screen.findByText('Notes: 1')).toBeTruthy()
    expect(await screen.findByText('Matches: 1')).toBeTruthy()
  })
})
