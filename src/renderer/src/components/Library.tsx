import type { Book } from '@shared/api'
import { useState, type ReactNode } from 'react'

import { usePersistentState } from '../lib/persistent'
import { useBookFiles, useBooks } from '../lib/queries'
import { groupBooks, GROUPINGS, type Grouping, type Shelf } from '../lib/shelves'
import { useSettings } from '../lib/settings'
import { useView } from '../lib/view'
import Bookshelf from './Bookshelf'
import ContinueReading from './ContinueReading'
import Cover from './Cover'
import EpubBadge from './EpubBadge'
import Rating from './Rating'
import Welcome from './Welcome'

interface Props {
  onAdd: () => void
}

export default function Library({ onAdd }: Props): ReactNode {
  const { libraryLayout: layout } = useSettings()
  const { navigate } = useView()
  const { data: books = [], isPending } = useBooks()
  const [filter, setFilter] = useState('')
  const [shelfTools, setShelfTools] = useState<HTMLDivElement | null>(null)
  const [grouping, setGrouping] = usePersistentState<Grouping>(
    'interleaf.libraryGrouping',
    'status',
    parseGrouping
  )
  const { data: files = [] } = useBookFiles()
  const epubIds = new Set(files.map((file) => file.bookId))
  const [epubChoice, setEpubOnly] = usePersistentState('interleaf.libraryEpubOnly', false, (raw) =>
    typeof raw === 'boolean' ? raw : null
  )
  // With no EPUBs at all there is nothing to narrow to, so the filter steps aside.
  const epubOnly = epubChoice && epubIds.size > 0
  const query = filter.trim().toLowerCase()
  const shelfLayout = layout === 'shelf'
  const matching = query
    ? books.filter(
        (book) =>
          book.title.toLowerCase().includes(query) ||
          (book.author ?? '').toLowerCase().includes(query)
      )
    : books

  const openBook = (book: Book): void => navigate({ kind: 'book', id: book.id })

  if (isPending) return <div className="h-full" />

  if (books.length === 0) return <Welcome onAdd={onAdd} />

  return (
    <div
      className={
        shelfLayout ? 'flex h-full flex-col pt-7' : 'h-full overflow-y-auto px-8 pt-7 pb-16'
      }
    >
      <header
        className={`mb-5 flex flex-wrap items-center gap-x-4 gap-y-3${shelfLayout ? ' shrink-0 px-8' : ''}`}
      >
        <h1 className="mr-auto text-[22px]">Library</h1>

        {layout === 'grid' && (
          <Segmented label="Group by" options={GROUPINGS} value={grouping} onChange={setGrouping} />
        )}

        {epubIds.size > 0 && (
          <button
            type="button"
            aria-pressed={epubOnly}
            title={shelfLayout ? 'Fade the books without an EPUB' : 'Show only books with an EPUB'}
            className={`btn btn-outline gap-1.5 ${epubOnly ? 'border-accent bg-accent-soft text-accent' : ''}`}
            onClick={() => setEpubOnly(!epubOnly)}
          >
            <svg
              aria-hidden
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z" />
              <path d="M5 17a3 3 0 0 1 3-3h11" />
            </svg>
            EPUBs only
          </button>
        )}

        <input
          className="field max-w-64"
          placeholder={shelfLayout ? 'Find a book on the shelves…' : 'Filter by title or author…'}
          aria-label={shelfLayout ? 'Find books on shelves' : 'Filter library'}
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        />
        {shelfLayout && <div ref={setShelfTools} className="contents" />}
      </header>

      {shelfLayout ? (
        <div className="min-h-0 flex-1 overflow-y-auto px-8 pb-16">
          {!query && <ContinueReading />}
          <div className="-mx-6">
            <Bookshelf
              books={books}
              matching={matching}
              query={query}
              tools={shelfTools}
              onOpen={openBook}
              epubIds={epubIds}
              epubOnly={epubOnly}
            />
          </div>
        </div>
      ) : (
        <>
          {/* Hidden while filtering, where it would read as a filter result. */}
          {!query && <ContinueReading />}
          {matching.length === 0 ? (
            <p className="py-8 text-center text-ink-muted">
              {query ? `Nothing matches “${filter.trim()}”.` : 'Nothing here yet.'}
            </p>
          ) : epubOnly && !matching.some((book) => epubIds.has(book.id)) ? (
            <p className="py-8 text-center text-ink-muted">None of these books has an EPUB.</p>
          ) : (
            groupBooks(matching, grouping).map((shelf) => (
              <ShelfSection
                key={shelf.key}
                shelf={shelf}
                epubIds={epubIds}
                epubOnly={epubOnly}
                onOpen={openBook}
              />
            ))
          )}
        </>
      )}
    </div>
  )
}

function parseGrouping(raw: unknown): Grouping | null {
  return raw === 'status' || raw === 'author' || raw === 'alphabet' ? raw : null
}

// One control for both rows: a select would hide the options and make the two
// levels look unrelated.
function Segmented<T extends string | null>({
  label,
  options,
  value,
  onChange
}: {
  label: string
  options: readonly { value: T; label: string }[]
  value: T
  onChange: (value: T) => void
}): ReactNode {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="flex w-fit rounded-control border border-hairline-strong bg-surface p-0.5"
    >
      {options.map((option) => {
        const active = option.value === value
        return (
          <button
            key={option.label}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option.value)}
            className={`rounded-[2px] px-3 py-1 text-[13px] font-medium transition-colors ${
              active ? 'bg-sunken text-ink' : 'text-ink-muted hover:text-ink'
            }`}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

function ShelfSection({
  shelf,
  epubIds,
  epubOnly,
  onOpen
}: {
  shelf: Shelf
  epubIds: Set<number>
  epubOnly: boolean
  onOpen: (book: Book) => void
}): ReactNode {
  const shown = epubOnly ? shelf.books.filter((book) => epubIds.has(book.id)) : shelf.books
  if (shown.length === 0) return null
  return (
    <section className="mb-9">
      <h2 className="eyebrow mb-3">
        {shelf.label} · {epubOnly ? `${shown.length} of ${shelf.books.length}` : shelf.books.length}
      </h2>

      <div className="grid grid-cols-[repeat(auto-fill,minmax(136px,1fr))] gap-x-4 gap-y-6">
        {shown.map((book) => (
          <button
            key={book.id}
            type="button"
            onClick={() => onOpen(book)}
            className="group flex flex-col text-left"
          >
            <div className="relative transition-transform duration-150 group-hover:-translate-y-1">
              <Cover title={book.title} author={book.author} path={book.coverPath} />
              {epubIds.has(book.id) && <EpubBadge />}
            </div>
            {epubIds.has(book.id) && <span className="sr-only">Has an EPUB.</span>}
            <span className="mt-2.5 line-clamp-2 text-[13px] font-medium leading-snug">
              {book.title}
            </span>
            {book.author && (
              <span className="truncate text-[12px] text-ink-muted">{book.author}</span>
            )}
            {book.rating !== null && (
              <span className="mt-1 text-[12px]">
                <Rating value={book.rating} readOnly />
              </span>
            )}
          </button>
        ))}
      </div>
    </section>
  )
}
