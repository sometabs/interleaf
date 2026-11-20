import { STATUS_LABELS, type Book, type BookStatus, type Note } from '@shared/api'
import { useRef, useState, type ReactNode } from 'react'

import { confirm } from '../lib/confirm'
import {
  formatDate,
  fromDateInput,
  readingDurationDays,
  relativeDate,
  toDateInput
} from '../lib/dates'
import { notify } from '../lib/feedback'
import {
  useBookMetadata,
  useBookReadingTime,
  useCreateNote,
  useDeleteBook,
  useDeleteBookNotes,
  useDeleteNote,
  useEnrichBook,
  useNotes,
  useSaveReview,
  useUpdateBook,
  useUpdateNote
} from '../lib/queries'
import { toPlainText } from '@shared/plaintext'

import { isQuote, QUOTE_KIND } from '../lib/quotes'
import { formatDuration } from '../lib/readingClock'
import { statusPatch } from '../lib/status'
import { SCREEN_NAMES, useView } from '../lib/view'
import ActionsMenu, { type MenuAction } from './ActionsMenu'
import CoverPicker from './CoverPicker'
import QuoteCard from './QuoteCard'
import EditableNumber from './EditableNumber'
import EditableTitle from './EditableTitle'
import EpubActions, { useEpubFileActions } from './EpubActions'
import OpenInBook from './OpenInBook'
import Editor from './Editor'
import Rating from './Rating'

interface Props {
  book: Book
}

// The order a book moves through, which the switch reads left to right.
const STATUS_ORDER: readonly BookStatus[] = ['want', 'reading', 'read', 'abandoned']

// Short enough for four to share one line; the full label stays as the button's name.
const SHORT_STATUS: Record<BookStatus, string> = {
  want: 'Want',
  reading: 'Reading',
  read: 'Read',
  abandoned: 'Set aside'
}

