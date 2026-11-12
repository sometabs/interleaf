import type { Book } from '@shared/api'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, DragEvent, ReactNode } from 'react'
import { createPortal } from 'react-dom'

import { sameOrder } from '../lib/bookOrder'
import { paletteFor } from '../lib/bookPalette'
import {
  arrangeShelves,
  parseFaceOutBooks,
  parseShelves,
  SHELF_SPAN,
  shelfInsertion,
  spineWidth,
  type Shelf
} from '../lib/bookshelfLayout'
import { usePersistentState } from '../lib/persistent'
import { useSpineColors } from '../lib/queries'
import Cover from './Cover'
import EditableTitle from './EditableTitle'

interface Props {
  books: Book[]
  matching: Book[]
  onOpen: (book: Book) => void
}

interface Placement {
  shelf: Shelf
  outlineX: number
}

interface Preview {
  bookId: number
  left: number
  top: number
  width: number
}

const PREVIEW_WIDTH = 248
const TEXT_PREVIEW_WIDTH = 196
const PREVIEW_MAX_HEIGHT = 144
const PREVIEW_GAP = 10
const FACE_OUT_WIDTH = 112

export default function Bookshelf({ books, matching, onOpen }: Props): ReactNode {
  const { data: spineColors } = useSpineColors(books)
  const [savedShelves, setSavedShelves] = usePersistentState(
    'interleaf.bookshelves',
    [],
    parseShelves,
    'interleaf.bookshelfOrder'
  )
  const [faceOutBooks, setFaceOutBooks] = usePersistentState(
    'interleaf.bookshelfFaceOut',
    [],
    parseFaceOutBooks
  )
  const [draggedBookId, setDraggedBookId] = useState<number | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const previewTimer = useRef<number | undefined>(undefined)
  const grabOffset = useRef(0)
  const dropOutline = useRef<HTMLElement | null>(null)
  const faceOutIds = useMemo(() => new Set(faceOutBooks), [faceOutBooks])
  const widths = useMemo(
    () =>
      new Map(
        books.map((book) => [
          book.id,
          faceOutIds.has(book.id) ? FACE_OUT_WIDTH : spineWidth(book.pageCount)
        ])
      ),
    [books, faceOutIds]
  )
  const shelves = useMemo(() => arrangeShelves(savedShelves, widths), [savedShelves, widths])
  const matchingById = useMemo(() => new Map(matching.map((book) => [book.id, book])), [matching])
  const previewBook = preview && matchingById.get(preview.bookId)

  const hidePreview = useCallback((): void => {
    window.clearTimeout(previewTimer.current)
    setPreview(null)
  }, [])

  useEffect(() => {
    function dismissOnEscape(event: KeyboardEvent): void {
      if (event.key === 'Escape') hidePreview()
    }

    window.addEventListener('scroll', hidePreview, true)
    window.addEventListener('resize', hidePreview)
    window.addEventListener('keydown', dismissOnEscape)
    return () => {
      window.clearTimeout(previewTimer.current)
      window.removeEventListener('scroll', hidePreview, true)
      window.removeEventListener('resize', hidePreview)
      window.removeEventListener('keydown', dismissOnEscape)
    }
  }, [hidePreview])

  function queuePreview(bookId: number, button: HTMLButtonElement): void {
    hidePreview()
    if (draggedBookId !== null) return

    previewTimer.current = window.setTimeout(() => {
      if (!button.isConnected) return
      const { left, right, top, height } = button.getBoundingClientRect()
      const nextToRight = right + PREVIEW_GAP
      const width = faceOutIds.has(bookId) ? TEXT_PREVIEW_WIDTH : PREVIEW_WIDTH
      setPreview({
        bookId,
        width,
        left:
          nextToRight + width + PREVIEW_GAP <= window.innerWidth
            ? nextToRight
            : Math.max(PREVIEW_GAP, left - PREVIEW_GAP - width),
        top: Math.max(
          PREVIEW_GAP,
          Math.min(
            top + (height - PREVIEW_MAX_HEIGHT) / 2,
            window.innerHeight - PREVIEW_MAX_HEIGHT - PREVIEW_GAP
          )
        )
      })
    }, 400)
  }

  function placementAt(
    event: DragEvent<HTMLDivElement>,
    shelf: Shelf
  ): Placement | null | undefined {
    if (draggedBookId === null) return null
    const strip = event.currentTarget.querySelector('.bookshelf-spines')
    const track = strip?.parentElement
    if (!strip || !track) return null

    const origin = strip.getBoundingClientRect().left
    const left = Math.round((event.clientX || 0) - origin - grabOffset.current)
    const slot =
      event.target instanceof Element
        ? event.target.closest<HTMLElement>('[data-shelf-book]')
        : null
    const slotId = Number(slot?.dataset.shelfBook)
    // Hovering the source is a no-op. A full destination rejects the drop.
    if (slotId === draggedBookId) return undefined
    const bounds = slot?.getBoundingClientRect()
    const neighbor = bounds
      ? { bookId: slotId, after: event.clientX >= bounds.left + bounds.width / 2 }
      : undefined
    const insertion = shelfInsertion(shelf, draggedBookId, widths, left, neighbor)
    if (!insertion) return null
    return {
      shelf: insertion,
      outlineX: origin - track.getBoundingClientRect().left + insertion.positions[draggedBookId]
    }
  }

  function hideDropOutline(row?: HTMLDivElement): void {
    const outline = dropOutline.current
    if (!outline || (row && !row.contains(outline))) return
    outline.removeAttribute('data-active')
    dropOutline.current = null
  }

  function showDropOutline(row: HTMLDivElement, target: Placement, bookId: number): void {
    const outline = row.querySelector<HTMLElement>('.bookshelf-drop-preview')!
    const changedRow = dropOutline.current !== outline
    if (changedRow) {
      hideDropOutline()
      outline.style.width = `${widths.get(bookId)}px`
      outline.style.height = `${bookHeight(bookId)}px`
      dropOutline.current = outline
    }
    outline.style.transform = `translateX(${target.outlineX}px)`
    if (changedRow) outline.setAttribute('data-active', '')
  }

  function move(bookId: number, target: Shelf): void {
    const source = shelves.find((shelf) => shelf.bookIds.includes(bookId))
    const destination = shelves.find((shelf) => shelf.id === target.id)
    if (!source || !destination) return

    if (
      destination.positions[bookId] === target.positions[bookId] &&
      sameOrder(destination.bookIds, target.bookIds)
    )
      return

    const updated = shelves.map((shelf) => {
      if (shelf === destination) return target
      if (shelf === source)
        return { ...shelf, bookIds: shelf.bookIds.filter((id) => id !== bookId) }
      return shelf
    })
    setSavedShelves(arrangeShelves(updated, widths))
  }

  function endDrag(): void {
    hideDropOutline()
    setDraggedBookId(null)
  }

  function addShelf(): void {
    const id = Math.max(...shelves.map((shelf) => shelf.id)) + 1
    setSavedShelves([...shelves, { id, bookIds: [], positions: {} }])
  }

  function moveShelf(index: number, offset: -1 | 1): void {
    const destination = index + offset
    if (destination < 0 || destination >= shelves.length) return

    const next = [...shelves]
    next[index] = shelves[destination]
    next[destination] = shelves[index]
    hidePreview()
    setSavedShelves(next)
  }

  function bookHeight(bookId: number): number {
    return faceOutIds.has(bookId) ? FACE_OUT_WIDTH * 1.5 : 166 + (bookId % 5) * 9
  }

  function turnBook(bookId: number): void {
    hidePreview()
    setFaceOutBooks(
      faceOutIds.has(bookId)
        ? faceOutBooks.filter((id) => id !== bookId)
        : [...faceOutBooks, bookId]
    )
  }

  function renderBook(book: Book, left: number): ReactNode {
    const palette = (book.coverPath && spineColors?.[book.coverPath]) || paletteFor(book.title)
    const width = widths.get(book.id)!
    const label = book.author ? `${book.title} by ${book.author}` : book.title
    const faceOut = faceOutIds.has(book.id)
    const style = {
      width,
      height: bookHeight(book.id),
      ...(!faceOut && {
        color: palette.ink,
        backgroundColor: palette.cover,
        '--spine-detail': palette.detail
      })
    } as CSSProperties

    return (
      <div
        key={book.id}
        role="listitem"
        data-shelf-book={book.id}
        style={{ '--shelf-x': `${left}px` } as CSSProperties}
        className="bookshelf-slot"
      >
        <button
          type="button"
          className={faceOut ? 'bookshelf-book' : 'bookshelf-book book-spine'}
          style={style}
          draggable
          aria-label={label}
          data-dragging={draggedBookId === book.id || undefined}
          onMouseEnter={(event) => queuePreview(book.id, event.currentTarget)}
          onMouseLeave={hidePreview}
          onClick={() => onOpen(book)}
          onContextMenu={(event) => {
            event.preventDefault()
            turnBook(book.id)
          }}
          onDragStart={(event) => {
            hidePreview()
            const { left } = event.currentTarget.getBoundingClientRect()
            grabOffset.current = Math.max(0, Math.min(width, (event.clientX || 0) - left))
            event.dataTransfer.effectAllowed = 'move'
            event.dataTransfer.setData('text/plain', String(book.id))
            setDraggedBookId(book.id)
          }}
          onDragEnd={endDrag}
        >
          {faceOut ? (
            <div aria-hidden="true" className="pointer-events-none">
              <Cover title={book.title} author={book.author} path={book.coverPath} />
            </div>
          ) : (
            <span aria-hidden="true" className="book-spine-copy">
              <span className="book-spine-title">{book.title}</span>
              {book.author && <span className="book-spine-author">{book.author}</span>}
            </span>
          )}
        </button>
      </div>
    )
  }

  return (
    <section
      aria-label="Bookshelf"
      className="bookshelf-section"
      style={{ '--shelf-span': `${SHELF_SPAN}px` } as CSSProperties}
    >
      <p className="mb-3 text-[13px] text-ink-muted">
        Drag books to arrange them. Right-click a book to show its cover or spine.
      </p>
      <div className="bookshelf">
        {shelves.map((shelf, index) => {
          const visible = shelf.bookIds
            .map((id) => matchingById.get(id))
            .filter((book) => book !== undefined)
          const empty = shelf.bookIds.length === 0
          const defaultName = `Shelf ${index + 1}`
          const name = shelf.name ?? defaultName
          return (
            <div key={shelf.id}>
              <div className="bookshelf-header flex items-center justify-between gap-2 px-3">
                <EditableTitle
                  label={`Name for shelf ${index + 1}`}
                  value={shelf.name ?? ''}
                  placeholder={defaultName}
                  hint="Rename shelf"
                  className="min-w-0 max-w-full py-0.5 text-base font-medium text-ink-muted!"
                  onCommit={(nextName) =>
                    setSavedShelves(
                      shelves.map((row) =>
                        row.id === shelf.id ? { ...row, name: nextName || undefined } : row
                      )
                    )
                  }
                />
                {shelves.length > 1 && (
                  <div className="flex shrink-0">
                    <button
                      type="button"
                      aria-label={`Move ${name} up`}
                      title="Move shelf up"
                      disabled={index === 0}
                      className="btn btn-ghost px-2 py-0.5 disabled:opacity-25"
                      onClick={() => moveShelf(index, -1)}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      aria-label={`Move ${name} down`}
                      title="Move shelf down"
                      disabled={index === shelves.length - 1}
                      className="btn btn-ghost px-2 py-0.5 disabled:opacity-25"
                      onClick={() => moveShelf(index, 1)}
                    >
                      ↓
                    </button>
                  </div>
                )}
              </div>
              <div
                className="bookshelf-row"
                onDragOver={(event) => {
                  if (draggedBookId === null) return
                  event.preventDefault()
                  const target = placementAt(event, shelf)
                  event.dataTransfer.dropEffect = target === null ? 'none' : 'move'
                  if (target) showDropOutline(event.currentTarget, target, draggedBookId)
                  else hideDropOutline(event.currentTarget)
                }}
                onDragLeave={(event) => {
                  if (
                    !(event.relatedTarget instanceof Node) ||
                    !event.currentTarget.contains(event.relatedTarget)
                  ) {
                    hideDropOutline(event.currentTarget)
                  }
                }}
                onDrop={(event) => {
                  if (draggedBookId === null) return
                  event.preventDefault()
                  const target = placementAt(event, shelf)
                  if (target) move(draggedBookId, target.shelf)
                  endDrag()
                }}
              >
                <div role="list" aria-label={name} className="bookshelf-track">
                  <div className="bookshelf-spines">
                    {visible.map((book) => renderBook(book, shelf.positions[book.id]))}
                  </div>
                </div>
                <div aria-hidden="true" className="bookshelf-drop-layer">
                  <span className="bookshelf-drop-preview" />
                </div>
                {empty && (
                  <>
                    <p className="pointer-events-none absolute inset-0 flex items-center justify-center text-[13px] text-ink-muted">
                      Drag books here
                    </p>
                    {shelves.length > 1 && (
                      <button
                        type="button"
                        aria-label={`Remove empty shelf ${index + 1}`}
                        className="btn btn-ghost absolute top-2 right-2 text-[12px]"
                        onClick={() =>
                          setSavedShelves(shelves.filter((row) => row.id !== shelf.id))
                        }
                      >
                        Remove shelf
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          )
        })}
      </div>
      <button type="button" className="btn btn-outline mt-3" onClick={addShelf}>
        Add shelf
      </button>
      {preview &&
        previewBook &&
        createPortal(
          <div
            aria-hidden="true"
            className="pointer-events-none fixed z-30 flex items-center gap-3 overflow-hidden rounded-card border border-hairline bg-surface p-3 shadow-raised"
            style={{
              left: preview.left,
              top: preview.top,
              width: preview.width,
              maxHeight: PREVIEW_MAX_HEIGHT
            }}
          >
            {!faceOutIds.has(previewBook.id) && (
              <div className="w-16 shrink-0">
                <Cover
                  title={previewBook.title}
                  author={previewBook.author}
                  path={previewBook.coverPath}
                />
              </div>
            )}
            <div className="min-w-0 wrap-anywhere">
              <p className="line-clamp-4 text-sm leading-tight font-semibold">
                {previewBook.title}
              </p>
              {previewBook.author && (
                <p className="mt-1 line-clamp-2 text-xs leading-snug text-ink-muted">
                  {previewBook.author}
                </p>
              )}
            </div>
          </div>,
          document.body
        )}
    </section>
  )
}
