import { type DragEvent, type ReactNode, useLayoutEffect, useRef, useState } from 'react'

import { useBooks, useReorderPriority } from '../lib/queries'
import { useView } from '../lib/view'
import Cover from './Cover'

function sameOrder(left: number[], right: number[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index])
}

function insertAround(
  ids: number[],
  draggedBookId: number,
  targetBookId: number,
  afterTarget: boolean
): number[] {
  if (draggedBookId === targetBookId) return ids

  const next = ids.filter((id) => id !== draggedBookId)
  const targetIndex = next.indexOf(targetBookId)
  if (targetIndex < 0) return ids

  next.splice(targetIndex + (afterTarget ? 1 : 0), 0, draggedBookId)
  return next
}

export default function ReadingQueue(): ReactNode {
  const { navigate } = useView()
  const { data: books = [], isPending } = useBooks()
  const reorderPriority = useReorderPriority()
  const [draggedBookId, setDraggedBookId] = useState<number | null>(null)
  const [previewIds, setPreviewIds] = useState<number[] | null>(null)
  const [dropIndex, setDropIndex] = useState<number | null>(null)
  const didDrop = useRef(false)
  const rowRefs = useRef(new Map<number, HTMLElement>())
  const previousRects = useRef(new Map<number, DOMRect>())

  const queue = books
    .filter((book) => book.status === 'want')
    .sort(
      (left, right) =>
        (left.priorityPosition ?? Infinity) - (right.priorityPosition ?? Infinity) ||
        left.createdAt - right.createdAt ||
        left.id - right.id
    )
  const queueIds = queue.map((book) => book.id)
  const booksById = new Map(queue.map((book) => [book.id, book]))
  const previewIsCurrent =
    previewIds !== null &&
    previewIds.length === queueIds.length &&
    previewIds.every((id) => booksById.has(id))
  const visibleIds = previewIsCurrent ? previewIds : queueIds
  const visibleQueue = visibleIds
    .map((id) => booksById.get(id))
    .filter((book): book is (typeof queue)[number] => book !== undefined)

  function draggedIdFrom(event: DragEvent<HTMLElement>): number | null {
    const id = Number(event.dataTransfer.getData('text/plain'))
    return Number.isInteger(id) && id > 0 ? id : null
  }

  function rememberRowPositions(): void {
    previousRects.current = new Map(
      [...rowRefs.current].map(([id, row]) => [id, row.getBoundingClientRect()])
    )
  }

  function previewDrop(
    event: DragEvent<HTMLElement>,
    targetBookId: number,
    currentIds: number[]
  ): void {
    const id = draggedBookId ?? draggedIdFrom(event)
    if (id === null) return

    const rect = event.currentTarget.getBoundingClientRect()
    const afterTarget = event.clientY >= rect.top + rect.height / 2
    const next = insertAround(currentIds, id, targetBookId, afterTarget)
    const nextIndex = next.indexOf(id)

    setDropIndex(nextIndex)
    if (sameOrder(next, currentIds)) return

    rememberRowPositions()
    setPreviewIds(next)
  }

  function commitDrop(next: number[]): void {
    if (sameOrder(next, queueIds)) {
      setPreviewIds(null)
      return
    }

    setPreviewIds(next)
    reorderPriority.mutate(next, {
      onError: () => {
        rememberRowPositions()
        setPreviewIds(null)
        setDropIndex(null)
      }
    })
  }

  function move(bookId: number, offset: number): void {
    const next = [...queueIds]
    const from = next.indexOf(bookId)
    const target = from + offset
    if (from < 0 || target < 0 || target >= next.length) return
    ;[next[from], next[target]] = [next[target], next[from]]
    reorderPriority.mutate(next)
  }

  // React moves the rows immediately when previewIds changes. FLIP gives those
  // layout changes a short, GPU-friendly slide without adding a motion library.
  useLayoutEffect(() => {
    const firstRects = previousRects.current
    if (firstRects.size === 0) return

    previousRects.current = new Map()
    const rows: HTMLElement[] = []

    for (const [id, row] of rowRefs.current) {
      const first = firstRects.get(id)
      if (!first) continue

      const offsetY = first.top - row.getBoundingClientRect().top
      if (Math.abs(offsetY) < 1) continue

      row.style.transition = 'none'
      row.style.transform = `translateY(${offsetY}px)`
      rows.push(row)
    }

    if (rows.length === 0 || typeof requestAnimationFrame !== 'function') {
      for (const row of rows) {
        row.style.transition = ''
        row.style.transform = ''
      }
      return
    }

    const frame = requestAnimationFrame(() => {
      for (const row of rows) {
        row.style.transition = 'transform 180ms cubic-bezier(0.2, 0.8, 0.2, 1)'
        row.style.transform = ''
      }
    })

    return () => {
      cancelAnimationFrame(frame)
      for (const row of rows) {
        row.style.transition = ''
        row.style.transform = ''
      }
    }
  }, [previewIds])

  if (isPending) return <div className="h-full" />

  return (
    <div className="h-full overflow-y-auto px-8 pt-7 pb-16">
      <header className="mb-6">
        <h1 className="text-[22px]">Reading queue</h1>
        <p className="mt-1 text-[13px] text-ink-muted">
          Every Want to read book is here. Drag them into the order you want.
        </p>
      </header>

      <section className="card px-5 py-4" aria-labelledby="queue-heading">
        <div className="mb-3 flex items-baseline justify-between gap-4">
          <h2 id="queue-heading" className="text-[15px] font-semibold text-ink">
            Want to read · {queue.length}
          </h2>
          {queue.length > 1 && <span className="text-[11px] text-ink-faint">Drag to reorder</span>}
        </div>

        {queue.length === 0 ? (
          <p className="py-8 text-center text-[13px] text-ink-muted">
            Your Want to read list is empty.
          </p>
        ) : (
          <div className="space-y-2" aria-label="Want-to-read order">
            {visibleQueue.map((book, index) => {
              const isDragged = draggedBookId === book.id
              const showDropMarker = dropIndex === index

              return (
                <div key={book.id} className="space-y-2">
                  {showDropMarker && <div className="queue-drop-marker" aria-hidden />}
                  <article
                    ref={(row) => {
                      if (row) rowRefs.current.set(book.id, row)
                      else rowRefs.current.delete(book.id)
                    }}
                    draggable
                    data-dragging={isDragged || undefined}
                    onDragStart={(event) => {
                      didDrop.current = false
                      setDraggedBookId(book.id)
                      event.dataTransfer.effectAllowed = 'move'
                      event.dataTransfer.setData('text/plain', String(book.id))
                    }}
                    onDragOver={(event) => {
                      event.preventDefault()
                      event.dataTransfer.dropEffect = 'move'
                      previewDrop(event, book.id, visibleIds)
                    }}
                    onDrop={(event) => {
                      event.preventDefault()
                      const id = draggedBookId ?? draggedIdFrom(event)
                      if (id === null) return

                      const rect = event.currentTarget.getBoundingClientRect()
                      const afterTarget = event.clientY >= rect.top + rect.height / 2
                      const next = insertAround(visibleIds, id, book.id, afterTarget)
                      didDrop.current = true
                      setDropIndex(null)
                      commitDrop(next)
                    }}
                    onDragEnd={() => {
                      setDraggedBookId(null)
                      setDropIndex(null)
                      if (!didDrop.current) {
                        rememberRowPositions()
                        setPreviewIds(null)
                      }
                    }}
                    className="queue-row flex items-center gap-3 rounded-control border border-hairline bg-canvas px-3 py-2"
                  >
                    <span className="w-5 shrink-0 text-center text-[12px] tabular-nums text-ink-faint">
                      {index + 1}
                    </span>
                    <span
                      aria-hidden
                      className="queue-drag-handle cursor-grab select-none text-ink-faint"
                    >
                      ⠿
                    </span>
                    <div className="w-9 shrink-0">
                      <Cover
                        title={book.title}
                        author={book.author}
                        path={book.coverPath}
                        size="sm"
                      />
                    </div>
                    <button
                      type="button"
                      draggable={false}
                      onClick={() => navigate({ kind: 'book', id: book.id })}
                      className="min-w-0 flex-1 text-left"
                    >
                      <span className="block truncate text-[13px] font-medium text-ink">
                        {book.title}
                      </span>
                      {book.author && (
                        <span className="block truncate text-[12px] text-ink-muted">
                          {book.author}
                        </span>
                      )}
                    </button>
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        aria-label={`Move ${book.title} earlier`}
                        disabled={index === 0 || reorderPriority.isPending}
                        onClick={() => move(book.id, -1)}
                        className="btn btn-ghost px-2 disabled:opacity-25"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        aria-label={`Move ${book.title} later`}
                        disabled={index === visibleQueue.length - 1 || reorderPriority.isPending}
                        onClick={() => move(book.id, 1)}
                        className="btn btn-ghost px-2 disabled:opacity-25"
                      >
                        ↓
                      </button>
                    </div>
                  </article>
                </div>
              )
            })}
            {dropIndex === visibleQueue.length && <div className="queue-drop-marker" aria-hidden />}
          </div>
        )}
      </section>
    </div>
  )
}
