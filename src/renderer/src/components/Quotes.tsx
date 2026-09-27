import type { Note } from '@shared/api'
import { toPlainText } from '@shared/plaintext'
import { useState, type ReactNode } from 'react'

import { confirm } from '../lib/confirm'
import { notify } from '../lib/feedback'
import { useBooks, useCreateNote, useDeleteNote, useNotes, useUpdateNote } from '../lib/queries'
import { isQuote, QUOTE_KIND } from '../lib/quotes'
import { authorKey } from '../lib/shelves'
import Empty from './Empty'
import QuoteCard from './QuoteCard'

const UNKNOWN_AUTHOR_FILTER = '__unknown_author__'

// Still stored as a note of kind `highlight`; only the presentation differs.
export default function Quotes(): ReactNode {
  const { data: notes = [], isPending } = useNotes()
  const { data: books = [] } = useBooks()

  const createNote = useCreateNote()
  const updateNote = useUpdateNote()
  const deleteNote = useDeleteNote()

  const [filter, setFilter] = useState('')
  const [filterMode, setFilterMode] = useState<'book' | 'author'>('book')
  const [filterValue, setFilterValue] = useState('')
  const [openId, setOpenId] = useState<number | null>(null)
  // A quote with no book cannot be stored, so one starts here and is written
  // the moment a book is picked.
  const [draft, setDraft] = useState<string | null>(null)

  const quotes = notes.filter(isQuote)

  function quoteBook(quote: Note): (typeof books)[number] | null {
    if (quote.bookId === null) return null
    return books.find((book) => book.id === quote.bookId) ?? null
  }

  function bookTitle(quote: Note): string | null {
    return quoteBook(quote)?.title ?? null
  }

  function sourceLabel(quote: Note): string | null {
    const book = quoteBook(quote)
    if (!book) return null
    return [book.title, book.author].filter(Boolean).join(' · ')
  }

  const query = filter.trim().toLowerCase()
  const selectedBookId = filterMode === 'book' && filterValue ? Number(filterValue) : null
  const selectedAuthor =
    filterMode === 'author' && filterValue !== ''
      ? filterValue === UNKNOWN_AUTHOR_FILTER
        ? ''
        : filterValue
      : null

  const authorOptions = [
    ...books.reduce((authors, book) => {
      const key = authorKey(book.author)
      if (!authors.has(key)) authors.set(key, book.author?.trim() || 'Unknown author')
      return authors
    }, new Map<string, string>())
  ].sort(([, a], [, b]) => a.localeCompare(b))

  const sortedBooks = [...books].sort((a, b) => a.title.localeCompare(b.title))
  const draftBooks =
    selectedAuthor === null
      ? sortedBooks
      : sortedBooks.filter((book) => authorKey(book.author) === selectedAuthor)

  const matching = quotes.filter((quote) => {
    if (selectedBookId !== null && quote.bookId !== selectedBookId) return false
    if (selectedAuthor !== null && authorKey(quoteBook(quote)?.author ?? null) !== selectedAuthor)
      return false
    if (!query) return true

    return [toPlainText(quote.bodyMd), bookTitle(quote) ?? '', quoteBook(quote)?.author ?? '']
      .join('\n')
      .toLowerCase()
      .includes(query)
  })

  const narrowed = query !== '' || filterValue !== ''

  function newQuote(): void {
    // Reuse the one that is open and still blank rather than stacking up empties.
    const open = quotes.find((quote) => quote.id === openId)
    if (open && open.bodyMd.trim() === '') return
    if (draft !== null) return

    // The filter names a book, so there is nothing left to ask.
    if (selectedBookId !== null) {
      createNote.mutate(
        { kind: QUOTE_KIND, bookId: selectedBookId },
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
            <span className="text-[13px] text-ink-muted">Filter by</span>
            <select
              aria-label="Filter quotes by"
              className="field w-auto py-1.5 text-[13px]"
              value={filterMode}
              onChange={(event) => {
                setFilterMode(event.target.value as 'book' | 'author')
                setFilterValue('')
              }}
            >
              <option value="book">Books</option>
              <option value="author">Authors</option>
            </select>

            {filterMode === 'book' ? (
              <select
                aria-label="Filter by book"
                className="field w-auto max-w-56 py-1.5 text-[13px]"
                value={filterValue}
                onChange={(event) => setFilterValue(event.target.value)}
              >
                <option value="">All books</option>
                {sortedBooks.map((book) => (
                  <option key={book.id} value={book.id}>
                    {book.title}
                  </option>
                ))}
              </select>
            ) : (
              <select
                aria-label="Filter by author"
                className="field w-auto max-w-56 py-1.5 text-[13px]"
                value={filterValue}
                onChange={(event) => setFilterValue(event.target.value)}
              >
                <option value="">All authors</option>
                {authorOptions.map(([key, author]) => (
                  <option key={key || 'unknown'} value={key || UNKNOWN_AUTHOR_FILTER}>
                    {author}
                  </option>
                ))}
              </select>
            )}

            {narrowed && (
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  setFilter('')
                  setFilterValue('')
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
                  {draftBooks.map((book) => (
                    <option key={book.id} value={book.id}>
                      {[book.title, book.author].filter(Boolean).join(' · ')}
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
            {query ? `Nothing matches “${filter.trim()}”.` : 'Nothing under this source.'}
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
                      {sortedBooks.map((book) => (
                        <option key={book.id} value={book.id}>
                          {[book.title, book.author].filter(Boolean).join(' · ')}
                        </option>
                      ))}
                    </select>
                  ) : (
                    sourceLabel(quote)
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
