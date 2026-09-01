import type { Note } from '@shared/api'
import { toPlainText } from '@shared/plaintext'
import { useState, type ReactNode } from 'react'

import { confirm } from '../lib/confirm'
import { notify } from '../lib/feedback'
import { useBooks, useCreateNote, useDeleteNote, useNotes, useUpdateNote } from '../lib/queries'
import { isQuote, QUOTE_KIND } from '../lib/quotes'
import Empty from './Empty'
import QuoteCard from './QuoteCard'

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
  // A quote with no book cannot be stored, so one starts here and is written
  // the moment a book is picked.
  const [draft, setDraft] = useState<string | null>(null)

  const quotes = notes.filter(isQuote)

  function bookTitle(quote: Note): string | null {
    if (quote.bookId === null) return null
    return books.find((book) => book.id === quote.bookId)?.title ?? null
  }

  const query = filter.trim().toLowerCase()

  const matching = quotes.filter((quote) => {
    if (bookFilter && quote.bookId !== Number(bookFilter)) return false
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
    if (draft !== null) return

    // The filter names a book, so there is nothing left to ask.
    if (bookFilter) {
      createNote.mutate(
        { kind: QUOTE_KIND, bookId: Number(bookFilter) },
        { onSuccess: (quote) => setOpenId(quote.id) }
      )
      return
    }

    setOpenId(null)
    setDraft('')
  }

  function keepDraft(bookId: number): void {
    createNote.mutate(
      { kind: QUOTE_KIND, bookId, bodyMd: draft ?? '' },
      {
        onSuccess: (quote) => {
          setDraft(null)
          setOpenId(quote.id)
        }
      }
    )
  }

  // Done cannot finish what was never stored, so it says why. Deleting is a
  // deliberate throw-away and asks, like deleting a stored quote does.
  function finishDraft(): void {
    notify('No book has been selected.')
  }

  async function discardDraft(): Promise<void> {
    if ((draft ?? '').trim()) {
      const ok = await confirm({
        title: 'Discard this quote?',
        body: 'No book has been selected.',
        confirmLabel: 'Discard',
        destructive: true
      })
      if (!ok) return
    }
    setDraft(null)
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

        {draft !== null && (
          <div className="mb-2">
            <QuoteCard
              quote={{
                id: -1,
                bookId: null,
                kind: QUOTE_KIND,
                title: '',
                bodyMd: draft,
                tag: null,
                createdAt: 0,
                updatedAt: 0
              }}
              open
              onToggle={finishDraft}
              onSave={(text) => setDraft(text)}
              onDelete={() => void discardDraft()}
              source={
                <select
                  aria-label="Book this quote is from"
                  value=""
                  onChange={(event) => keepDraft(Number(event.target.value))}
                  className="h-7 w-full max-w-56 truncate rounded-control border-none bg-transparent px-1.5 text-[13px] text-ink-muted hover:bg-hover focus:outline-none"
                >
                  {/* A prompt, not a choice: picking it is what stores the quote. */}
                  <option value="" disabled>
                    Choose a book…
                  </option>
                  {books.map((book) => (
                    <option key={book.id} value={book.id}>
                      {book.title}
                    </option>
                  ))}
                </select>
              }
            />
          </div>
        )}

        {quotes.length === 0 && draft === null ? (
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
                          patch: { bookId: Number(event.target.value) }
                        })
                      }
                      className="h-7 w-full max-w-56 truncate rounded-control border-none bg-transparent px-1.5 text-[13px] text-ink-muted hover:bg-hover focus:outline-none"
                    >
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
