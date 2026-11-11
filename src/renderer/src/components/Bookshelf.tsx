import type { Book } from '@shared/api'
import { useState, type CSSProperties, type DragEvent, type ReactNode } from 'react'

import { insertAround, sameOrder } from '../lib/bookOrder'
import { paletteFor } from '../lib/bookPalette'
import { usePersistentState } from '../lib/persistent'
import { useSpineColors } from '../lib/queries'

interface Props {
  books: Book[]
  matching: Book[]
  onOpen: (book: Book) => void
}

interface Placement {
  bookId: number
  after: boolean
}

function parseOrder(raw: unknown): number[] | null {
  if (!Array.isArray(raw)) return null
  return [
    ...new Set(raw.filter((id) => typeof id === 'number' && Number.isSafeInteger(id) && id > 0))
  ]
}

function placementAt(event: DragEvent<HTMLDivElement>): Placement | null {
  let slot =
    event.target instanceof Element ? event.target.closest<HTMLElement>('[data-shelf-book]') : null

  if (!slot) {
    // Empty shelf space belongs to the nearest book on that row, including the
    // space after the last book. Slots reach from the top of a row to its ledge.
    for (const bookSlot of event.currentTarget.querySelectorAll<HTMLElement>('[data-shelf-book]')) {
      const rect = bookSlot.getBoundingClientRect()
      if (event.clientY < rect.top) break
      if (event.clientY >= rect.bottom) continue
      slot = bookSlot
      if (event.clientX < rect.right) break
    }
  }

  if (!slot) return null
  const rect = slot.getBoundingClientRect()
  return {
    bookId: Number(slot.dataset.shelfBook),
    after: event.clientX >= rect.left + rect.width / 2
  }
}

export default function Bookshelf({ books, matching, onOpen }: Props): ReactNode {
  const { data: spineColors } = useSpineColors(books)
  const [savedOrder, setSavedOrder] = usePersistentState('interleaf.bookshelfOrder', [], parseOrder)
  const [draggedBookId, setDraggedBookId] = useState<number | null>(null)
  const [placement, setPlacement] = useState<Placement | null>(null)
  const positions = new Map(savedOrder.map((id, index) => [id, index]))
  const arranged = [...books].sort(
    (left, right) =>
      (positions.get(left.id) ?? positions.size) - (positions.get(right.id) ?? positions.size) ||
      left.id - right.id
  )
  const order = arranged.map((book) => book.id)
  const matchingIds = new Set(matching.map((book) => book.id))
  const visible = arranged.filter((book) => matchingIds.has(book.id))

  function move(bookId: number, target: Placement): void {
    if (!order.includes(bookId)) return
    const next = insertAround(order, bookId, target.bookId, target.after)
    if (!sameOrder(order, next)) setSavedOrder(next)
  }

  function endDrag(): void {
    setDraggedBookId(null)
    setPlacement(null)
  }

  return (
    <section aria-label="Bookshelf">
      <p className="mb-3 text-[13px] text-ink-muted">Drag books to arrange your shelf.</p>
      <div
        role="list"
        className="bookshelf"
        onDragOver={(event) => {
          if (draggedBookId === null) return
          const target = placementAt(event)
          if (target) {
            event.preventDefault()
            event.dataTransfer.dropEffect = 'move'
          }
          setPlacement((previous) =>
            previous?.bookId === target?.bookId && previous?.after === target?.after
              ? previous
              : target
          )
        }}
        onDragLeave={(event) => {
          if (
            !(event.relatedTarget instanceof Node) ||
            !event.currentTarget.contains(event.relatedTarget)
          ) {
            setPlacement(null)
          }
        }}
        onDrop={(event) => {
          if (draggedBookId === null) return
          event.preventDefault()
          const target = placementAt(event)
          if (target) move(draggedBookId, target)
          endDrag()
        }}
      >
        {visible.map((book) => {
          const palette =
            (book.coverPath && spineColors?.[book.coverPath]) || paletteFor(book.title)
          const thickness = Math.min(520, Math.max(0, (book.pageCount ?? 250) - 100))
          const label = book.author ? `${book.title} by ${book.author}` : book.title
          const style = {
            width: 36 + Math.round(thickness / 14),
            height: 166 + (book.id % 5) * 9,
            color: palette.ink,
            backgroundColor: palette.cover,
            '--spine-detail': palette.detail
          } as CSSProperties

          return (
            <div
              key={book.id}
              role="listitem"
              data-shelf-book={book.id}
              data-drop-side={
                placement?.bookId === book.id && book.id !== draggedBookId
                  ? placement.after
                    ? 'after'
                    : 'before'
                  : undefined
              }
              className="bookshelf-slot"
            >
              <button
                type="button"
                className="book-spine"
                style={style}
                draggable
                aria-label={label}
                title={label}
                data-dragging={draggedBookId === book.id || undefined}
                onClick={() => onOpen(book)}
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = 'move'
                  event.dataTransfer.setData('text/plain', String(book.id))
                  setDraggedBookId(book.id)
                }}
                onDragEnd={endDrag}
              >
                <span aria-hidden="true" className="book-spine-copy">
                  <span className="book-spine-title">{book.title}</span>
                  {book.author && <span className="book-spine-author">{book.author}</span>}
                </span>
              </button>
            </div>
          )
        })}
      </div>
    </section>
  )
}
