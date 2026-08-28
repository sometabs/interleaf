import {
  fromChosenGenres,
  GENRES_BY_GROUP,
  type BookCategories,
  type BookGroup
} from '@shared/categories'
import { useState, type ReactNode } from 'react'

interface Props {
  /** The reader's choice. Null means they have made none. */
  chosen: string[] | null
  /** What Open Library's subjects classified as, or null if it has said nothing. */
  inferred: BookCategories | null
  onCommit: (next: string[]) => void
}

const GROUPS: readonly BookGroup[] = ['Fiction', 'Non-fiction']

// A choice replaces the inference rather than joining it. The vocabulary is
// exactly `GENRES`: free text would file books on near-identical shelves.
export default function GenrePicker({ chosen, inferred, onCommit }: Props): ReactNode {
  const [open, setOpen] = useState(false)

  const picked = chosen ?? []
  // What is actually in force, which is what the shelves and filters will use.
  const showing = chosen === null ? inferred : fromChosenGenres(picked)

  function toggle(genre: string): void {
    onCommit(picked.includes(genre) ? picked.filter((g) => g !== genre) : [...picked, genre])
  }

  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-center gap-1.5">
        {showing && (
          <>
            {/* The group always comes first, and is marked so it does not read
                as just another genre. */}
            <span className="chip bg-accent-soft font-medium text-accent">{showing.group}</span>
            {showing.genres.map((genre) => (
              <span key={genre} className="chip">
                {genre}
              </span>
            ))}
          </>
        )}

        <button
          type="button"
          onClick={() => setOpen((was) => !was)}
          aria-expanded={open}
          aria-label="Edit genres"
          className="chip cursor-pointer border border-dashed border-hairline-strong bg-transparent text-ink-faint hover:bg-hover"
        >
          {showing === null ? 'Add genre' : 'Edit'}
        </button>
      </div>

      {/* Said only while unchosen, and only when there is a guess to disown: a
          reader looking at the wrong shelf needs to know nobody checked it. */}
      {chosen === null && showing !== null && (
        <p className="mt-1 text-[11px] text-ink-faint">From Open Library</p>
      )}

      {open && (
        <div className="mt-2 rounded-card border border-hairline p-3">
          {GROUPS.map((group) => (
            <div key={group} className="mb-3 last:mb-0">
              <p className="mb-1.5 text-[11px] font-medium text-ink-faint">{group}</p>
              <div className="flex flex-wrap gap-1.5">
                {GENRES_BY_GROUP[group].map((genre) => {
                  const on = picked.includes(genre)
                  return (
                    <button
                      key={genre}
                      type="button"
                      aria-pressed={on}
                      onClick={() => toggle(genre)}
                      className={`chip cursor-pointer ${
                        on ? 'bg-accent-soft font-medium text-accent' : 'hover:bg-hover'
                      }`}
                    >
                      {genre}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
