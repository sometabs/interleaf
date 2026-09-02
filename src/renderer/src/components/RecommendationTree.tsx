import type { RecommendationNode } from '@shared/api'
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode
} from 'react'

import Cover from './Cover'
import Empty from './Empty'
import Spinner from './Spinner'

interface Props {
  roots: RecommendationNode[]
  onSave: (olid: string) => void
  onDismiss: (olid: string) => void
  // The book currently being added, so its node alone shows the work.
  savingOlid: string | null
}

interface Handlers {
  onSave: (olid: string) => void
  onDismiss: (olid: string) => void
  savingOlid: string | null
}

// Laid out with flexbox and 1px rules, so the browser centres each subtree and
// the connectors follow. No canvas, no measuring.
export default function RecommendationTree({
  roots,
  onSave,
  onDismiss,
  savingOlid
}: Props): ReactNode {
  const scrollerRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<Drag | null>(null)
  const swallowClickRef = useRef(false)
  const [dragging, setDragging] = useState(false)

  const stageRef = useRef<HTMLDivElement>(null)
  const [zoom, setZoom] = useState(1)
  // The wheel listener is installed once, so the live value lives in a ref and
  // the state is only for rendering.
  const zoomRef = useRef(1)
  const anchorRef = useRef<Anchor | null>(null)

  // Before scaling: a transform does not change `offsetWidth`.
  const [natural, setNatural] = useState({ width: 0, height: 0 })
  useLayoutEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const measure = (): void => setNatural({ width: stage.offsetWidth, height: stage.offsetHeight })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(stage)
    return () => observer.disconnect()
  }, [])

  // Keeps whatever sits under the cursor exactly where it is.
  function zoomTo(next: number, clientX?: number, clientY?: number): void {
    const current = zoomRef.current
    const clamped = clampZoom(next)
    if (clamped === current) return

    const scroller = scrollerRef.current
    const stage = stageRef.current
    if (scroller && stage) {
      const view = scroller.getBoundingClientRect()
      const rect = stage.getBoundingClientRect()
      const x = clientX ?? view.left + view.width / 2
      const y = clientY ?? view.top + view.height / 2
      anchorRef.current = {
        contentX: (x - rect.left) / current,
        contentY: (y - rect.top) / current,
        clientX: x,
        clientY: y
      }
    }

    zoomRef.current = clamped
    setZoom(clamped)
  }

  // After re-layout but before paint, or the tree visibly jumps. Measured
  // rather than predicted, so errors cannot accumulate across a wheel burst.
  useLayoutEffect(() => {
    const scroller = scrollerRef.current
    const stage = stageRef.current
    const anchor = anchorRef.current
    if (!scroller || !stage || !anchor) return
    anchorRef.current = null

    const rect = stage.getBoundingClientRect()
    scroller.scrollLeft += rect.left + anchor.contentX * zoom - anchor.clientX
    scroller.scrollTop += rect.top + anchor.contentY * zoom - anchor.clientY
  }, [zoom])

  useEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller) return

    function onWheel(event: WheelEvent): void {
      // A bare wheel scrolls; a trackpad pinch arrives as ctrl+wheel.
      if (!event.ctrlKey && !event.metaKey) return

      // An unhandled ctrl+wheel is Chromium's page zoom. React registers
      // `onWheel` passively, hence the native listener.
      event.preventDefault()

      // A sideways wheel is not a zoom gesture.
      if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) return

      zoomTo(
        clampZoom(zoomRef.current - wheelPixels(event) * WHEEL_SENSITIVITY),
        event.clientX,
        event.clientY
      )
    }

    scroller.addEventListener('wheel', onWheel, { passive: false })
    return () => scroller.removeEventListener('wheel', onWheel)
    // `zoomTo` reads the live zoom from a ref, so this binds once.
  }, [])

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>): void {
    const scroller = scrollerRef.current
    swallowClickRef.current = false
    if (!scroller || event.button !== 0) return
    if ((event.target as HTMLElement).closest('button, a, input, textarea')) return

    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startLeft: scroller.scrollLeft,
      startTop: scroller.scrollTop,
      moved: false
    }
    event.preventDefault()
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>): void {
    const drag = dragRef.current
    const scroller = scrollerRef.current
    if (!drag || !scroller || event.pointerId !== drag.pointerId) return

    const dx = event.clientX - drag.startX
    const dy = event.clientY - drag.startY

    if (!drag.moved) {
      if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return
      drag.moved = true
      setDragging(true)
      // Captured only once it is genuinely a drag, so a drag ending over a
      // button does not press it.
      scroller.setPointerCapture?.(drag.pointerId)
    }

    scroller.scrollLeft = drag.startLeft - dx
    scroller.scrollTop = drag.startTop - dy
  }

  function onPointerUp(): void {
    const drag = dragRef.current
    const scroller = scrollerRef.current
    if (!drag) return

    if (drag.moved) {
      swallowClickRef.current = true
      if (scroller?.hasPointerCapture?.(drag.pointerId)) {
        scroller.releasePointerCapture(drag.pointerId)
      }
    }
    dragRef.current = null
    setDragging(false)
  }

  function onClickCapture(event: ReactMouseEvent<HTMLDivElement>): void {
    if (!swallowClickRef.current) return
    swallowClickRef.current = false
    event.stopPropagation()
    event.preventDefault()
  }

  if (roots.length === 0) {
    return <Empty title="Nothing to arrange yet">Recommendations appear here as a tree.</Empty>
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-end gap-3">
        {/* The gesture moved off the bare wheel, so it has to be said once. */}
        <p className="text-[12px] text-ink-faint">Drag to move · Ctrl + scroll to zoom</p>

        <div
          role="group"
          aria-label="Zoom"
          className="inline-flex items-center rounded-control bg-sunken p-0.5"
        >
          <ZoomButton
            label="Zoom out"
            disabled={zoom <= MIN_ZOOM}
            onClick={() => zoomTo(zoom - ZOOM_STEP)}
          >
            <path d="M3.5 8h9" />
          </ZoomButton>

          <button
            type="button"
            aria-label="Reset zoom"
            title="Reset zoom"
            onClick={() => zoomTo(1)}
            className="min-w-12 px-1 text-[12px] tabular-nums text-ink-muted hover:text-ink"
          >
            {Math.round(zoom * 100)}%
          </button>

          <ZoomButton
            label="Zoom in"
            disabled={zoom >= MAX_ZOOM}
            onClick={() => zoomTo(zoom + ZOOM_STEP)}
          >
            <path d="M8 3.5v9M3.5 8h9" />
          </ZoomButton>
        </div>
      </div>

      {/* Capped, so a deep tree never pushes the page around. */}
      <div
        ref={scrollerRef}
        data-testid="tree-canvas"
        data-dragging={dragging || undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClickCapture={onClickCapture}
        className={`flex max-h-[72vh] items-start overflow-auto overscroll-contain ${
          dragging ? 'cursor-grabbing select-none' : 'cursor-grab'
        }`}
      >
        {/* A transform does not affect layout, so this sizer holds the scaled
            footprint open and keeps the scrollbars honest. */}
        <div
          data-testid="tree-sizer"
          className="mx-auto transition-none"
          style={{
            width: natural.width ? natural.width * zoom : 'max-content',
            height: natural.height ? natural.height * zoom : undefined
          }}
        >
          {/* `transition-none` because `prefers-reduced-motion` forces a 0.01ms
              transition on everything, and the re-anchor reads back mid-flight. */}
          <div
            ref={stageRef}
            data-testid="tree-stage"
            style={{
              transform: `scale(${zoom})`,
              transformOrigin: '0 0',
              // Padding, not margin: `offsetHeight` includes it, so the sizer
              // holds the space open and the hover shadow is not clipped.
              paddingBottom: BOTTOM_SPACE
            }}
            className="flex w-max flex-col items-center gap-14 transition-none"
          >
            {roots.map((root, index) => (
              <section key={root.olid} className="flex flex-col items-center">
                {/* A root is ranked against the whole taste profile, so it is
                    descended from no one book. */}
                <header className="mb-4 text-center">
                  <p className="eyebrow">
                    {index === 0 ? 'Closest to your taste' : 'A separate thread'}
                  </p>
                </header>

                <Subtree
                  node={root}
                  depth={0}
                  onSave={onSave}
                  onDismiss={onDismiss}
                  savingOlid={savingOlid}
                />
              </section>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function ZoomButton({
  label,
  disabled,
  onClick,
  children
}: {
  label: string
  disabled: boolean
  onClick: () => void
  children: ReactNode
}): ReactNode {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="flex size-6 items-center justify-center rounded-control text-ink-muted transition-colors hover:bg-surface hover:text-ink hover:shadow-card"
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 16 16"
        className="size-3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      >
        {children}
      </svg>
    </button>
  )
}

const LEVEL_GAP = 32

const BOTTOM_SPACE = 56

const MIN_ZOOM = 0.5
const MAX_ZOOM = 1.6
const ZOOM_STEP = 0.1

// One mouse notch is ~100px of delta, so this makes a notch one step.
const WHEEL_SENSITIVITY = 0.001

function clampZoom(value: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(value * 100) / 100))
}

// Wheel deltas arrive in pixels, lines or pages depending on the device.
function wheelPixels(event: WheelEvent): number {
  if (event.deltaMode === 1) return event.deltaY * 16
  if (event.deltaMode === 2) return event.deltaY * (event.currentTarget as HTMLElement).clientHeight
  return event.deltaY
}

// Under this many pixels a press is still a click, not a drag.
const DRAG_THRESHOLD = 4

interface Drag {
  pointerId: number
  startX: number
  startY: number
  startLeft: number
  startTop: number
  moved: boolean
}

interface Anchor {
  contentX: number
  contentY: number
  clientX: number
  clientY: number
}

function Subtree({
  node,
  depth,
  onSave,
  onDismiss,
  savingOlid
}: { node: RecommendationNode; depth: number } & Handlers): ReactNode {
  const children = node.children
  const lastIndex = children.length - 1

  return (
    <div className="flex flex-col items-center">
      <NodeCard
        node={node}
        depth={depth}
        onSave={onSave}
        onDismiss={onDismiss}
        savingOlid={savingOlid}
      />

      {children.length > 0 && (
        <>
          {/* The stem out of the bottom of this node, meeting the sibling rail. */}
          <span
            aria-hidden="true"
            className="w-px shrink-0 bg-hairline-strong"
            style={{ height: LEVEL_GAP / 2 }}
          />

          <div className="flex items-start">
            {children.map((child, index) => (
              <div
                key={child.olid}
                className="relative flex flex-col items-center px-3"
                style={{ paddingTop: LEVEL_GAP / 2 }}
              >
                {/* The rail spanning the siblings. A lone child needs none: the
                    drop below already lines up under its parent. */}
                {children.length > 1 && (
                  <span
                    aria-hidden="true"
                    className="absolute top-0 h-px bg-hairline-strong"
                    style={{
                      left: index === 0 ? '50%' : 0,
                      right: index === lastIndex ? '50%' : 0
                    }}
                  />
                )}

                {/* The drop from the rail into this child. */}
                <span
                  aria-hidden="true"
                  className="absolute top-0 left-1/2 w-px -translate-x-1/2 bg-hairline-strong"
                  style={{ height: LEVEL_GAP / 2 }}
                />

                {child.similarityToParent !== null && (
                  <span
                    data-testid="tree-edge"
                    title={[child.group, ...child.genres].join(' · ')}
                    className="absolute top-0.5 left-1/2 -translate-x-1/2 bg-canvas px-1 text-[10px] tabular-nums text-ink-faint"
                  >
                    {percent(child.similarityToParent)}
                  </span>
                )}

                <Subtree
                  node={child}
                  depth={depth + 1}
                  onSave={onSave}
                  onDismiss={onDismiss}
                  savingOlid={savingOlid}
                />
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function NodeCard({
  node,
  depth,
  onSave,
  onDismiss,
  savingOlid
}: { node: RecommendationNode; depth: number } & Handlers): ReactNode {
  const saving = savingOlid === node.olid
  return (
    <article
      data-testid="tree-node"
      data-depth={depth}
      className="card flex w-36 flex-col items-center gap-1 p-2.5 text-center transition-shadow hover:shadow-raised"
    >
      <span className="w-10">
        <Cover title={node.title} author={node.author} coverId={node.coverId} size="sm" />
      </span>

      <h3 className="line-clamp-2 text-[12px] leading-snug font-medium">{node.title}</h3>
      {node.author && <p className="w-full truncate text-[11px] text-ink-muted">{node.author}</p>}

      {/* Only the leading genre: a node is 144px wide, and the rest are on the
          edge tooltip. A chip row here would widen every node in the tree. */}
      <span className="chip max-w-full truncate text-[10px]">{node.genres[0] ?? node.group}</span>

      <span className="text-[10px] tabular-nums text-ink-faint">{percent(node.score)} match</span>

      {/* Icon buttons, so a node stays narrow enough for a wide tree to fit. */}
      <div className="flex h-7 items-center gap-1 pt-0.5">
        {saving ? (
          <Spinner label={`Adding ${node.title}`} className="size-4" />
        ) : (
          <IconButton
            label={`Want to read ${node.title}`}
            tooltip="Want to read"
            className="hover:bg-accent-soft hover:text-accent"
            onClick={() => onSave(node.olid)}
          >
            <path d="M8 3.5v9M3.5 8h9" />
          </IconButton>
        )}
        <IconButton
          label={`Not for me: ${node.title}`}
          tooltip="Not for me"
          className="hover:bg-danger-soft hover:text-danger"
          onClick={() => onDismiss(node.olid)}
        >
          <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />
        </IconButton>
      </div>
    </article>
  )
}

function IconButton({
  label,
  tooltip,
  className,
  onClick,
  children
}: {
  label: string
  tooltip: string
  className: string
  onClick: () => void
  children: ReactNode
}): ReactNode {
  return (
    <button
      type="button"
      aria-label={label}
      title={tooltip}
      onClick={onClick}
      className={`flex size-6 items-center justify-center rounded-control text-ink-faint transition-colors ${className}`}
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 16 16"
        className="size-3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      >
        {children}
      </svg>
    </button>
  )
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`
}
