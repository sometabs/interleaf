import * as Dialog from '@radix-ui/react-dialog'
import type { OlBookDto } from '@shared/api'
import { useState, type ReactNode } from 'react'

import { notify } from '../lib/feedback'
import { useAddFromOpenLibrary, useCreateBook, useOpenLibrarySearch } from '../lib/queries'
import { useView } from '../lib/view'
import Cover from './Cover'
import Spinner from './Spinner'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export default function AddBookDialog({ open, onOpenChange }: Props): ReactNode {
  const { navigate } = useView()
  const [query, setQuery] = useState('')
  /** The last query actually sent. Only this reaches the network. */
  const [submitted, setSubmitted] = useState('')
  // Adding does not close the dialog, and results under one title look alike,
  // so these rows mark themselves and refuse a second click.
  const [added, setAdded] = useState<Set<string>>(new Set())

  const addFromOl = useAddFromOpenLibrary()
  const createBook = useCreateBook()

  const { data: results = [], isFetching, isSuccess, isError } = useOpenLibrarySearch(submitted)

  const searchable = query.trim().length >= 2

  // Open Library allows about one request a second, and a shorter debounce
  // spends one on every pause mid-title.
  function search(): void {
    if (searchable) setSubmitted(query.trim())
  }

  function close(): void {
    onOpenChange(false)
    setQuery('')
    setSubmitted('')
    setAdded(new Set())
  }

  /** Adds and stays, so one search can yield several books. A toast reports each. */
  function add(book: OlBookDto): void {
    addFromOl.mutate(book, {
      onSuccess: (created) => {
        setAdded((current) => new Set(current).add(book.olid))
        notify(`Added “${created.title}” to your library.`)
      }
    })
  }

  /** Escape hatch: add exactly what was typed, no network involved. */
  function addManually(): void {
    const title = query.trim()
    if (!title) return
    createBook.mutate(
      { title, status: 'want' },
      {
        onSuccess: (created) => {
          // Nothing is fetched: Open Library answers any string with its
          // closest match, so a lookup here attaches an unrelated book.
          navigate({ kind: 'book', id: created.id })
          close()
        }
      }
    )
  }

  const busy = addFromOl.isPending || createBook.isPending

  // Which row is being added: fetching metadata and a cover takes seconds.
  const adding = addFromOl.isPending ? addFromOl.variables.olid : null

  return (
    <Dialog.Root open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-ink/25 backdrop-blur-[2px]" />
        <Dialog.Content className="fixed left-1/2 top-[12vh] z-50 flex max-h-[70vh] w-[min(560px,calc(100vw-32px))] -translate-x-1/2 flex-col overflow-hidden rounded-card border border-hairline bg-surface shadow-pop">
          <Dialog.Title className="sr-only">Add a book</Dialog.Title>
          <Dialog.Description className="sr-only">
            Search Open Library by title, author, or ISBN.
          </Dialog.Description>

          {/* A form, so Enter submits the way it does in every other search box
              The button is the visible affordance, not the only one. */}
          <form
            className="flex items-center gap-2 border-b border-hairline p-4"
            onSubmit={(event) => {
              event.preventDefault()
              search()
            }}
          >
            <input
              autoFocus
              className="field border-transparent shadow-none focus:shadow-none"
              placeholder="Search by title, author, or ISBN…"
              aria-label="Search for a book"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            {isFetching && <Spinner label="Searching Open Library" />}
            <button type="submit" className="btn btn-primary shrink-0" disabled={!searchable}>
              Search
            </button>
          </form>

          <div className="flex-1 overflow-y-auto p-2">
            {results.map((book) => {
              const done = added.has(book.olid)
              return (
                <button
                  key={book.olid}
                  type="button"
                  disabled={busy || done}
                  onClick={() => add(book)}
                  className="flex w-full items-center gap-3 rounded-control p-2 text-left hover:bg-hover disabled:opacity-50"
                >
                  <span className="w-9 shrink-0">
                    <Cover
                      title={book.title}
                      author={book.author}
                      coverId={book.coverId}
                      size="sm"
                    />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate font-medium">{book.title}</span>
                    <span className="truncate text-[12px] text-ink-muted">
                      {adding === book.olid
                        ? 'Adding…'
                        : `${book.author ?? 'Unknown author'}${
                            book.firstPublishYear ? ` · ${book.firstPublishYear}` : ''
                          }`}
                    </span>
                  </span>
                  {adding === book.olid && <Spinner label={`Adding ${book.title}`} />}
                  {done && <span className="chip shrink-0 text-[10px]">Added</span>}
                </button>
              )
            })}

            {isSuccess && results.length === 0 && !isFetching && (
              <p className="px-4 py-6 text-center text-[13px] text-ink-muted">
                Open Library has nothing for that.
              </p>
            )}

            {/* A lookup that never happened is not entitled to say "nothing found". */}
            {isError && !isFetching && (
              <p className="px-4 py-6 text-center text-[13px] text-ink-muted">
                Open Library is unreachable. Add the book by hand, and “Refresh metadata” on its
                page will fill in the rest once Open Library is back.
              </p>
            )}

            {/* Independent of searching: adding by hand should never need a
                request first. */}
            {searchable && !isFetching && (
              <button
                type="button"
                disabled={busy}
                onClick={addManually}
                className="mt-2 flex w-full items-center justify-center gap-2 rounded-control border border-dashed border-hairline-strong px-3 py-2 text-[13px] text-ink-muted hover:bg-hover"
              >
                {createBook.isPending && <Spinner label="Adding" className="size-3.5" />}
                {createBook.isPending ? 'Adding…' : `Add “${query.trim()}” manually`}
              </button>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
