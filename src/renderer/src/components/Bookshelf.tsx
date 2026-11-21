import * as Dialog from '@radix-ui/react-dialog'
import { STATUS_LABELS, type Book } from '@shared/api'
import type { BookshelfLayout } from '@shared/bookshelf'
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
  detachShelfBook,
  nextStackId,
  packShelves,
  STACK_HEIGHT,
  shelfInsertion,
  shelfWidths,
  spineWidth,
  stackForBook,
  stackHeight,
  unpackShelves,
  wrapShelf,
  type Shelf,
  type ShelfBookSize,
  type ShelfRow,
  type ShelfStacks
} from '../lib/bookshelfLayout'
import { notify } from '../lib/feedback'
import { useBookshelfLayout, useSaveBookshelfLayout, useSpineColors } from '../lib/queries'
import { useSettings } from '../lib/settings'
import Cover from './Cover'
import EpubBadge from './EpubBadge'
import EditableTitle from './EditableTitle'
import FilterPicker from './FilterPicker'

interface Props {
  books: Book[]
  matching: Book[]
  query: string
  tools: HTMLDivElement | null
  onOpen: (book: Book) => void
  epubIds?: Set<number>
  // Fades the books without an EPUB rather than removing them, so the arrangement stays put.
  epubOnly?: boolean
}

const NO_EPUBS = new Set<number>()

interface Placement {
  row: ShelfRow
  outlineX: number
  width: number
  height: number
}

interface Preview {
  bookId: number
  left: number
  top: number
  width: number
}

