import { BOOK_STATUSES, STATUS_LABELS, type Book, type BookStatus, type Note } from '@shared/api'
import { useState, type ReactNode } from 'react'

import { classify } from '@shared/categories'
import { confirm } from '../lib/confirm'
import { fromDateInput, relativeDate, toDateInput } from '../lib/dates'
import { notify } from '../lib/feedback'
import {
  useBookMetadata,
  useCreateNote,
  useDeleteBook,
  useDeleteNote,
  useEnrichBook,
  useNotes,
  useUpdateBook,
  useUpdateNote
} from '../lib/queries'
import { toPlainText } from '@shared/plaintext'

import { isQuote, QUOTE_KIND } from '../lib/quotes'
import { statusPatch } from '../lib/status'
import { SCREEN_NAMES, useView } from '../lib/view'
import CoverPicker from './CoverPicker'
import QuoteCard from './QuoteCard'
import EditableNumber from './EditableNumber'
import EditableTitle from './EditableTitle'
import Editor from './Editor'
import GenrePicker from './GenrePicker'
import Rating from './Rating'

interface Props {
  book: Book
}

export default function BookDetail({ book }: Props): ReactNode {
  const { navigate, previous: cameFrom, back } = useView()
  const { data: notes = [], isPending } = useNotes(book.id)
  const { data: metadata } = useBookMetadata(book.id)

  // Raw subjects are cataloguing data and never shown; `book.genres` outranks
  // the guess drawn from them.
  const inferred = classify(metadata?.subjects ?? [])

  const updateBook = useUpdateBook()
  const deleteBook = useDeleteBook()
  const enrichBook = useEnrichBook()
  const createNote = useCreateNote()
  const updateNote = useUpdateNote()
  const deleteNote = useDeleteNote()

  const [openId, setOpenId] = useState<number | null>(null)
  const [openQuoteId, setOpenQuoteId] = useState<number | null>(null)

  const review = notes.find((note) => note.kind === 'review') ?? null
  const thoughts = notes.filter((note) => note.kind !== 'review' && !isQuote(note))
  const quotes = notes.filter(isQuote)

  function setStatus(status: BookStatus): void {
    updateBook.mutate({ id: book.id, patch: statusPatch(status) })
  }

  function saveReview(text: string): void {
    if (review) {
      updateNote.mutate({ id: review.id, patch: { bodyMd: text } })
    } else if (text.trim()) {
      createNote.mutate({
        bookId: book.id,
        kind: 'review',
        title: `Review of ${book.title}`,
        bodyMd: text
      })
    }
  }

  // The row expands into an editor in place, so the book stays in view.
  function addNote(): void {
    const open = thoughts.find((note) => note.id === openId)
    if (open && open.bodyMd.trim() === '') return

    createNote.mutate(
      { bookId: book.id, kind: 'thought' },
      { onSuccess: (note) => setOpenId(note.id) }
    )
  }

  function toggleNote(note: Note): void {
    const previous = thoughts.find((other) => other.id === openId)
    const next = openId === note.id ? null : note.id
    setOpenId(next)

    if (previous && previous.id !== next && previous.bodyMd.trim() === '') {
      deleteNote.mutate(previous.id)
    }
  }

  function addQuote(): void {
    const open = quotes.find((quote) => quote.id === openQuoteId)
    if (open && open.bodyMd.trim() === '') return

    createNote.mutate(
      { bookId: book.id, kind: QUOTE_KIND },
      { onSuccess: (quote) => setOpenQuoteId(quote.id) }
    )
  }

  function toggleQuote(quote: Note): void {
    const previous = quotes.find((other) => other.id === openQuoteId)
    const next = openQuoteId === quote.id ? null : quote.id
    setOpenQuoteId(next)

    if (previous && previous.id !== next && previous.bodyMd.trim() === '') {
      deleteNote.mutate(previous.id)
    }
  }

  async function removeQuote(quote: Note): Promise<void> {
    if (quote.bodyMd.trim()) {
      const ok = await confirm({
        title: 'Delete this quote?',
        body: 'This cannot be undone.',
        confirmLabel: 'Delete quote',
        destructive: true
      })
      if (!ok) return
    }
    if (openQuoteId === quote.id) setOpenQuoteId(null)
    deleteNote.mutate(quote.id)
  }

  async function removeNote(note: Note): Promise<void> {
    if (note.bodyMd.trim()) {
      const ok = await confirm({
        title: `Delete “${note.title || 'Untitled'}”?`,
        body: 'The note and everything written in it will be gone. This cannot be undone.',
        confirmLabel: 'Delete note',
        destructive: true
      })
      if (!ok) return
    }
    if (openId === note.id) setOpenId(null)
    deleteNote.mutate(note.id)
  }

  async function removeBook(): Promise<void> {
    const ok = await confirm({
      title: `Delete “${book.title}”?`,
      body:
        notes.length > 0
          ? `The book and ${notes.length === 1 ? 'the note' : `all ${notes.length} notes`} written about it will be gone. This cannot be undone.`
          : 'The book will be removed from your library. This cannot be undone.',
      confirmLabel: 'Delete book',
      destructive: true
    })
    if (!ok) return
    deleteBook.mutate(book.id, { onSuccess: () => navigate({ kind: 'library' }) })
  }

  function refetchMetadata(): void {
    enrichBook.mutate(book.id, { onSuccess: () => notify('Metadata refreshed.') })
  }

  function setDate(field: 'startedAt' | 'finishedAt', value: string): void {
    updateBook.mutate({ id: book.id, patch: { [field]: fromDateInput(value) } })
  }

  // A half-typed date is briefly nonsense on the way to being right, so this
  // says so rather than refusing it.
  const backwards =
    book.startedAt !== null && book.finishedAt !== null && book.finishedAt < book.startedAt

  return (
    <div className="h-full overflow-y-auto px-8 pt-6 pb-16">
      <div className="mx-auto max-w-5xl">
        <button
          type="button"
          className="btn btn-ghost -ml-2 mb-4"
          onClick={() => (cameFrom ? back() : navigate({ kind: 'library' }))}
        >
          ← {cameFrom ? SCREEN_NAMES[cameFrom.kind] : 'Library'}
        </button>

        {/* The left column is sticky, so the book stays in view while writing about it. */}
        <div className="grid items-start gap-x-10 gap-y-8 lg:grid-cols-[248px_1fr]">
          <aside className="lg:sticky lg:top-0 lg:self-start">
            <div className="max-w-[188px] max-lg:mx-auto">
              <CoverPicker book={book} />
            </div>

            <h1 className="mt-4 flex text-[20px]">
              <EditableTitle
                value={book.title}
                label="Book title"
                className="min-w-0 text-[20px] font-semibold"
                // A book with no title would be unfindable.
                onCommit={(title) => {
                  if (title) updateBook.mutate({ id: book.id, patch: { title } })
                }}
              />
            </h1>

            {/* Shown even when empty: a field that hides when empty can never be
                filled. */}
            <p className="mt-1 flex text-[14px] text-ink-muted">
              <EditableTitle
                value={book.author ?? ''}
                label="Author"
                hint="Click to edit the author"
                placeholder="Add author"
                className="min-w-0 text-[14px]"
                onCommit={(author) =>
                  updateBook.mutate({ id: book.id, patch: { author: author || null } })
                }
              />
            </p>

            {/* Always present, for the same reason as the author above. */}
            <div className="mt-2 flex flex-wrap items-center gap-x-1 text-[12px] text-ink-faint">
              <EditableNumber
                value={book.publishedYear}
                label="Published year"
                placeholder="Year"
                onCommit={(publishedYear) =>
                  updateBook.mutate({ id: book.id, patch: { publishedYear } })
                }
              />
              <span aria-hidden>·</span>
              <EditableNumber
                value={book.pageCount}
                label="Page count"
                placeholder="Pages"
                suffix=" pages"
                onCommit={(pageCount) => updateBook.mutate({ id: book.id, patch: { pageCount } })}
              />
            </div>

            {/* Never taken from the clock: most books added to a journal were read some
                time ago. */}
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2">
              {(
                [
                  ['Started', 'startedAt', book.startedAt],
                  ['Finished', 'finishedAt', book.finishedAt]
                ] as const
              ).map(([label, field, value]) => (
                <label key={field} className="flex flex-col gap-1">
                  <span className="text-[11px] text-ink-faint">{label}</span>
                  <input
                    type="date"
                    aria-label={`${label} reading`}
                    value={toDateInput(value)}
                    onChange={(event) => setDate(field, event.target.value)}
                    className="field w-auto px-2 py-1 text-[13px]"
                  />
                </label>
              ))}
            </div>

            {backwards && (
              <p role="status" className="mt-1.5 text-[12px] text-danger">
                Finished before started.
              </p>
            )}

            <div
              role="group"
              aria-label="Reading status"
              data-testid="statuses"
              className="mt-4 flex flex-wrap gap-1"
            >
              {BOOK_STATUSES.map((status) => (
                <button
                  key={status}
                  type="button"
                  aria-pressed={book.status === status}
                  onClick={() => setStatus(status)}
                  className={`rounded-control border px-2.5 py-1 text-[12px] transition-colors ${
                    book.status === status
                      ? 'border-transparent bg-accent font-medium text-white'
                      : 'border-hairline-strong bg-surface text-ink-muted hover:text-ink'
                  }`}
                >
                  {STATUS_LABELS[status]}
                </button>
              ))}
            </div>

            <div className="mt-3">
              <Rating
                value={book.rating}
                onChange={(rating) => updateBook.mutate({ id: book.id, patch: { rating } })}
              />
            </div>

            {/* Publisher blurbs give away the turn, so the summary is kept for the
                recommender and not shown. */}
            <GenrePicker
              chosen={book.genres}
              inferred={metadata ? inferred : null}
              onCommit={(next) => updateBook.mutate({ id: book.id, patch: { genres: next } })}
            />

            {/* The pull-left sits inside the rule, not on it: the row wraps, so
                every line must start at the same edge as the one above. */}
            <div className="mt-4 border-t border-hairline pt-3">
              <div className="-ml-2 flex flex-wrap gap-1">
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => navigate({ kind: 'discover', likeBookId: book.id })}
                >
                  Find books like this
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={refetchMetadata}
                  disabled={enrichBook.isPending}
                >
                  {enrichBook.isPending ? 'Refreshing…' : 'Refresh metadata'}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-danger"
                  onClick={() => void removeBook()}
                >
                  Delete
                </button>
              </div>
            </div>
          </aside>

          <main className="min-w-0">
            <section className="mb-8">
              <span className="eyebrow">Your review</span>

              {!isPending && (
                <div className="card mt-2.5 min-h-44 px-5 py-4">
                  <Editor
                    key={`review-${book.id}`}
                    value={review?.bodyMd ?? ''}
                    placeholder={`What did you make of ${book.title}?`}
                    onSave={saveReview}
                  />
                </div>
              )}
            </section>

            <section className="mb-8">
              <div className="mb-2.5 flex items-center justify-between">
                <span className="eyebrow">Quotes{quotes.length > 0 && ` · ${quotes.length}`}</span>
                <button
                  type="button"
                  className="btn btn-ghost -mr-2"
                  onClick={addQuote}
                  title="Keep a passage from this book"
                >
                  Add quote
                </button>
              </div>

              {!isPending && quotes.length > 0 && (
                <div className="flex flex-col gap-2">
                  {quotes.map((quote) => (
                    <QuoteCard
                      key={quote.id}
                      quote={quote}
                      open={openQuoteId === quote.id}
                      onToggle={() => toggleQuote(quote)}
                      onSave={(text) =>
                        updateNote.mutate({ id: quote.id, patch: { bodyMd: text } })
                      }
                      onDelete={() => void removeQuote(quote)}
                    />
                  ))}
                </div>
              )}
            </section>

            <section>
              <div className="mb-2.5 flex items-center justify-between">
                <span className="eyebrow">
                  Notes{thoughts.length > 0 && ` · ${thoughts.length}`}
                </span>
                <button
                  type="button"
                  className="btn btn-ghost -mr-2"
                  onClick={addNote}
                  title="Write a note on this book"
                >
                  Add note
                </button>
              </div>

              {!isPending &&
                (thoughts.length === 0 ? null : (
                  <div className="flex flex-col gap-2">
                    {thoughts.map((note) => (
                      <NoteCard
                        key={note.id}
                        note={note}
                        open={openId === note.id}
                        bookTitle={book.title}
                        onToggle={() => toggleNote(note)}
                        onRename={(title) => updateNote.mutate({ id: note.id, patch: { title } })}
                        onSave={(text) =>
                          updateNote.mutate({ id: note.id, patch: { bodyMd: text } })
                        }
                        onOpenPage={() => navigate({ kind: 'note', id: note.id })}
                        onDelete={() => void removeNote(note)}
                      />
                    ))}
                  </div>
                ))}
            </section>
          </main>
        </div>
      </div>
    </div>
  )
}

