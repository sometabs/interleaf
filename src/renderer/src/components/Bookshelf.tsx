import * as Dialog from '@radix-ui/react-dialog'
import type { Book } from '@shared/api'
import { toPlainText } from '@shared/plaintext'
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
  SHELF_DECORATIONS,
  shelfInsertion,
  spineWidth,
  wrapShelf,
  type Shelf,
  type ShelfDecoration,
  type ShelfRow
} from '../lib/bookshelfLayout'
import { notify } from '../lib/feedback'
import { usePersistentState } from '../lib/persistent'
import { useNotes, useSpineColors } from '../lib/queries'
import { isQuote } from '../lib/quotes'
import Cover from './Cover'
import EditableTitle from './EditableTitle'

interface Props {
  books: Book[]
  matching: Book[]
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
  const [draggedItemId, setDraggedItemId] = useState<number | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [bookMenu, setBookMenu] = useState<BookMenu | null>(null)
  const [choosingShelf, setChoosingShelf] = useState(false)
  const [quotePickerOpen, setQuotePickerOpen] = useState(false)
  const [quoteQuery, setQuoteQuery] = useState('')
  const [span, setSpan] = useState(DEFAULT_SHELF_SPAN)
  const shelfRef = useRef<HTMLDivElement>(null)
  const bookMenuRef = useRef<HTMLDivElement>(null)
  const previewTimer = useRef<number | undefined>(undefined)
  const grabOffset = useRef(0)
  const dropOutline = useRef<HTMLElement | null>(null)
  const faceOutIds = useMemo(() => new Set(faceOutBooks), [faceOutBooks])
  const decorations = useMemo(
    () =>
      new Map(
        savedShelves.flatMap((shelf) => (shelf.decorations ?? []).map((item) => [item.id, item]))
      ),
    [savedShelves]
  )
  const hasQuoteFrame = [...decorations.values()].some(({ kind }) => kind === 'quote-frame')
  const quoteNotes = useNotes(undefined, quotePickerOpen || hasQuoteFrame)
  const quotes = useMemo(() => {
    const booksById = new Map(books.map((book) => [book.id, book]))
    return new Map(
      (quoteNotes.data ?? []).filter(isQuote).map((note) => [
        note.id,
        {
          text: toPlainText(note.bodyMd),
          book: note.bookId === null ? undefined : booksById.get(note.bookId)
        }
      ])
    )
  }, [books, quoteNotes.data])
  const trimmedQuoteQuery = quoteQuery.trim().toLowerCase()
  const matchingQuotes = quotePickerOpen
    ? [...quotes].filter(
        ([, { text, book }]) =>
          text.length > 0 &&
          [text, book?.title, book?.author].some((value) =>
            value?.toLowerCase().includes(trimmedQuoteQuery)
          )
      )
    : []
  const widths = useMemo(() => {
    const sizes = new Map(
      books.map((book) => [
        book.id,
        faceOutIds.has(book.id) ? FACE_OUT_WIDTH : spineWidth(book.pageCount)
      ])
    )
    for (const { id, kind } of decorations.values()) sizes.set(id, SHELF_DECORATIONS[kind].width)
    return sizes
  }, [books, faceOutIds, decorations])
  const shelves = useMemo(
    () => arrangeShelves(savedShelves.map(restoreShelf), widths),
    [savedShelves, widths]
  )
  const matchingById = useMemo(() => new Map(matching.map((book) => [book.id, book])), [matching])
  const previewBook = preview && matchingById.get(preview.bookId)
  const menuBook = bookMenu && matchingById.get(bookMenu.bookId)

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
      const decoration = decorations.get(itemId)
      outline.style.height = `${decoration ? SHELF_DECORATIONS[decoration.kind].height : bookHeight(itemId)}px`
      dropOutline.current = outline
    }
    outline.style.transform = `translateX(${target.outlineX}px)`
    if (changedRow) outline.setAttribute('data-active', '')
  }

  function saveRows(rows: Shelf[]): void {
    setSavedShelves(saveShelves(rows, decorations))
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

  function addQuoteFrame(quoteId: number): void {
    const nextDecorations = new Map(decorations)
    const nextWidths = new Map(widths)
    const id = Math.min(0, ...decorations.keys()) - 1
    nextDecorations.set(id, { id, kind: 'quote-frame', quoteId })
    nextWidths.set(id, SHELF_DECORATIONS['quote-frame'].width)
    setSavedShelves(saveShelves(arrangeShelves(shelves, nextWidths), nextDecorations))
  }

  function removeDecoration(id: number): void {
    const nextWidths = new Map(widths)
    nextWidths.delete(id)
    saveRows(arrangeShelves(shelves, nextWidths))
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

  function renderDecoration(decoration: ShelfDecoration, left: number): ReactNode {
    const { id, kind } = decoration
    const { label, width, height } = SHELF_DECORATIONS[kind]
    const quote = decoration.kind === 'quote-frame' ? quotes.get(decoration.quoteId) : undefined
    const passage = quote?.text || (quoteNotes.isPending ? 'Loading quote…' : 'Quote unavailable')
    const caption = quote?.book?.author ?? quote?.book?.title
    return (
      <div
        key={id}
        role="listitem"
        data-shelf-item={id}
        style={{ '--shelf-x': `${left}px` } as CSSProperties}
        className="bookshelf-slot"
      >
        <div className="group relative">
          <div
            role="img"
            aria-label={kind === 'quote-frame' ? `${label}: ${passage}` : label}
            title={
              kind === 'quote-frame' ? [passage, caption].filter(Boolean).join('\n') : undefined
            }
            className={`bookshelf-decoration bookshelf-decoration-${kind}`}
            style={{ width, height }}
            draggable
            data-dragging={draggedItemId === id || undefined}
            onDragStart={(event) => startDrag(event, id)}
            onDragEnd={endDrag}
          >
            {kind === 'plant' && (
              <span aria-hidden="true" className="bookshelf-plant-leaves">
                <span />
                <span />
                <span />
              </span>
            )}
            {kind === 'quote-frame' && (
              <div className="bookshelf-frame-print" aria-hidden="true">
                <span className="line-clamp-3 wrap-anywhere">{passage}</span>
                {caption && <span className="bookshelf-frame-credit">{caption}</span>}
              </div>
            )}
          </div>
          <button
            type="button"
            aria-label={`Remove ${label.toLowerCase()}`}
            title={`Remove ${label.toLowerCase()}`}
            className="bookshelf-decoration-remove absolute -top-2 right-0 z-10 grid size-5 place-items-center rounded-full border border-hairline bg-surface text-sm text-ink-muted shadow-card hover:text-ink"
            onClick={() => removeDecoration(id)}
          >
            ×
          </button>
        </div>
      </div>
    )
  }

  return (
    <section aria-label="Bookshelf" className="bookshelf-section">
      <p className="mb-3 text-[13px] text-ink-muted">
        Drag items to arrange them. Right-click a book for options.
      </p>
      <div className="bookshelf" ref={shelfRef}>
        {shelves.map((shelf, index) => {
          const empty = shelf.itemIds.length === 0
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
                        const decoration = decorations.get(id)
                        if (decoration) return renderDecoration(decoration, row.positions[id])
                        const book = matchingById.get(id)
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
                        Drag items here
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
      <div className="mt-3 flex items-center gap-2">
        <button type="button" className="btn btn-outline" onClick={addShelf}>
          Add shelf
        </button>
        <Dialog.Root
          open={quotePickerOpen}
          onOpenChange={(open) => {
            setQuotePickerOpen(open)
            if (open) hidePreview()
            else setQuoteQuery('')
          }}
        >
          <Dialog.Trigger className="btn btn-outline">Add quote frame</Dialog.Trigger>
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 z-40 bg-overlay backdrop-blur-[2px]" />
            <Dialog.Content
              aria-describedby={undefined}
              onEscapeKeyDown={(event) => event.stopPropagation()}
              className="fixed top-1/2 left-1/2 z-50 flex max-h-[min(540px,calc(100vh-32px))] w-[min(480px,calc(100vw-32px))] -translate-1/2 flex-col rounded-card border border-hairline bg-surface p-4 shadow-pop"
            >
              <Dialog.Title className="mb-3 text-[16px] font-semibold">Choose a quote</Dialog.Title>
              <input
                className="field"
                aria-label="Filter quotes"
                placeholder="Filter by quote, book, or author…"
                value={quoteQuery}
                onChange={(event) => setQuoteQuery(event.target.value)}
              />
              <div className="my-2 min-h-0 overflow-y-auto">
                {quoteNotes.isPending ? (
                  <p className="px-2 py-3 text-sm text-ink-muted">Loading quotes…</p>
                ) : quoteNotes.isError ? (
                  <p role="alert" className="px-2 py-3 text-sm text-danger">
                    Couldn’t load quotes.
                  </p>
                ) : matchingQuotes.length === 0 ? (
                  <p className="px-2 py-3 text-sm text-ink-muted">
                    {trimmedQuoteQuery ? 'No matching quotes.' : 'Save a quote to frame it here.'}
                  </p>
                ) : (
                  matchingQuotes.map(([quoteId, { text, book }]) => (
                    <Dialog.Close
                      key={quoteId}
                      className="block w-full rounded-control px-2 py-2 text-left hover:bg-hover"
                      onClick={() => addQuoteFrame(quoteId)}
                    >
                      <span className="line-clamp-2 wrap-anywhere text-sm">{text}</span>
                      {book && (
                        <span className="block truncate text-xs text-ink-muted">{book.title}</span>
                      )}
                    </Dialog.Close>
                  ))
                )}
              </div>
              <Dialog.Close className="btn btn-outline self-end">Cancel</Dialog.Close>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      </div>
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
