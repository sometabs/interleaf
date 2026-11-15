import * as Dialog from '@radix-ui/react-dialog'
import type { Book } from '@shared/api'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type {
  CSSProperties,
  DragEvent,
  KeyboardEvent as ReactKeyboardEvent,
  ReactNode
} from 'react'
import { createPortal } from 'react-dom'

import { sameOrder } from '../lib/bookOrder'
import { paletteFor } from '../lib/bookPalette'
import {
  arrangeShelves,
  DEFAULT_SHELF_SPAN,
  parseFaceOutBooks,
  parseShelves,
  restoreShelf,
  saveShelves,
  shelfInsertion,
  spineWidth,
  wrapShelf,
  type Shelf,
  type ShelfRow
} from '../lib/bookshelfLayout'
import { notify } from '../lib/feedback'
import { usePersistentState } from '../lib/persistent'
import { useSpineColors } from '../lib/queries'
import { useSettings } from '../lib/settings'
import Cover from './Cover'
import EditableTitle from './EditableTitle'
import FilterPicker from './FilterPicker'

interface Props {
  books: Book[]
  matching: Book[]
  query: string
  tools: HTMLDivElement | null
  onOpen: (book: Book) => void
}

interface Placement {
  row: ShelfRow
  outlineX: number
}

interface Preview {
  bookId: number
  left: number
  top: number
  width: number
}

interface BookMenu {
  bookId: number
  trigger: HTMLButtonElement
  left: number
  top: number
}

const PREVIEW_WIDTH = 248
const TEXT_PREVIEW_WIDTH = 196
const PREVIEW_MAX_HEIGHT = 144
const PREVIEW_GAP = 10
const FACE_OUT_WIDTH = 112
const BOOK_MENU_WIDTH = 200
const DESTINATION_MENU_HEIGHT = 240
const menuItemClass = 'btn w-full justify-start px-2 py-1.5 text-sm'