interface HiddenPlacement {
  bookId: number
  title: string
  shelfId: number
  left: number
  stackId?: number
  stackIndex?: number
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
const UNDO_DURATION = 8000
const BOOK_MENU_WIDTH = 200
const BOOK_MENU_HEIGHT = 144
const DESTINATION_MENU_HEIGHT = 240
const menuItemClass = 'btn w-full justify-start px-2 py-1.5 text-sm'

export default function Bookshelf(props: Props): ReactNode {
  const { data: layout, isError, refetch } = useBookshelfLayout()
  if (!layout) {
    return isError ? (
      <div className="flex items-center gap-3 py-4 text-sm">
        <p role="alert">Couldn’t load the bookshelf layout.</p>
        <button type="button" className="btn btn-outline" onClick={() => void refetch()}>
          Retry
        </button>
      </div>
    ) : null
  }
  return <BookshelfView {...props} layout={layout} />
}

function BookshelfView({
  books,
  matching,
  query,
  tools,
  onOpen,
  epubIds = NO_EPUBS,
  epubOnly = false,
  layout
}: Props & {
  layout: BookshelfLayout
}): ReactNode {
  const { data: spineColors } = useSpineColors(books)
  const { motionEnabled } = useSettings()
  const { mutate: saveLayout } = useSaveBookshelfLayout()
  const { shelves: savedShelves, faceOutBookIds, hiddenBookIds } = layout
  const [undo, setUndo] = useState<HiddenPlacement | null>(null)
  const [bookMenu, setBookMenu] = useState<BookMenu | null>(null)
  const [choosingShelf, setChoosingShelf] = useState(false)
  const [span, setSpan] = useState(DEFAULT_SHELF_SPAN)
  const [draggedBookId, setDraggedBookId] = useState<number | null>(null)
  const [stackTarget, setStackTarget] = useState<number | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const shelfRef = useRef<HTMLDivElement>(null)
  const bookMenuRef = useRef<HTMLDivElement>(null)
  const searchScrollTimer = useRef<number | undefined>(undefined)
  const previewTimer = useRef<number | undefined>(undefined)
  const grabOffset = useRef(0)
  const dropOutline = useRef<HTMLElement | null>(null)
  const faceOutIds = useMemo(() => new Set(faceOutBookIds), [faceOutBookIds])
  const hiddenIds = useMemo(() => new Set(hiddenBookIds), [hiddenBookIds])
  const hiddenBooks = useMemo(
    () =>
      books.filter(({ id }) => hiddenIds.has(id)).sort((a, b) => a.title.localeCompare(b.title)),
    [books, hiddenIds]
  )
  const allSizes = useMemo(
    () =>
      new Map(
        books.map((book) => {
          const thickness = spineWidth(book.pageCount)
          return [
            book.id,
            {
              uprightWidth: faceOutIds.has(book.id) ? FACE_OUT_WIDTH : thickness,
              spineLength: 166 + (book.id % 5) * 9,
              thickness
            }
          ]
        })
      ),
    [books, faceOutIds]
  )
  const sizes = useMemo(
    () => new Map([...allSizes].filter(([id]) => !hiddenIds.has(id))),
    [allSizes, hiddenIds]
  )
  const { stacks, widths, shelves } = useMemo(() => {
    const { rows, stacks } = unpackShelves(savedShelves, sizes)
    const widths = shelfWidths(sizes, stacks)
    return { stacks, widths, shelves: arrangeShelves(rows, widths) }
  }, [savedShelves, sizes])
  const dragLayout = useMemo(() => {
    if (draggedBookId === null || !sizes.has(draggedBookId)) return null
    const draft = prepareShelfMove(shelves, stacks, draggedBookId, undo?.stackId)
    return { ...draft, widths: shelfWidths(sizes, draft.placementStacks) }
  }, [draggedBookId, shelves, stacks, sizes, undo?.stackId])
  const booksById = useMemo(() => new Map(books.map((book) => [book.id, book])), [books])
  const matchingIds = useMemo(
    () => new Set(matching.map(({ id }) => id).filter((id) => !hiddenIds.has(id))),
    [matching, hiddenIds]
  )
  const previewBook = preview && booksById.get(preview.bookId)
  const previewShowsCover =
    previewBook &&
    (!faceOutIds.has(previewBook.id) || stackForBook(stacks, previewBook.id) !== undefined)
  const menuBook = bookMenu && booksById.get(bookMenu.bookId)
  const menuStack = menuBook ? stackForBook(stacks, menuBook.id) : undefined
  const menuShelf =
    menuBook && shelves.find((shelf) => shelf.slotIds.includes(menuStack ?? menuBook.id))
  const firstMatchId = query
    ? shelves
        .flatMap((shelf) => shelf.slotIds.flatMap((id) => stacks.get(id) ?? id))
        .find((id) => matchingIds.has(id))
    : undefined

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

  useEffect(() => {
    if (firstMatchId === undefined) return
    searchScrollTimer.current = window.setTimeout(() => {
      shelfRef.current?.querySelector(`[data-shelf-book="${firstMatchId}"]`)?.scrollIntoView({
        block: 'nearest',
        inline: 'nearest'
      })
    }, 200)
    return () => window.clearTimeout(searchScrollTimer.current)
  }, [query, firstMatchId])

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

  useEffect(() => {
    if (!undo) return
    const timer = window.setTimeout(() => setUndo(null), UNDO_DURATION)
    return () => window.clearTimeout(timer)
  }, [undo])

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

  function queuePreview(bookId: number, button: HTMLButtonElement, showCover: boolean): void {
    hidePreview()
    if (draggedBookId !== null || bookMenu) return

    previewTimer.current = window.setTimeout(() => {
      if (!button.isConnected) return
      const { left, right, top, height } = button.getBoundingClientRect()
      const nextToRight = right + PREVIEW_GAP
      const width = showCover ? PREVIEW_WIDTH : TEXT_PREVIEW_WIDTH
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
    if (draggedBookId === null || !dragLayout || !sizes.has(draggedBookId)) return null
    const destination = {
      ...row,
      slotIds: row.slotIds.filter((id) => id !== dragLayout.removedSlot)
    }
    const strip = event.currentTarget.querySelector('.bookshelf-spines')
    const track = strip?.parentElement
    if (!strip || !track) return null

    const origin = strip.getBoundingClientRect().left
    const left = Math.round((event.clientX || 0) - origin - grabOffset.current)
    const slot =
      event.target instanceof Element
        ? event.target.closest<HTMLElement>('[data-shelf-slot]')
        : null
    const slotId = Number(slot?.dataset.shelfSlot)
    // Hovering the source is a no-op. A full destination rejects the drop.
    if (slotId === draggedBookId) return undefined
    const bounds = destination.slotIds.includes(slotId) ? slot?.getBoundingClientRect() : undefined
    const neighbor = bounds
      ? { slotId, after: event.clientX >= bounds.left + bounds.width / 2 }
      : undefined
    const insertion = shelfInsertion(
      destination,
      dragLayout.placementId,
      dragLayout.widths,
      span,
      left,
      neighbor
    )
    if (!insertion) return null
    return {
      row: insertion,
      outlineX:
        origin - track.getBoundingClientRect().left + insertion.positions[dragLayout.placementId],
      width: dragLayout.widths.get(dragLayout.placementId)!,
      height: dragLayout.horizontal
        ? sizes.get(draggedBookId)!.thickness
        : bookHeight(draggedBookId)
    }
  }

  function hideDropOutline(row?: HTMLDivElement): void {
    const outline = dropOutline.current
    if (!outline || (row && !row.contains(outline))) return
    outline.removeAttribute('data-active')
    dropOutline.current = null
  }

  function showDropOutline(row: HTMLDivElement, target: Placement): void {
    const outline = row.querySelector<HTMLElement>('.bookshelf-drop-preview')!
    const changedRow = dropOutline.current !== outline
    if (changedRow) {
      hideDropOutline()
      outline.style.width = `${target.width}px`
      outline.style.height = `${target.height}px`
      dropOutline.current = outline
    }
    outline.style.transform = `translateX(${target.outlineX}px)`
    if (changedRow) outline.setAttribute('data-active', '')
  }

  function saveRows(
    rows: Shelf[],
    nextStacks: ShelfStacks = stacks,
    nextSizes: ReadonlyMap<number, ShelfBookSize> = sizes,
    nextHiddenBookIds = hiddenBookIds
  ): void {
    saveLayout({
      ...layout,
      shelves: packShelves(arrangeShelves(rows, shelfWidths(nextSizes, nextStacks)), nextStacks),
      hiddenBookIds: nextHiddenBookIds
    })
  }

  function move(shelfId: number, row: ShelfRow, target: ShelfRow): void {
    if (!dragLayout) return
    const { removedSlot, placementId } = dragLayout

    if (
      row.positions[placementId] === target.positions[placementId] &&
      sameOrder(row.slotIds, target.slotIds)
    )
      return

    saveRows(
      shelves.map((shelf, index) => {
        if (shelf.id !== shelfId) return dragLayout.rows[index]
        const before = shelf.slotIds.slice(0, row.start).filter((id) => id !== removedSlot)
        const after = shelf.slotIds
          .slice(row.start + row.slotIds.length)
          .filter((id) => id !== removedSlot)
        const positions = { ...shelf.positions }
        for (const id of target.slotIds) positions[id] = row.origin + target.positions[id]
        return { ...shelf, slotIds: [...before, ...target.slotIds, ...after], positions }
      }),
      dragLayout.placementStacks
    )
  }

  function moveBookToShelf(book: Book, shelfId: number, shelfName: string): void {
    const draft = prepareShelfMove(shelves, stacks, book.id, undo?.stackId)
    saveRows(
      draft.rows.map((shelf) =>
        shelf.id === shelfId ? { ...shelf, slotIds: [...shelf.slotIds, draft.placementId] } : shelf
      ),
      draft.placementStacks
    )
    setBookMenu(null)
    notify(`Moved ${book.title} to ${shelfName}.`)
  }

  function endDrag(): void {
    hideDropOutline()
    setDraggedBookId(null)
    setStackTarget(null)
  }

  function addShelf(): void {
    const id = Math.max(...shelves.map((shelf) => shelf.id)) + 1
    saveRows([...shelves, { id, slotIds: [], positions: {} }])
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
    return faceOutIds.has(bookId) ? FACE_OUT_WIDTH * 1.5 : sizes.get(bookId)!.spineLength
  }

  function startStack(bookId: number, shelf: Shelf): void {
    const id = nextStackId(stacks, undo?.stackId)
    const rows = shelves.map((row) =>
      row === shelf
        ? {
            ...row,
            slotIds: row.slotIds.map((slot) => (slot === bookId ? id : slot)),
            positions: { ...row.positions, [id]: row.positions[bookId] }
          }
        : row
    )
    saveRows(rows, new Map(stacks).set(id, [bookId]))
  }

  function standBook(bookId: number, shelf: Shelf, stackId: number): void {
    const draft = detachShelfBook(shelves, stacks, bookId)
    const row = draft.rows.find(({ id }) => id === shelf.id)!
    const neighbor = draft.stacks.has(stackId) ? { slotId: stackId, after: true } : undefined
    const placed = shelfInsertion(
      row,
      bookId,
      shelfWidths(sizes, draft.stacks),
      Infinity,
      shelf.positions[stackId],
      neighbor
    )
    saveRows(
      draft.rows.map((next) => (next === row && placed ? placed : next)),
      draft.stacks
    )
  }

  function membersAfterDrop(stackId: number): number[] | null {
    if (draggedBookId === null || !sizes.has(draggedBookId)) return null
    const members = dragLayout?.stacks.get(stackId)
    if (!members) return null
    const next = [...members, draggedBookId]
    return stackHeight(next, sizes) <= STACK_HEIGHT ? next : null
  }

  function openBookMenu(bookId: number, trigger: HTMLButtonElement, x: number, y: number): void {
    hidePreview()
    setChoosingShelf(false)
    setBookMenu({
      bookId,
      trigger,
      left: Math.max(8, Math.min(x, window.innerWidth - BOOK_MENU_WIDTH - 8)),
      top: Math.max(8, Math.min(y, window.innerHeight - BOOK_MENU_HEIGHT - 8))
    })
  }

  function turnBook(bookId: number): void {
    hidePreview()
    saveLayout({
      ...layout,
      faceOutBookIds: faceOutIds.has(bookId)
        ? faceOutBookIds.filter((id) => id !== bookId)
        : [...faceOutBookIds, bookId]
    })
  }

  function hideBook(book: Book, shelf: Shelf): void {
    hidePreview()
    // Save the visible positions before excluding the book, leaving its gap in place.
    saveLayout(
      {
        ...layout,
        shelves: packShelves(shelves, stacks),
        hiddenBookIds: [...hiddenBookIds, book.id]
      },
      {
        onError: () => setUndo(null)
      }
    )
    const stackId = stackForBook(stacks, book.id)
    setUndo({
      bookId: book.id,
      title: book.title,
      shelfId: shelf.id,
      left: shelf.positions[stackId ?? book.id],
      stackId,
      stackIndex: stackId === undefined ? undefined : stacks.get(stackId)?.indexOf(book.id)
    })
  }

  function restoreBook(bookId: number, previous?: HiddenPlacement): void {
    const size = allSizes.get(bookId)
    if (!size || !hiddenIds.has(bookId)) return

    const nextSizes = new Map(sizes).set(bookId, size)
    let nextStacks = stacks
    let rows = shelves
    if (previous) {
      const { stackId } = previous
      const members = stackId === undefined ? undefined : stacks.get(stackId)
      if (
        stackId !== undefined &&
        members &&
        stackHeight(members, nextSizes) + size.thickness <= STACK_HEIGHT
      ) {
        const restored = [...members]
        restored.splice(previous.stackIndex ?? restored.length, 0, bookId)
        nextStacks = new Map(stacks).set(stackId, restored)
      } else {
        const source = shelves.find((shelf) => shelf.id === previous.shelfId)
        if (source) {
          const candidate =
            stackId !== undefined && !members ? new Map(stacks).set(stackId, [bookId]) : stacks
          const slotId = candidate === stacks ? bookId : stackId!
          const restored = shelfInsertion(
            source,
            slotId,
            shelfWidths(nextSizes, candidate),
            Infinity,
            previous.left
          )
          if (restored) {
            nextStacks = candidate
            rows = shelves.map((shelf) => (shelf === source ? restored : shelf))
          }
        }
      }
    }
    saveRows(
      rows,
      nextStacks,
      nextSizes,
      hiddenBookIds.filter((id) => id !== bookId)
    )
    if (undo?.bookId === bookId) setUndo(null)
  }

  function renderBook(book: Book, stacked = false): ReactNode {
    const palette = (book.coverPath && spineColors?.[book.coverPath]) || paletteFor(book.title)
    const size = sizes.get(book.id)!
    const width = stacked ? size.spineLength : size.uprightWidth
    const label =
      (book.author ? `${book.title} by ${book.author}` : book.title) +
      (epubIds.has(book.id) ? ', has an EPUB' : '')
    const faceOut = !stacked && faceOutIds.has(book.id)
    const style = {
      width,
      height: stacked ? size.thickness : bookHeight(book.id),
      ...(!faceOut && {
        color: palette.ink,
        backgroundColor: palette.cover,
        '--spine-detail': palette.detail
      })
    } as CSSProperties

    return (
      <button
        key={book.id}
        type="button"
        className={`bookshelf-book${faceOut ? '' : ' book-spine'}${stacked ? ' book-spine-horizontal' : ''}`}
        style={style}
        draggable
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={bookMenu?.bookId === book.id}
        data-shelf-book={book.id}
        data-dragging={draggedBookId === book.id || undefined}
        data-search-match={(query && matchingIds.has(book.id)) || undefined}
        data-epub={epubIds.has(book.id) || undefined}
        onMouseEnter={(event) => queuePreview(book.id, event.currentTarget, !faceOut)}
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
          const bounds = event.currentTarget.getBoundingClientRect()
          openBookMenu(book.id, event.currentTarget, bounds.left, bounds.bottom)
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
          <div aria-hidden="true" className="pointer-events-none relative">
            <Cover title={book.title} author={book.author} path={book.coverPath} />
            {epubIds.has(book.id) && <EpubBadge />}
          </div>
        ) : (
          <span aria-hidden="true" className="book-spine-copy">
            <span className="book-spine-title">{book.title}</span>
            {book.author && <span className="book-spine-author">{book.author}</span>}
          </span>
        )}
        {!faceOut && epubIds.has(book.id) && <span aria-hidden className="book-spine-epub" />}
      </button>
    )
  }

  function renderSlot(slotId: number, left: number): ReactNode {
    const members = stacks.get(slotId)
    const books = (members ?? [slotId]).flatMap((id) => booksById.get(id) ?? [])
    if (!books.length) return null
    const canStack = members && membersAfterDrop(slotId) !== null
    return (
      <div
        key={slotId}
        role="listitem"
        data-shelf-slot={slotId}
        style={{ '--shelf-x': `${left}px` } as CSSProperties}
        className="bookshelf-slot"
      >
        {members ? (
          <div
            role="group"
            aria-label="Book stack"
            className="bookshelf-stack"
            style={{ width: widths.get(slotId) }}
          >
            {books.map((book) => renderBook(book, true))}
            {draggedBookId !== null && !(members.length === 1 && members[0] === draggedBookId) && (
              <div
                className="bookshelf-stack-target"
                data-active={stackTarget === slotId || undefined}
                data-unavailable={!canStack || undefined}
                onDragOver={(event) => {
                  event.stopPropagation()
                  event.preventDefault()
                  hideDropOutline()
                  event.dataTransfer.dropEffect = canStack ? 'move' : 'none'
                  setStackTarget(canStack ? slotId : null)
                }}
                onDragLeave={() => setStackTarget(null)}
                onDrop={(event) => {
                  event.stopPropagation()
                  event.preventDefault()
                  const next = membersAfterDrop(slotId)
                  if (next && dragLayout) {
                    saveRows(dragLayout.rows, new Map(dragLayout.stacks).set(slotId, next))
                  }
                  endDrag()
                }}
              >
                {canStack ? 'Drop onto stack' : 'Stack is full'}
              </div>
            )}
          </div>
        ) : (
          renderBook(books[0])
        )}
      </div>
    )
  }

  return (
    <section
      aria-label="Bookshelf"
      className="bookshelf-section"
      data-searching={(query && matchingIds.size > 0) || undefined}
      data-epub-only={epubOnly || undefined}
    >
      {tools &&
        createPortal(
          <>
            {shelves.length > 1 && (
              <FilterPicker
                label="Jump to shelf"
                options={shelves.map((shelf, index) => ({
                  value: String(shelf.id),
                  label: shelf.name ?? `Shelf ${index + 1}`
                }))}
                onChange={jumpToShelf}
                align="end"
              />
            )}
            <p
              role="status"
              className={query && matchingIds.size === 0 ? 'text-xs text-ink-muted' : 'sr-only'}
            >
              {query &&
                (matchingIds.size === 0
                  ? 'No matches'
                  : `${matchingIds.size} ${matchingIds.size === 1 ? 'match' : 'matches'}`)}
            </p>
          </>,
          tools
        )}
      <p className="mb-3 text-[13px] text-ink-muted">
        Drag books to arrange them. Right-click a book for options.
      </p>
      <div className="bookshelf" ref={shelfRef}>
        {shelves.map((shelf, index) => {
          const empty = shelf.slotIds.length === 0
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
                    if (draggedBookId === null) return
                    event.preventDefault()
                    setStackTarget(null)
                    const target = placementAt(event, row)
                    event.dataTransfer.dropEffect = target === null ? 'none' : 'move'
                    if (target) showDropOutline(event.currentTarget, target)
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
                    const target = placementAt(event, row)
                    if (target) move(shelf.id, row, target.row)
                    endDrag()
                  }}
                >
                  <div
                    role="list"
                    aria-label={rowIndex === 0 ? name : `${name}, row ${rowIndex + 1}`}
                    className="bookshelf-track"
                  >
                    <div className="bookshelf-spines">
                      {row.slotIds.map((slotId) => renderSlot(slotId, row.positions[slotId]))}
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
      {bookMenu && menuBook && menuShelf && (
        <Dialog.Root open modal={false} onOpenChange={() => setBookMenu(null)}>
          <Dialog.Portal>
            <Dialog.Content
              ref={bookMenuRef}
              role="menu"
              aria-describedby={undefined}
              className="fixed z-50 overflow-y-auto overscroll-contain rounded-card border border-hairline bg-surface p-1 shadow-pop"
              style={{
                left: bookMenu.left,
                top: choosingShelf
                  ? Math.max(
                      8,
                      Math.min(bookMenu.top, window.innerHeight - DESTINATION_MENU_HEIGHT - 8)
                    )
                  : bookMenu.top,
                width: BOOK_MENU_WIDTH,
                maxHeight: DESTINATION_MENU_HEIGHT
              }}
              onKeyDown={moveMenuFocus}
              onEscapeKeyDown={(event) => event.stopPropagation()}
              onCloseAutoFocus={(event) => {
                event.preventDefault()
                if (document.activeElement === document.body) {
                  const trigger = bookMenu.trigger.isConnected
                    ? bookMenu.trigger
                    : document.querySelector<HTMLButtonElement>(
                        `[data-shelf-book="${bookMenu.bookId}"]`
                      )
                  trigger?.focus({ preventScroll: true })
                }
              }}
            >
              <Dialog.Title
                className={choosingShelf ? 'px-2 py-1 text-xs text-ink-muted' : 'sr-only'}
              >
                {choosingShelf ? 'Move to shelf' : `Options for ${menuBook.title}`}
              </Dialog.Title>
              {choosingShelf ? (
                shelves.map((shelf, index) => {
                  if (shelf.id === menuShelf.id) return null
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
                  {menuStack === undefined && (
                    <Dialog.Close
                      role="menuitem"
                      className={menuItemClass}
                      onClick={() => turnBook(menuBook.id)}
                    >
                      {faceOutIds.has(menuBook.id) ? 'Show spine' : 'Show cover'}
                    </Dialog.Close>
                  )}
                  <Dialog.Close
                    role="menuitem"
                    className={menuItemClass}
                    onClick={() => {
                      if (menuStack === undefined) startStack(menuBook.id, menuShelf)
                      else standBook(menuBook.id, menuShelf, menuStack)
                    }}
                  >
                    {menuStack === undefined ? 'Start a stack' : 'Stand upright'}
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
                  <Dialog.Close
                    role="menuitem"
                    className={menuItemClass}
                    onClick={() => hideBook(menuBook, menuShelf)}
                  >
                    Hide from shelf
                  </Dialog.Close>
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
        {hiddenBooks.length > 0 && (
          <FilterPicker
            label="Add to shelf"
            searchLabel="Search hidden books"
            options={hiddenBooks.map(({ id, title, author }) => ({
              value: String(id),
              label: title,
              detail: author
            }))}
            onChange={(id) => restoreBook(Number(id))}
          />
        )}
      </div>
      {undo &&
        createPortal(
          <div className="fixed right-6 bottom-6 z-40 flex max-w-[min(380px,calc(100vw-48px))] items-center gap-3 rounded-card border border-hairline bg-surface px-3 py-2 text-[13px] text-ink-muted shadow-pop">
            <span role="status" className="min-w-0 truncate">
              {undo.title} hidden from shelf.
            </span>
            <button
              type="button"
              className="btn btn-ghost shrink-0 text-accent"
              onClick={() => restoreBook(undo.bookId, undo)}
            >
              Undo
            </button>
          </div>,
          document.body
        )}
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
            {previewShowsCover && (
              <div className="w-16 shrink-0">
                <Cover
                  title={previewBook.title}
                  author={previewBook.author}
                  path={previewBook.coverPath}
                />
              </div>
            )}
            <div className="min-w-0 wrap-anywhere">
              <p className="line-clamp-3 text-sm leading-tight font-semibold">
                {previewBook.title}
              </p>
              {previewBook.author && (
                <p className="mt-1 line-clamp-2 text-xs leading-snug text-ink-muted">
                  {previewBook.author}
                </p>
              )}
              <p className="mt-2 text-xs font-medium text-ink-muted">
                {STATUS_LABELS[previewBook.status]}
              </p>
            </div>
          </div>,
          document.body
        )}
    </section>
  )
}

function prepareShelfMove(
  shelves: Shelf[],
  stacks: ShelfStacks,
  bookId: number,
  reservedStackId?: number
): {
  rows: Shelf[]
  stacks: ShelfStacks
  horizontal: boolean
  removedSlot: number | undefined
  placementId: number
  placementStacks: ShelfStacks
} {
  const detached = detachShelfBook(shelves, stacks, bookId)
  const sourceStackId = stackForBook(stacks, bookId)
  const removedSlot =
    sourceStackId !== undefined && detached.stacks.has(sourceStackId)
      ? undefined
      : (sourceStackId ?? bookId)
  const placementId = removedSlot ?? nextStackId(stacks, reservedStackId)
  const horizontal = sourceStackId !== undefined
  return {
    ...detached,
    horizontal,
    removedSlot,
    placementId,
    placementStacks: horizontal
      ? new Map(detached.stacks).set(placementId, [bookId])
      : detached.stacks
  }
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