export default function BookDetail({ book }: Props): ReactNode {
  const { navigate, previous: cameFrom, back } = useView()
  const { data: notes = [], isPending } = useNotes(book.id)
  const { data: metadata } = useBookMetadata(book.id)
  const { data: time } = useBookReadingTime(book.id)

  const updateBook = useUpdateBook()
  const deleteBook = useDeleteBook()
  const deleteBookNotes = useDeleteBookNotes()
  const enrichBook = useEnrichBook()
  const createNote = useCreateNote()
  const updateNote = useUpdateNote()
  const deleteNote = useDeleteNote()
  const saveReview = useSaveReview(book.id)
  const epub = useEpubFileActions(book)

  const [openId, setOpenId] = useState<number | null>(null)
  const [openQuoteId, setOpenQuoteId] = useState<number | null>(null)
  const [noteDraft, setNoteDraft] = useState(false)
  const [quoteDraft, setQuoteDraft] = useState(false)

  const review = notes.find((note) => note.kind === 'review') ?? null
  const thoughts = notes.filter((note) => note.kind !== 'review' && !isQuote(note))
  const quotes = notes.filter(isQuote)

  function setStatus(status: BookStatus): void {
    updateBook.mutate({ id: book.id, patch: statusPatch(status) })
  }

  // The row expands into an editor in place, so the book stays in view.
  function addNote(): void {
    if (noteDraft) return
    setOpenId(null)
    setNoteDraft(true)
  }

  function toggleNote(note: Note): void {
    const next = openId === note.id ? null : note.id
    setOpenId(next)
  }

  function addQuote(): void {
    if (quoteDraft) return
    setOpenQuoteId(null)
    setQuoteDraft(true)
  }

  function toggleQuote(quote: Note): void {
    const next = openQuoteId === quote.id ? null : quote.id
    setOpenQuoteId(next)
  }

  function saveNoteDraft(title: string, bodyMd: string): void {
    createNote.mutate(
      {
        bookId: book.id,
        kind: 'thought',
        title: title.trim() || undefined,
        bodyMd
      },
      { onSuccess: () => setNoteDraft(false) }
    )
  }

  function saveQuoteDraft(bodyMd: string): void {
    createNote.mutate(
      { bookId: book.id, kind: QUOTE_KIND, bodyMd },
      { onSuccess: () => setQuoteDraft(false) }
    )
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

  async function removeBookEntries(kind: 'thought' | 'highlight'): Promise<void> {
    const entries = kind === 'highlight' ? quotes : thoughts
    const label = kind === 'highlight' ? 'quotes' : 'notes'
    const ok = await confirm({
      title: `Delete all ${entries.length} ${label} from “${book.title}”?`,
      body: `The book${review ? ' and its review' : ''} will be kept. This cannot be undone.`,
      confirmLabel: `Delete ${label}`,
      destructive: true
    })
    if (!ok) return

    const deleted = await deleteBookNotes.mutateAsync({ bookId: book.id, kind })
    if (kind === 'highlight') setOpenQuoteId(null)
    else setOpenId(null)
    notify(`Deleted ${deleted} ${label}`)
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
  const duration = readingDurationDays(book.startedAt, book.finishedAt)

  const menuActions: MenuAction[] = [
    {
      label: enrichBook.isPending ? 'Refreshing metadata…' : 'Refresh metadata',
      onSelect: refetchMetadata,
      disabled: enrichBook.isPending
    },
    ...(epub.file
      ? [
          { label: 'Replace EPUB', onSelect: () => void epub.choose(), disabled: epub.choosing },
          { label: 'Remove EPUB', onSelect: () => void epub.detach() }
        ]
      : []),
    ...(quotes.length > 0
      ? [
          {
            label: `Delete all quotes (${quotes.length})`,
            onSelect: () => void removeBookEntries('highlight'),
            danger: true,
            disabled: deleteBookNotes.isPending
          }
        ]
      : []),
    ...(thoughts.length > 0
      ? [
          {
            label: `Delete all notes (${thoughts.length})`,
            onSelect: () => void removeBookEntries('thought'),
            danger: true,
            disabled: deleteBookNotes.isPending
          }
        ]
      : []),
    { label: 'Delete book', onSelect: () => void removeBook(), danger: true }
  ]

  return (
    <div className="h-full overflow-y-auto px-8 pt-6 pb-16">
      <div className="mx-auto max-w-5xl">
        {/* Book-wide actions sit with the page, not with any one control. */}
        <div className="mb-4 flex items-center justify-between">
          <button
            type="button"
            className="btn btn-ghost -ml-2"
            onClick={() => (cameFrom ? back() : navigate({ kind: 'library' }))}
          >
            ← {cameFrom ? SCREEN_NAMES[cameFrom.kind] : 'Library'}
          </button>
          <ActionsMenu label="More book actions" actions={menuActions} />
        </div>

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

            <div className="mt-4">
              <EpubActions book={book} />
            </div>

            <div
              role="group"
              aria-label="Reading status"
              data-testid="statuses"
              className="mt-4 flex rounded-control border border-hairline-strong p-0.5"
            >
              {STATUS_ORDER.map((status) => (
                <button
                  key={status}
                  type="button"
                  aria-label={STATUS_LABELS[status]}
                  aria-pressed={book.status === status}
                  onClick={() => setStatus(status)}
                  className={`flex-1 whitespace-nowrap rounded-[2px] px-1 py-1 text-[12px] transition-colors ${
                    book.status === status
                      ? 'bg-action font-medium text-white'
                      : 'text-ink-muted hover:bg-hover hover:text-ink'
                  }`}
                >
                  {SHORT_STATUS[status]}
                </button>
              ))}
            </div>

            <div className="mt-3">
              <Rating
                value={book.rating}
                onChange={(rating) => updateBook.mutate({ id: book.id, patch: { rating } })}
              />
            </div>

            {/* Never taken from the clock: most books added to a journal were read some
                time ago. */}
            <dl className="mt-3 grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1 text-[12px]">
              <dt className="text-ink-faint">Started</dt>
              <dd>
                <DateField
                  label="Started reading"
                  value={book.startedAt}
                  onChange={(value) => setDate('startedAt', value)}
                />
              </dd>
              <dt className="text-ink-faint">Finished</dt>
              {/* The duration steps aside while the finish date is being edited. */}
              <dd className="group/finish flex items-center gap-1">
                <DateField
                  label="Finished reading"
                  value={book.finishedAt}
                  onChange={(value) => setDate('finishedAt', value)}
                />
                {duration !== null && (
                  <span
                    data-testid="reading-duration"
                    aria-live="polite"
                    title="Calendar time between the start and finish dates, including breaks. Not active reading time."
                    className="text-ink-muted group-focus-within/finish:invisible"
                  >
                    ·{' '}
                    {duration === 0 ? 'same day' : `${duration} ${duration === 1 ? 'day' : 'days'}`}
                  </span>
                )}
              </dd>
              {time && time.sessions > 0 && (
                <>
                  <dt className="text-ink-faint">Time read</dt>
                  <dd
                    data-testid="time-read"
                    title="Time spent reading this book in the Interleaf reader"
                    className="text-ink-muted"
                  >
                    {formatDuration(time.seconds)} · {time.sessions}{' '}
                    {time.sessions === 1 ? 'session' : 'sessions'}
                  </dd>
                </>
              )}
            </dl>

            {backwards && (
              <p role="status" className="mt-1.5 text-[12px] text-danger">
                Finished before started.
              </p>
            )}

            {metadata && metadata.subjects.length > 0 && (
              <details className="mt-3 text-[11px] text-ink-faint">
                <summary className="cursor-pointer select-none">
                  Open Library subjects ({metadata.subjects.length})
                </summary>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {metadata.subjects.map((subject, index) => (
                    <span key={`${subject}-${index}`} className="chip">
                      {subject}
                    </span>
                  ))}
                </div>
              </details>
            )}

            {/* The pull-left sits inside the rule, not on it, so the row lines up with
                the column's other edges. */}
            <div className="mt-4 border-t border-hairline pt-3">
              <button
                type="button"
                className="btn btn-ghost -ml-2"
                onClick={() => navigate({ kind: 'discover', likeBookId: book.id })}
              >
                Find books like this
              </button>
            </div>
          </aside>

          <main className="min-w-0">
            <section className="mb-8">
              <span className="eyebrow">Your review</span>

              {!isPending && (
                <ReviewBox
                  key={`review-${book.id}`}
                  bookTitle={book.title}
                  value={review?.bodyMd ?? ''}
                  onSave={(bodyMd) =>
                    saveReview.mutateAsync({ noteId: review?.id, bookTitle: book.title, bodyMd })
                  }
                />
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

              {!isPending && (quoteDraft || quotes.length > 0) && (
                <div className="flex flex-col gap-2">
                  {quoteDraft && (
                    <DraftQuoteCard
                      saving={createNote.isPending}
                      onDone={saveQuoteDraft}
                      onDiscard={() => setQuoteDraft(false)}
                    />
                  )}
                  {quotes.map((quote) => (
                    <QuoteCard
                      key={quote.id}
                      quote={quote}
                      open={openQuoteId === quote.id}
                      onToggle={() => toggleQuote(quote)}
                      onSave={(text) =>
                        updateNote.mutateAsync({ id: quote.id, patch: { bodyMd: text } })
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
                (!noteDraft && thoughts.length === 0 ? null : (
                  <div className="flex flex-col gap-2">
                    {noteDraft && (
                      <DraftNoteCard
                        bookTitle={book.title}
                        saving={createNote.isPending}
                        onDone={saveNoteDraft}
                        onDiscard={() => setNoteDraft(false)}
                      />
                    )}
                    {thoughts.map((note) => (
                      <NoteCard
                        key={note.id}
                        note={note}
                        open={openId === note.id}
                        bookTitle={book.title}
                        onToggle={() => toggleNote(note)}
                        onRename={(title) => updateNote.mutate({ id: note.id, patch: { title } })}
                        onSave={(text) =>
                          updateNote.mutateAsync({ id: note.id, patch: { bodyMd: text } })
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

function DraftQuoteCard({
  saving,
  onDone,
  onDiscard
}: {
  saving: boolean
  onDone: (body: string) => void
  onDiscard: () => void
}): ReactNode {
  const [body, setBody] = useState('')

  async function discard(): Promise<void> {
    if (body.trim()) {
      const ok = await confirm({
        title: 'Discard this quote?',
        body: 'This draft has not been saved.',
        confirmLabel: 'Discard',
        destructive: true
      })
      if (!ok) return
    }
    onDiscard()
  }

  return (
    <div data-testid="quote-card" data-open="true" className="card">
      <div className="min-h-32 px-5 py-4">
        <Editor value="" placeholder="Type the passage." onChange={setBody} onSave={setBody} />
      </div>
      <div className="flex justify-end gap-1 border-t border-hairline px-3 py-2">
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => (body.trim() ? onDone(body) : onDiscard())}
          disabled={saving}
        >
          {saving ? 'Saving…' : 'Done'}
        </button>
        <button type="button" className="btn btn-ghost btn-danger" onClick={() => void discard()}>
          Discard
        </button>
      </div>
    </div>
  )
}

function DraftNoteCard({
  bookTitle,
  saving,
  onDone,
  onDiscard
}: {
  bookTitle: string
  saving: boolean
  onDone: (title: string, body: string) => void
  onDiscard: () => void
}): ReactNode {
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const hasContent = title.trim() !== '' || body.trim() !== ''

  async function discard(): Promise<void> {
    if (hasContent) {
      const ok = await confirm({
        title: 'Discard this note?',
        body: 'This draft has not been saved.',
        confirmLabel: 'Discard',
        destructive: true
      })
      if (!ok) return
    }
    onDiscard()
  }

  return (
    <div data-testid="note-card" data-open="true" className="card">
      <div className="flex items-center gap-2 border-b border-hairline px-3 py-2">
        <input
          autoFocus
          aria-label="Note title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Untitled note"
          className="field min-w-0 flex-1 border-transparent bg-transparent font-medium hover:border-hairline focus:border-hairline"
        />
        <button
          type="button"
          className="btn btn-ghost shrink-0"
          onClick={() => (hasContent ? onDone(title, body) : onDiscard())}
          disabled={saving}
        >
          {saving ? 'Saving…' : 'Done'}
        </button>
      </div>

      <div className="min-h-40 px-4 py-3">
        <Editor
          value=""
          placeholder={`A quote, an idea, a question about ${bookTitle}…`}
          onChange={setBody}
          onSave={setBody}
        />
      </div>

      <div className="flex justify-end px-2 pb-2">
        <button type="button" className="btn btn-ghost btn-danger" onClick={() => void discard()}>
          Discard
        </button>
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
  onSave: (text: string) => void | Promise<unknown>
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
        <OpenInBook note={note} />
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

// Reads as plain text; the date input sits over it, and shows itself
// while focused so the keyboard can type a date.
function DateField({
  label,
  value,
  onChange
}: {
  label: string
  value: number | null
  onChange: (value: string) => void
}): ReactNode {
  return (
    <span className="group relative -ml-1 inline-flex">
      <span
        aria-hidden
        className={`rounded px-1 group-focus-within:invisible group-hover:bg-hover ${
          value === null ? 'text-ink-faint' : 'text-ink'
        }`}
      >
        {value === null ? 'Add date' : formatDate(value)}
      </span>
      <input
        type="date"
        aria-label={label}
        value={toDateInput(value)}
        onChange={(event) => onChange(event.target.value)}
        onClick={(event) => {
          try {
            event.currentTarget.showPicker()
          } catch {
            // Some engines refuse outside a direct click; the field still takes typing.
          }
        }}
        className="field absolute top-1/2 left-0 h-6 w-full -translate-y-1/2 cursor-pointer px-1 py-0 text-[12px] opacity-0 focus:w-[8.5rem] focus:opacity-100"
      />
    </span>
  )
}

// An unwritten review is one line rather than an empty editor, so quotes and notes stay
// near the top. It only folds back when left empty, never while it holds text.
function ReviewBox({
  bookTitle,
  value,
  onSave
}: {
  bookTitle: string
  value: string
  onSave: (bodyMd: string) => Promise<unknown>
}): ReactNode {
  const [open, setOpen] = useState(() => value.trim() !== '')
  const [opened, setOpened] = useState(false)
  const text = useRef(value)

  if (!open) {
    return (
      <button
        type="button"
        className="card mt-2.5 w-full px-5 py-3.5 text-left text-[14px] text-ink-faint hover:bg-hover"
        onClick={() => {
          setOpened(true)
          setOpen(true)
        }}
      >
        What did you make of {bookTitle}?
      </button>
    )
  }

  return (
    <div
      className="card mt-2.5 min-h-44 px-5 py-4"
      // Left empty, it folds back to one line once focus leaves the box.
      onBlur={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
        if (!text.current.trim()) setOpen(false)
      }}
    >
      <Editor
        value={value}
        autoFocus={opened}
        placeholder={`What did you make of ${bookTitle}?`}
        onChange={(next) => {
          text.current = next
        }}
        onSave={onSave}
      />
    </div>
  )
}