export default function Bookshelf({ books, matching, query, tools, onOpen }: Props): ReactNode {
  const { data: spineColors } = useSpineColors(books)
  const { motionEnabled } = useSettings()
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
  const [draggedItemId, setDraggedItemId] = useState<number | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [bookMenu, setBookMenu] = useState<BookMenu | null>(null)
  const [choosingShelf, setChoosingShelf] = useState(false)
  const [span, setSpan] = useState(DEFAULT_SHELF_SPAN)
  const shelfRef = useRef<HTMLDivElement>(null)
  const searchScrollTimer = useRef<number | undefined>(undefined)
  const bookMenuRef = useRef<HTMLDivElement>(null)
  const previewTimer = useRef<number | undefined>(undefined)
  const grabOffset = useRef(0)
  const dropOutline = useRef<HTMLElement | null>(null)
  const faceOutIds = useMemo(() => new Set(faceOutBooks), [faceOutBooks])
  const booksById = useMemo(() => new Map(books.map((book) => [book.id, book])), [books])
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
  const shelves = useMemo(
    () => arrangeShelves(savedShelves.map(restoreShelf), widths),
    [savedShelves, widths]
  )
  const matchingIds = useMemo(() => new Set(matching.map((book) => book.id)), [matching])
  const previewBook = preview && booksById.get(preview.bookId)
  const menuBook = bookMenu && booksById.get(bookMenu.bookId)
  const firstMatchId = query
    ? shelves.flatMap((shelf) => shelf.itemIds).find((id) => matchingIds.has(id))
    : undefined

  useEffect(() => {
    if (firstMatchId === undefined) return
    searchScrollTimer.current = window.setTimeout(() => {
      shelfRef.current?.querySelector(`[data-shelf-item="${firstMatchId}"]`)?.scrollIntoView({
        block: 'nearest',
        inline: 'nearest'
      })
    }, 200)
    return () => window.clearTimeout(searchScrollTimer.current)
  }, [query, firstMatchId])

  useLayoutEffect(() => {
    const shelf = shelfRef.current
    if (!shelf) return
    const measure = (): void => {
      if (shelf.clientWidth > 0) setSpan(shelf.clientWidth)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(shelf)
    return () => observer.disconnect()
  }, [])

  const hidePreview = useCallback((): void => {
    window.clearTimeout(previewTimer.current)
    setPreview(null)
  }, [])

  useEffect(() => {
    function dismissFloatingContent(event: Event): void {
      if (event.target instanceof Node && bookMenuRef.current?.contains(event.target)) return
      hidePreview()
      setBookMenu(null)
    }

    function dismissOnEscape(event: KeyboardEvent): void {
      if (event.key === 'Escape') hidePreview()
    }

    window.addEventListener('scroll', dismissFloatingContent, true)
    window.addEventListener('resize', dismissFloatingContent)
    window.addEventListener('keydown', dismissOnEscape)
    return () => {
      window.clearTimeout(previewTimer.current)
      window.removeEventListener('scroll', dismissFloatingContent, true)
      window.removeEventListener('resize', dismissFloatingContent)
      window.removeEventListener('keydown', dismissOnEscape)
    }
  }, [hidePreview])

  useLayoutEffect(() => {
    if (choosingShelf) bookMenuRef.current?.querySelector<HTMLButtonElement>('button')?.focus()
  }, [choosingShelf])

  function jumpToShelf(id: string): void {
    window.clearTimeout(searchScrollTimer.current)
    shelfRef.current?.querySelector(`[data-shelf-id="${id}"]`)?.scrollIntoView({
      block: 'start',
      inline: 'nearest',
      behavior: motionEnabled ? 'smooth' : 'instant'
    })
  }

  function queuePreview(bookId: number, button: HTMLButtonElement): void {
    hidePreview()
    if (draggedItemId !== null || bookMenu) return

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
    row: ShelfRow
  ): Placement | null | undefined {
    if (draggedItemId === null) return null
    const strip = event.currentTarget.querySelector('.bookshelf-spines')
    const track = strip?.parentElement
    if (!strip || !track) return null

    const origin = strip.getBoundingClientRect().left
    const left = Math.round((event.clientX || 0) - origin - grabOffset.current)
    const slot =
      event.target instanceof Element
        ? event.target.closest<HTMLElement>('[data-shelf-item]')
        : null
    const slotId = Number(slot?.dataset.shelfItem)
    // Hovering the source is a no-op. A full destination rejects the drop.
    if (slotId === draggedItemId) return undefined
    const bounds = slot?.getBoundingClientRect()
    const neighbor = bounds
      ? { itemId: slotId, after: event.clientX >= bounds.left + bounds.width / 2 }
      : undefined
    const insertion = shelfInsertion(row, draggedItemId, widths, span, left, neighbor)
    if (!insertion) return null
    return {
      row: insertion,
      outlineX: origin - track.getBoundingClientRect().left + insertion.positions[draggedItemId]
    }
  }

  function hideDropOutline(row?: HTMLDivElement): void {
    const outline = dropOutline.current
    if (!outline || (row && !row.contains(outline))) return
    outline.removeAttribute('data-active')
    dropOutline.current = null
  }

  function showDropOutline(row: HTMLDivElement, target: Placement, itemId: number): void {
    const outline = row.querySelector<HTMLElement>('.bookshelf-drop-preview')!
    const changedRow = dropOutline.current !== outline
    if (changedRow) {
      hideDropOutline()
      outline.style.width = `${widths.get(itemId)}px`
      outline.style.height = `${bookHeight(itemId)}px`
      dropOutline.current = outline
    }
    outline.style.transform = `translateX(${target.outlineX}px)`
    if (changedRow) outline.setAttribute('data-active', '')
  }

  function saveRows(rows: Shelf[]): void {
    setSavedShelves(saveShelves(rows))
  }

  function move(itemId: number, shelfId: number, row: ShelfRow, target: ShelfRow): void {
    if (
      row.positions[itemId] === target.positions[itemId] &&
      sameOrder(row.itemIds, target.itemIds)
    )
      return

    const updated = shelves.map((shelf) => {
      if (shelf.id !== shelfId) {
        return shelf.itemIds.includes(itemId)
          ? { ...shelf, itemIds: shelf.itemIds.filter((id) => id !== itemId) }
          : shelf
      }
      // Replace the visible slice in the saved shelf, keeping its other rows together.
      const before = shelf.itemIds.slice(0, row.start).filter((id) => id !== itemId)
      const after = shelf.itemIds
        .slice(row.start + row.itemIds.length)
        .filter((id) => id !== itemId)
      const positions = { ...shelf.positions }
      for (const id of target.itemIds) positions[id] = row.origin + target.positions[id]
      return { ...shelf, itemIds: [...before, ...target.itemIds, ...after], positions }
    })
    saveRows(arrangeShelves(updated, widths))
  }

  function moveBookToShelf(book: Book, shelfId: number, shelfName: string): void {
    const updated = shelves.map((shelf) => {
      if (shelf.id === shelfId) return { ...shelf, itemIds: [...shelf.itemIds, book.id] }
      if (shelf.itemIds.includes(book.id)) {
        return { ...shelf, itemIds: shelf.itemIds.filter((id) => id !== book.id) }
      }
      return shelf
    })
    saveRows(arrangeShelves(updated, widths))
    setBookMenu(null)
    notify(`Moved ${book.title} to ${shelfName}.`)
  }

  function openBookMenu(bookId: number, trigger: HTMLButtonElement, x: number, y: number): void {
    hidePreview()
    setChoosingShelf(false)
    setBookMenu({ bookId, trigger, left: x, top: y })
  }

  function startDrag(event: DragEvent<HTMLElement>, itemId: number): void {
    hidePreview()
    const { left } = event.currentTarget.getBoundingClientRect()
    grabOffset.current = Math.max(0, Math.min(widths.get(itemId)!, (event.clientX || 0) - left))
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', String(itemId))
    setDraggedItemId(itemId)
  }

  function endDrag(): void {
    hideDropOutline()
    setDraggedItemId(null)
  }

  function addShelf(): void {
    const id = Math.max(...shelves.map((shelf) => shelf.id)) + 1
    saveRows([...shelves, { id, itemIds: [], positions: {} }])
  }

  function moveShelf(index: number, offset: -1 | 1): void {
    const destination = index + offset
    if (destination < 0 || destination >= shelves.length) return

    const next = [...shelves]
    next[index] = shelves[destination]
    next[destination] = shelves[index]
    hidePreview()
    saveRows(next)
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
        data-shelf-item={book.id}
        style={{ '--shelf-x': `${left}px` } as CSSProperties}
        className="bookshelf-slot"
      >
        <button
          type="button"
          className={faceOut ? 'bookshelf-book' : 'bookshelf-book book-spine'}
          style={style}
          draggable
          aria-label={label}
          aria-haspopup="menu"
          aria-expanded={bookMenu?.bookId === book.id}
          data-dragging={draggedItemId === book.id || undefined}
          data-search-match={(query && matchingIds.has(book.id)) || undefined}
          onMouseEnter={(event) => queuePreview(book.id, event.currentTarget)}
          onMouseLeave={hidePreview}
          onClick={() => onOpen(book)}
          onContextMenu={(event) => {
            event.preventDefault()
            openBookMenu(book.id, event.currentTarget, event.clientX, event.clientY)
          }}
          onKeyDown={(event) => {
            if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return
            event.preventDefault()
            event.stopPropagation()
            const { left, bottom } = event.currentTarget.getBoundingClientRect()
            openBookMenu(book.id, event.currentTarget, left, bottom)
          }}
          onDragStart={(event) => startDrag(event, book.id)}
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
      data-searching={(query && matching.length > 0) || undefined}
    >
      {tools &&
        shelves.length > 1 &&
        createPortal(
          <FilterPicker
            label="Jump to shelf"
            options={shelves.map((shelf, index) => ({
              value: String(shelf.id),
              label: shelf.name ?? `Shelf ${index + 1}`
            }))}
            onChange={jumpToShelf}
            align="end"
          />,
          tools
        )}
      <p className="mb-3 text-[13px] text-ink-muted">
        Drag books to arrange them. Right-click a book for options.
      </p>
      <div className="bookshelf" ref={shelfRef}>
        {shelves.map((shelf, index) => {
          const empty = shelf.itemIds.length === 0
          const defaultName = `Shelf ${index + 1}`
          const name = shelf.name ?? defaultName
          return (
            <div key={shelf.id} data-shelf-id={shelf.id}>
              <div className="bookshelf-header flex items-center justify-between gap-2 px-3">
                <EditableTitle
                  label={`Name for shelf ${index + 1}`}
                  value={shelf.name ?? ''}
                  placeholder={defaultName}
                  hint="Rename shelf"
                  className="min-w-0 max-w-full py-0.5 text-base font-medium text-ink-muted!"
                  onCommit={(nextName) =>
                    saveRows(
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
              {wrapShelf(shelf, widths, span).map((row, rowIndex, rows) => (
                <div
                  key={rowIndex}
                  className="bookshelf-row"
                  data-continues={rowIndex < rows.length - 1 || undefined}
                  onDragOver={(event) => {
                    if (draggedItemId === null) return
                    event.preventDefault()
                    const target = placementAt(event, row)
                    event.dataTransfer.dropEffect = target === null ? 'none' : 'move'
                    if (target) showDropOutline(event.currentTarget, target, draggedItemId)
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
                    if (draggedItemId === null) return
                    event.preventDefault()
                    const target = placementAt(event, row)
                    if (target) move(draggedItemId, shelf.id, row, target.row)
                    endDrag()
                  }}
                >
                  <div
                    role="list"
                    aria-label={rowIndex === 0 ? name : `${name}, row ${rowIndex + 1}`}
                    className="bookshelf-track"
                  >
                    <div className="bookshelf-spines">
                      {row.itemIds.map((id) => {
                        const book = booksById.get(id)
                        return book && renderBook(book, row.positions[id])
                      })}
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
                          onClick={() => saveRows(shelves.filter((row) => row.id !== shelf.id))}
                        >
                          Remove shelf
                        </button>
                      )}
                    </>
                  )}
                </div>
              ))}
            </div>
          )
        })}
      </div>
      {menuBook && bookMenu && (
        <Dialog.Root open modal={false} onOpenChange={() => setBookMenu(null)}>
          <Dialog.Portal>
            <Dialog.Content
              ref={bookMenuRef}
              role="menu"
              aria-describedby={undefined}
              className="fixed z-50 overflow-y-auto overscroll-contain rounded-card border border-hairline bg-surface p-1 shadow-pop"
              style={{
                left: Math.max(8, Math.min(bookMenu.left, window.innerWidth - BOOK_MENU_WIDTH - 8)),
                top: Math.max(
                  8,
                  Math.min(
                    bookMenu.top,
                    window.innerHeight - (choosingShelf ? DESTINATION_MENU_HEIGHT : 80) - 8
                  )
                ),
                width: BOOK_MENU_WIDTH,
                maxHeight: DESTINATION_MENU_HEIGHT
              }}
              onKeyDown={moveMenuFocus}
              onEscapeKeyDown={(event) => event.stopPropagation()}
              onCloseAutoFocus={(event) => {
                event.preventDefault()
                if (document.activeElement !== document.body) return
                const trigger = bookMenu.trigger.isConnected
                  ? bookMenu.trigger
                  : shelfRef.current?.querySelector<HTMLButtonElement>(
                      `[data-shelf-item="${bookMenu.bookId}"] > button`
                    )
                trigger?.focus({ preventScroll: true })
              }}
            >
              <Dialog.Title
                className={choosingShelf ? 'px-2 py-1 text-xs text-ink-muted' : 'sr-only'}
              >
                {choosingShelf ? 'Move to shelf' : `Options for ${menuBook.title}`}
              </Dialog.Title>
              {choosingShelf ? (
                shelves.map((shelf, index) => {
                  if (shelf.itemIds.includes(menuBook.id)) return null
                  const name = shelf.name ?? `Shelf ${index + 1}`
                  return (
                    <button
                      key={shelf.id}
                      type="button"
                      role="menuitem"
                      className={menuItemClass}
                      title={name}
                      onClick={() => moveBookToShelf(menuBook, shelf.id, name)}
                    >
                      <span className="truncate">{name}</span>
                    </button>
                  )
                })
              ) : (
                <>
                  <Dialog.Close
                    role="menuitem"
                    className={menuItemClass}
                    onClick={() => turnBook(menuBook.id)}
                  >
                    {faceOutIds.has(menuBook.id) ? 'Show spine' : 'Show cover'}
                  </Dialog.Close>
                  {shelves.length > 1 && (
                    <button
                      type="button"
                      role="menuitem"
                      className={menuItemClass}
                      onClick={() => setChoosingShelf(true)}
                    >
                      Move to shelf…
                    </button>
                  )}
                </>
              )}
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      )}
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

function moveMenuFocus(event: ReactKeyboardEvent<HTMLDivElement>): void {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
  const items = Array.from(
    event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')
  )
  const index = items.findIndex((item) => item === event.target)
  const direction = event.key === 'ArrowDown' ? 1 : -1
  event.preventDefault()
  items[(index + direction + items.length) % items.length]?.focus()
}
