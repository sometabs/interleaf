import { type Book } from '@shared/api'
import type { BookGroup } from '@shared/categories'
import { useMemo, useState, type ReactNode } from 'react'

import { useBooks, useBookSubjects } from '../lib/queries'
import {
  categoriesOf,
  filterByCategory,
  genresIn,
  groupBooks,
  GROUPINGS,
  type Grouping,
  type Shelf
} from '../lib/shelves'
import { useView } from '../lib/view'
import Cover from './Cover'
import Empty from './Empty'
import Rating from './Rating'

interface Props {
  onAdd: () => void
}

const GROUPS: readonly BookGroup[] = ['Fiction', 'Non-fiction']

export default function Library({ onAdd }: Props): ReactNode {
  const { navigate } = useView()
  const { data: books = [], isPending } = useBooks()
  const { data: subjects = [], error: subjectsError } = useBookSubjects()

  const [filter, setFilter] = useState('')
  const [grouping, setGrouping] = useState<Grouping>('status')
  const [group, setGroup] = useState<BookGroup | null>(null)
  const [genre, setGenre] = useState<string | null>(null)

  const categories = useMemo(() => categoriesOf(subjects, books), [subjects, books])

  const query = filter.trim().toLowerCase()
  const matching = query
    ? books.filter(
        (book) =>
          book.title.toLowerCase().includes(query) ||
          (book.author ?? '').toLowerCase().includes(query)
      )
    : books

  // Group first, then a genre inside it. The second row only offers genres
  // present in the first row's selection, so no combination empties the grid.
  const inGroup = grouping === 'category' ? filterByCategory(matching, categories, group, null) : []
  const genres = genresIn(inGroup, categories)
  const activeGenre = genre !== null && genres.includes(genre) ? genre : null
  const shown =
    grouping === 'category' ? filterByCategory(inGroup, categories, null, activeGenre) : matching

  // Narrowing to one genre already answers what the shelves ask, so the result
  // is that single shelf rather than a page of one-book sections.
  const shelves =
    activeGenre !== null
      ? [{ key: activeGenre, label: activeGenre, books: shown }]
      : groupBooks(shown, grouping, categories)

  if (isPending) return <div className="h-full" />

  if (books.length === 0) {
    return (
      <Empty
        title="Your library is empty"
        action={
          <button type="button" className="btn btn-primary" onClick={onAdd}>
            Add a book
          </button>
        }
      />
    )
  }

  // Defaulted to [], a failed read looks like an empty one and blames Open
  // Library for what is actually a broken IPC channel.
  const categoriesUnavailable = grouping === 'category' && Boolean(subjectsError)

  // Nothing looked up yet, so every shelf would read "Not categorised yet".
  // Say what to do about it rather than looking broken.
  const known = new Set(subjects.map((row) => row.bookId))
  const unfiled =
    grouping === 'category' &&
    !categoriesUnavailable &&
    matching.length > 0 &&
    !matching.some((book) => known.has(book.id))

  function chooseGroup(next: BookGroup | null): void {
    setGroup(next)
    setGenre(null) // the genres on offer are about to change
  }

  return (
    <div className="h-full overflow-y-auto px-8 pt-7 pb-16">
      <header className="mb-5 flex flex-wrap items-center gap-x-4 gap-y-3">
        <h1 className="mr-auto text-[22px]">Library</h1>

        <Segmented label="Group by" options={GROUPINGS} value={grouping} onChange={setGrouping} />

        <input
          className="field max-w-64"
          placeholder="Filter by title or author…"
          aria-label="Filter library"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        />
      </header>

      {grouping === 'category' && !categoriesUnavailable && (
        <div className="mb-6 flex flex-col gap-2.5">
          <Segmented
            label="Group"
            options={[
              { value: null, label: 'All' },
              ...GROUPS.map((value) => ({ value, label: value }))
            ]}
            value={group}
            onChange={chooseGroup}
          />

          {genres.length > 0 && (
            <div role="group" aria-label="Genre" className="flex flex-wrap gap-1.5">
              <GenreChip
                label="All genres"
                active={activeGenre === null}
                onClick={() => setGenre(null)}
              />
              {genres.map((name) => (
                <GenreChip
                  key={name}
                  label={name}
                  active={activeGenre === name}
                  onClick={() => setGenre(activeGenre === name ? null : name)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {categoriesUnavailable && (
        <p className="mb-6 text-[13px] text-ink-muted">Categories could not be loaded.</p>
      )}

      {unfiled && (
        <p className="mb-6 text-[13px] text-ink-muted">These books have no subjects yet.</p>
      )}

      {shown.length === 0 ? (
        <p className="py-8 text-center text-ink-muted">
          {query ? `Nothing matches “${filter.trim()}”.` : 'Nothing here yet.'}
        </p>
      ) : (
        shelves.map((shelf) => (
          <ShelfSection
            key={shelf.key}
            shelf={shelf}
            onOpen={(book) => navigate({ kind: 'book', id: book.id })}
          />
        ))
      )}
    </div>
  )
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

function GenreChip({
  label,
  active,
  onClick
}: {
  label: string
  active: boolean
  onClick: () => void
}): ReactNode {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`rounded-control border px-2.5 py-1 text-[12px] transition-colors ${
        active
          ? 'border-transparent bg-accent font-medium text-white'
          : 'border-hairline-strong bg-surface text-ink-muted hover:text-ink'
      }`}
    >
      {label}
    </button>
  )
}

function ShelfSection({
  shelf,
  onOpen
}: {
  shelf: Shelf
  onOpen: (book: Book) => void
}): ReactNode {
  return (
    <section className="mb-9">
      <h2 className="eyebrow mb-3">
        {shelf.label} · {shelf.books.length}
      </h2>

      <div className="grid grid-cols-[repeat(auto-fill,minmax(136px,1fr))] gap-x-4 gap-y-6">
        {shelf.books.map((book) => (
          <button
            key={book.id}
            type="button"
            onClick={() => onOpen(book)}
            className="group flex flex-col text-left"
          >
            <div className="transition-transform duration-150 group-hover:-translate-y-1">
              <Cover title={book.title} author={book.author} path={book.coverPath} />
            </div>
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