function NoteCard({
  note,
  open,
  bookTitle,
  onToggle,
  onRename,
  onSave,
  onOpenPage,
  onDelete
}: {
  note: Note
  open: boolean
  bookTitle: string
  onToggle: () => void
  onRename: (title: string) => void
  onSave: (text: string) => void
  onOpenPage: () => void
  onDelete: () => void
}): ReactNode {
  // A closed row is one button, and an input nested inside a button is
  // neither valid markup nor focusable.
  if (!open) {
    return (
      <div data-testid="note-card" className="card overflow-hidden">
        <button
          type="button"
          data-testid="note-head"
          onClick={onToggle}
          className="flex w-full flex-col gap-1 px-4 py-3 text-left hover:bg-hover"
        >
          <span className="flex w-full items-baseline justify-between gap-3">
            <span className={`truncate font-medium ${note.title ? '' : 'text-ink-faint'}`}>
              {note.title || 'Untitled note'}
            </span>
            <span className="shrink-0 text-[11px] text-ink-faint">
              {relativeDate(note.updatedAt)}
            </span>
          </span>

          {/* A preview, so the shelf of notes is readable without opening each. */}
          <span
            className={`line-clamp-2 min-w-0 wrap-anywhere text-[13px] leading-snug ${
              note.bodyMd.trim() ? 'text-ink-muted' : 'italic text-ink-faint'
            }`}
          >
            {note.bodyMd.trim() ? toPlainText(note.bodyMd).slice(0, 240) : 'Empty note'}
          </span>

          {note.tag && <span className="chip self-start">{note.tag}</span>}
        </button>
      </div>
    )
  }

  return (
    <div data-testid="note-card" data-open="true" className="card">
      <div className="flex items-center gap-2 border-b border-hairline px-3 py-2">
        <EditableTitle
          value={note.title}
          label="Note title"
          placeholder="Untitled note"
          className="min-w-0 flex-1 font-medium"
          onCommit={onRename}
        />
        <button
          type="button"
          data-testid="note-head"
          aria-label="Collapse note"
          title="Collapse"
          className="btn btn-ghost shrink-0"
          onClick={onToggle}
        >
          Done
        </button>
      </div>

      <div className="min-h-40 px-4 py-3">
        <Editor
          value={note.bodyMd}
          placeholder={`A quote, an idea, a question about ${bookTitle}…`}
          onSave={onSave}
        />
      </div>

      <div className="flex justify-end gap-1 px-2 pb-2">
        <button type="button" className="btn btn-ghost" onClick={onOpenPage}>
          Open as page
        </button>
        <button type="button" className="btn btn-ghost btn-danger" onClick={onDelete}>
          Delete
        </button>
      </div>
    </div>
  )
}
