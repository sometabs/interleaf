import type { Note } from '@shared/api'
import { NOTE_TAGS } from '@shared/noteTags'
import { toPlainText } from '@shared/plaintext'
import { useState, type ReactNode } from 'react'

import { relativeDate } from '../lib/dates'
import { useBooks, useCreateNote, useNotes } from '../lib/queries'
import { isNotQuote } from '../lib/quotes'
import { useView } from '../lib/view'
import Empty from './Empty'

/** The filter value standing for "has none of these" rather than "any". */
const NONE = 'none'

export default function Notes(): ReactNode {
  const { navigate } = useView()
  const { data: all = [], isPending } = useNotes()
  const { data: books = [] } = useBooks()

  // Quotes are notes too, but they have their own screen. Reviews stay, marked
  // as such, because nowhere else lists them.
  const notes = all.filter(isNotQuote)
  const createNote = useCreateNote()
  const [filter, setFilter] = useState('')

  // `''` is "everything", `NONE` the absence of the thing. Not remembered
  // between visits: a stale filter is how a list looks empty for no reason.
  const [bookFilter, setBookFilter] = useState('')
  const [tagFilter, setTagFilter] = useState('')

  function newNote(): void {
    createNote.mutate(
      { kind: 'thought' },
      { onSuccess: (note) => navigate({ kind: 'note', id: note.id }) }
    )
  }

  function bookTitle(note: Note): string | null {
    if (note.bookId === null) return null
    return books.find((book) => book.id === note.bookId)?.title ?? null
  }

  // In memory rather than through the FTS index, so it answers on the keystroke.
  const query = filter.trim().toLowerCase()

  const matching = notes.filter((note) => {
    if (
      bookFilter === NONE ? note.bookId !== null : bookFilter && note.bookId !== Number(bookFilter)
    )
      return false
    if (tagFilter === NONE ? note.tag !== null : tagFilter && note.tag !== tagFilter) return false
    if (!query) return true

    return [note.title, note.bodyMd, bookTitle(note) ?? '', note.tag ?? '']
      .join('\n')
      .toLowerCase()
      .includes(query)
  })

  const narrowed = query !== '' || bookFilter !== '' || tagFilter !== ''

  if (isPending) return <div className="h-full" />

  return (
    <div className="h-full overflow-y-auto px-8 pt-7 pb-16">
      <div className="mx-auto max-w-3xl">
        <header className="mb-6 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-[22px]">Notes</h1>
            <p className="mt-0.5 text-[13px] text-ink-muted">
              {narrowed
                ? `${matching.length} of ${notes.length} ${notes.length === 1 ? 'note' : 'notes'}`
                : `${notes.length} ${notes.length === 1 ? 'note' : 'notes'} across your library`}
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {notes.length > 0 && (
              <input
                className="field max-w-56"
                type="search"
                placeholder="Search notes…"
                aria-label="Search notes"
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
              />
            )}
            <button type="button" className="btn btn-outline shrink-0" onClick={newNote}>
              New note
            </button>
          </div>
        </header>

        {notes.length > 0 && (
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

            <select
              aria-label="Filter by tag"
              className="field w-auto py-1.5 text-[13px]"
              value={tagFilter}
              onChange={(event) => setTagFilter(event.target.value)}
            >
              <option value="">All tags</option>
              <option value={NONE}>Untagged</option>
              {NOTE_TAGS.map((name) => (
                <option key={name} value={name}>
                  {name}
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
                  setTagFilter('')
                }}
              >
                Clear
              </button>
            )}
          </div>
        )}

        {notes.length === 0 ? (
          <Empty
            title="No notes yet"
            action={
              <button type="button" className="btn btn-primary" onClick={newNote}>
                Write your first note
              </button>
            }
          />
        ) : matching.length === 0 ? (
          <p className="py-8 text-center text-ink-muted">
            {query ? `Nothing matches “${filter.trim()}”.` : 'No notes match these filters.'}
          </p>
        ) : (
          <div className="flex flex-col gap-1">
            {matching.map((note) => (
              <button
                key={note.id}
                type="button"
                data-testid="note-row"
                onClick={() => navigate({ kind: 'note', id: note.id })}
                className="flex flex-col gap-1 rounded-card px-3 py-2.5 text-left hover:bg-hover"
              >
                <span className="flex items-baseline justify-between gap-3">
                  <span className={`truncate font-medium ${note.title ? '' : 'text-ink-faint'}`}>
                    {toPlainText(note.title) || 'Untitled'}
                  </span>
                  <span className="shrink-0 text-[11px] text-ink-faint">
                    {relativeDate(note.updatedAt)}
                  </span>
                </span>

                <span
                  className={`line-clamp-2 min-w-0 wrap-anywhere text-[13px] leading-snug ${
                    note.bodyMd.trim() ? 'text-ink-muted' : 'italic text-ink-faint'
                  }`}
                >
                  {note.bodyMd.trim() ? toPlainText(note.bodyMd).slice(0, 200) : 'Empty note'}
                </span>

                <span className="flex items-center gap-2 text-[11px] text-ink-faint">
                  {note.kind === 'review' && (
                    <span className="uppercase tracking-wide">review</span>
                  )}
                  {bookTitle(note) && <span className="truncate">{bookTitle(note)}</span>}
                  {/* Pushed to the end of its own line, so it lands under the
                      date and the two make one right-hand column down the list.
                      `ml-auto` rather than `justify-between`: the row is empty
                      for an untagged note with no book, and a lone tag still
                      belongs on the right. */}
                  {note.tag && (
                    <span className="chip ml-auto shrink-0 text-[10px] tracking-wide">
                      {note.tag}
                    </span>
                  )}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
