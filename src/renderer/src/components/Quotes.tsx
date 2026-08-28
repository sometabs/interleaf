import type { Note } from '@shared/api'
import { toPlainText } from '@shared/plaintext'
import { useState, type ReactNode } from 'react'

import { confirm } from '../lib/confirm'
import { useBooks, useCreateNote, useDeleteNote, useNotes, useUpdateNote } from '../lib/queries'
import { isQuote, QUOTE_KIND } from '../lib/quotes'
import Empty from './Empty'
import QuoteCard from './QuoteCard'

/** The filter value standing for "has none of these" rather than "any". */
const NONE = 'none'

// Still stored as a note of kind `highlight`; only the presentation differs.
export default function Quotes(): ReactNode {
  const { data: notes = [], isPending } = useNotes()
  const { data: books = [] } = useBooks()

  const createNote = useCreateNote()
  const updateNote = useUpdateNote()
  const deleteNote = useDeleteNote()

  const [filter, setFilter] = useState('')
  const [bookFilter, setBookFilter] = useState('')
  const [openId, setOpenId] = useState<number | null>(null)

  const quotes = notes.filter(isQuote)

  function bookTitle(quote: Note): string | null {
    if (quote.bookId === null) return null
    return books.find((book) => book.id === quote.bookId)?.title ?? null
  }

  const query = filter.trim().toLowerCase()

  const matching = quotes.filter((quote) => {
    if (
      bookFilter === NONE
        ? quote.bookId !== null
        : bookFilter && quote.bookId !== Number(bookFilter)
    )
      return false
    if (!query) return true

    return [toPlainText(quote.bodyMd), bookTitle(quote) ?? '']
      .join('\n')
      .toLowerCase()
      .includes(query)
  })

  const narrowed = query !== '' || bookFilter !== ''

  function newQuote(): void {
    // Reuse the one that is open and still blank rather than stacking up empties.
    const open = quotes.find((quote) => quote.id === openId)
    if (open && open.bodyMd.trim() === '') return

    createNote.mutate(
      // A quote typed here starts on whichever book the list is narrowed to,
      // the only thing on screen saying which book is meant.
      { kind: QUOTE_KIND, bookId: bookFilter && bookFilter !== NONE ? Number(bookFilter) : null },
      { onSuccess: (quote) => setOpenId(quote.id) }
    )
  }

  function toggle(quote: Note): void {
    const previous = quotes.find((other) => other.id === openId)
    const next = openId === quote.id ? null : quote.id
    setOpenId(next)

    if (previous && previous.id !== next && previous.bodyMd.trim() === '') {
      deleteNote.mutate(previous.id)
    }
  }

  async function remove(quote: Note): Promise<void> {
    if (quote.bodyMd.trim()) {
      const ok = await confirm({
        title: 'Delete this quote?',
        body: 'This cannot be undone.',
        confirmLabel: 'Delete quote',
        destructive: true
      })
      if (!ok) return
    }
    if (openId === quote.id) setOpenId(null)
    deleteNote.mutate(quote.id)
  }

  if (isPending) return <div className="h-full" />

  return (
    <div className="h-full overflow-y-auto px-8 pt-7 pb-16">
      <div className="mx-auto max-w-3xl">
        <header className="mb-6 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-[22px]">Quotes</h1>
            <p className="mt-0.5 text-[13px] text-ink-muted">
              {narrowed
                ? `${matching.length} of ${quotes.length}`
                : `${quotes.length} ${quotes.length === 1 ? 'quote' : 'quotes'}`}
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {quotes.length > 0 && (
              <input
                className="field max-w-56"
                type="search"
                placeholder="Search quotes…"
                aria-label="Search quotes"
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
              />
            )}
            <button type="button" className="btn btn-outline shrink-0" onClick={newQuote}>
              New quote
            </button>
          </div>
        </header>

        {quotes.length > 0 && (
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <select
              aria-label="Filter by book"
              className="field w-auto max-w-56 py-1.5 text-[13px]"
              value={bookFilter}
              onChange={(event) => setBookFilter(event.target.value)}
            >
              <option value="">All books</option>
              <option value={NONE}>No book</option>
              {books.map((book) => (
                <option key={book.id} value={book.id}>
                  {book.title}
                </option>
              ))}
            </select>

            {narrowed && (
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  setFilter('')
                  setBookFilter('')
                }}
              >
                Clear
              </button>
            )}
          </div>
        )}

        {quotes.length === 0 ? (
          <Empty
            title="No quotes yet"
            action={
              <button type="button" className="btn btn-primary" onClick={newQuote}>
                Keep your first quote
              </button>
            }
          />
        ) : matching.length === 0 ? (
          <p className="py-8 text-center text-ink-muted">
            {query ? `Nothing matches “${filter.trim()}”.` : 'Nothing under this book.'}
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {matching.map((quote) => (
              <QuoteCard
                key={quote.id}
                quote={quote}
                open={openId === quote.id}
                onToggle={() => toggle(quote)}
                onSave={(text) => updateNote.mutate({ id: quote.id, patch: { bodyMd: text } })}
                onDelete={() => void remove(quote)}
                source={
                  openId === quote.id ? (
                    <select
                      aria-label="Book this quote is from"
                      value={quote.bookId ?? ''}
                      onChange={(event) =>
                        updateNote.mutate({
                          id: quote.id,
                          patch: { bookId: event.target.value ? Number(event.target.value) : null }
                        })
                      }
                      className="h-7 w-full max-w-56 truncate rounded-control border-none bg-transparent px-1.5 text-[13px] text-ink-muted hover:bg-hover focus:outline-none"
                    >
                      <option value="">No book</option>
                      {books.map((book) => (
                        <option key={book.id} value={book.id}>
                          {book.title}
                        </option>
                      ))}
                    </select>
                  ) : (
                    bookTitle(quote)
                  )
                }
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
