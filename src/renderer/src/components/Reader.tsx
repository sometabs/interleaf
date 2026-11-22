import 'foliate-js/view.js'
import { compare as compareCfi } from 'foliate-js/epubcfi.js'
import { Overlayer } from 'foliate-js/overlayer.js'
import type { Bookmark, Note } from '@shared/api'
import { toPlainText } from '@shared/plaintext'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode
} from 'react'

import { confirm } from '../lib/confirm'
import { fromDateInput, relativeDate, toDateInput } from '../lib/dates'
import { fail, notify } from '../lib/feedback'
import { inertPage, isPage } from '../lib/epubContent'
import { isNoteReference, isNoteTarget, noteText } from '../lib/footnotes'
import { usePersistentState } from '../lib/persistent'
import { ReadingClock } from '../lib/readingClock'
import {
  useAddBookmark,
  useBook,
  useBookmarks,
  useCreateNote,
  useDeleteNote,
  useNotes,
  useRecordReading,
  useRemoveBookmark,
  useSaveReadingPosition,
  useUpdateBook
} from '../lib/queries'
import { isQuote, QUOTE_KIND } from '../lib/quotes'
import {
  bookCss,
  DEFAULT_LOOK,
  layoutOf,
  LIMITS,
  narrower,
  pageLabel,
  parseLook,
  step,
  shownTheme,
  THEME_CHOICES,
  THEMES,
  widthRoom,
  withLayout,
  type ReaderLook,
  type ShownTheme
} from '../lib/readerLook'
import { useAppDark } from '../lib/settings'
import { useView } from '../lib/view'

interface TocItem {
  label: string
  href: string
  subitems?: TocItem[] | null
}

interface FoliateBook {
  toc?: TocItem[]
  transformTarget?: EventTarget
  resolveHref?: (href: string) => {
    index: number
    anchor: (doc: Document) => Element | Range | null
  }
  sections: { createDocument?: () => Promise<Document> }[]
}

interface Relocation {
  fraction: number
  cfi: string
  range?: Range
  section?: { current: number }
  tocItem?: TocItem | null
}

interface Page {
  start: string
  end: string
  excerpt: string
}

interface SearchGroup {
  label: string
  subitems: { cfi: string; excerpt: { pre: string; match: string; post: string } }[]
}

interface FoliateRenderer extends HTMLElement {
  setStyles?: (css: string) => void
  page?: number
  pages?: number
  // One per column on screen.
  heads?: unknown[] | null
  getContents?: () => { doc: Document }[]
}

interface FoliateView extends HTMLElement {
  book: FoliateBook
  renderer: FoliateRenderer
  open(file: File): Promise<void>
  init(options: { lastLocation?: string; showTextStart?: boolean }): Promise<void>
  close(): void
  goTo(target: string): Promise<unknown>
  goToFraction(fraction: number): Promise<void>
  goLeft(): Promise<void>
  goRight(): Promise<void>
  getCFI(index: number, range: Range): string
  addAnnotation(annotation: Annotation, remove?: boolean): Promise<unknown>
  deleteAnnotation(annotation: Annotation): Promise<unknown>
  search(options: { query: string }): AsyncGenerator<SearchGroup | { progress: number } | 'done'>
  clearSearch(): void
}

interface Annotation {
  value: string
  quote?: boolean
}

type Panel = 'contents' | 'search' | 'highlights' | 'look'

interface Point {
  x: number
  y: number
}

interface Picked extends Point {
  cfi: string
  text: string
  doc: Document
}

const HIGHLIGHT = '#f2c94c'
const UNDERLINE = '#5b84c9'
const CHROME_IDLE_MS = 2500
const CHROME_EDGE = 64
const TIME_SAVE_MS = 60_000
// Opening a book to check a passage is not a reading session.
const TIME_MINIMUM_SECONDS = 20

function today(): number | null {
  return fromDateInput(toDateInput(Math.floor(Date.now() / 1000)))
}

function quoteLines(text: string): string {
  return text
    .split(/\n+/)
    .map((line) => `> ${line.trim()}`)
    .join('\n')
}

// A range lives in its frame's coordinates; the popovers live in the reader's.
function pointOf(range: Range, host: HTMLElement): Point {
  const frame = range.startContainer.ownerDocument?.defaultView?.frameElement
  const offset = frame?.getBoundingClientRect() ?? { left: 0, top: 0 }
  const box = range.getBoundingClientRect()
  const base = host.getBoundingClientRect()
  return {
    x: offset.left + box.left + box.width / 2 - base.left,
    y: offset.top + box.top - base.top
  }
}

function byPlace(a: string, b: string): number {
  try {
    return compareCfi(a, b)
  } catch {
    return 0
  }
}

function sortByPlace(notes: Note[]): Note[] {
  return [...notes].sort((a, b) => byPlace(a.location!, b.location!))
}

function onPage(cfi: string, page: Page | null): boolean {
  if (!page) return false
  try {
    return compareCfi(page.start, cfi) <= 0 && compareCfi(cfi, page.end) <= 0
  } catch {
    return cfi === page.start
  }
}

// The end of what is on screen, so a bookmark anywhere on the page still counts as this page.
function pageOf(view: FoliateView, detail: Relocation): Page {
  let end = detail.cfi
  const range = detail.range
  if (range && detail.section) {
    try {
      const last = range.cloneRange()
      last.collapse(false)
      end = view.getCFI(detail.section.current, last)
    } catch {
      end = detail.cfi
    }
  }
  const excerpt = range?.toString().replace(/\s+/g, ' ').trim().slice(0, 160) ?? ''
  return { start: detail.cfi, end, excerpt }
}

const isBookmarkKey = (event: KeyboardEvent): boolean =>
  (event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'd'

export default function Reader({ bookId, at }: { bookId: number; at?: string }): ReactNode {
  const book = useBook(bookId)
  const { back, navigate } = useView()
  const { data: notes = [] } = useNotes(bookId)
  const createNote = useCreateNote()
  const deleteNote = useDeleteNote()
  const updateBook = useUpdateBook()
  const savePosition = useSaveReadingPosition(bookId)
  const recordReading = useRecordReading(bookId)
  const { data: bookmarks = [] } = useBookmarks(bookId)
  const addBookmark = useAddBookmark(bookId)
  const removeBookmark = useRemoveBookmark(bookId)
  const [look, setLook] = usePersistentState<ReaderLook>('reader.look', DEFAULT_LOOK, parseLook)
  const themeShown = shownTheme(look.theme, useAppDark())

  const shellRef = useRef<HTMLDivElement>(null)
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<FoliateView | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [area, setArea] = useState({ width: 0, height: 0 })
  const [problem, setProblem] = useState('')
  const [toc, setToc] = useState<TocItem[]>([])
  const [place, setPlace] = useState({
    fraction: 0,
    chapter: '',
    tocItem: null as TocItem | null,
    screen: 0,
    screens: 0,
    columns: 1
  })
  const [shown, setShown] = useState<Page | null>(null)
  const [panel, setPanel] = useState<Panel | null>(null)
  const [picked, setPicked] = useState<Picked | null>(null)
  const [noteDraft, setNoteDraft] = useState<string | null>(null)
  const [opened, setOpened] = useState<(Point & { note: Note }) | null>(null)
  const [footnote, setFootnote] = useState<(Point & { text: string; href: string }) | null>(null)
  // Where a link jump left from, so one click goes back.
  const [returnTo, setReturnTo] = useState<string | null>(null)
  const [chromeShown, setChromeShown] = useState(true)
  const [pointerResting, setPointerResting] = useState(false)
  const [fullScreen, setFullScreen] = useState(false)
  const [startAsked, setStartAsked] = useState(false)
  const [finishAsked, setFinishAsked] = useState(false)

  const [readyView, setReadyView] = useState<FoliateView | null>(null)

  const located = useMemo(() => notes.filter((note) => note.location), [notes])
  const locatedRef = useRef(located)
  const lookRef = useRef(look)
  const themeRef = useRef(themeShown)
  const overlayRef = useRef({ panel, picked, opened, footnote })
  const pendingPosition = useRef<Relocation | null>(null)
  // Opened at a quote, the saved place stays put until the reader moves on from there.
  const following = useRef(at === undefined)
  const saveTimer = useRef<number | undefined>(undefined)
  const savePositionRef = useRef(savePosition.mutate)
  const recordReadingRef = useRef(recordReading.mutate)
  useLayoutEffect(() => {
    locatedRef.current = located
    lookRef.current = look
    themeRef.current = themeShown
    overlayRef.current = { panel, picked, opened, footnote }
    savePositionRef.current = savePosition.mutate
    recordReadingRef.current = recordReading.mutate
  })

  const flushPosition = useCallback((): void => {
    window.clearTimeout(saveTimer.current)
    const latest = pendingPosition.current
    pendingPosition.current = null
    if (latest?.cfi) savePositionRef.current({ cfi: latest.cfi, fraction: latest.fraction })
  }, [])

  const clearSelection = useCallback((): void => {
    setPicked((current) => {
      current?.doc.getSelection()?.removeAllRanges()
      return null
    })
    setNoteDraft(null)
  }, [])

  // Overlays first, then the screen: one Escape never does both.
  const dismissOverlay = useCallback((): boolean => {
    const { panel: open, picked: selection, opened: highlight, footnote: note } = overlayRef.current
    if (note) setFootnote(null)
    else if (selection) clearSelection()
    else if (highlight) setOpened(null)
    else if (open) setPanel(null)
    else return false
    return true
  }, [clearSelection])

  const turn = useCallback((key: string, target: EventTarget | null): boolean => {
    const view = viewRef.current
    const typing =
      target instanceof HTMLElement &&
      (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
    if (!view || typing) return false
    // Turning the page means reading on from here, so the way back is no longer needed.
    if (/^(ArrowLeft|ArrowRight|PageUp|PageDown| )$/.test(key)) setReturnTo(null)
    if (key === 'ArrowLeft' || key === 'PageUp') void view.goLeft()
    else if (key === 'ArrowRight' || key === 'PageDown' || key === ' ') void view.goRight()
    else return false
    return true
  }, [])

  const marked = bookmarks.find((bookmark) => onPage(bookmark.cfi, shown)) ?? null
  const toggleBookmark = useCallback((): void => {
    if (status !== 'ready' || !shown) return
    if (marked) removeBookmark.mutate(marked.id, { onError: fail })
    else
      addBookmark.mutate(
        { cfi: shown.start, excerpt: shown.excerpt, chapter: place.chapter || null },
        { onError: fail }
      )
  }, [status, shown, marked, place.chapter, addBookmark, removeBookmark])

  // The chrome fades while reading and comes back only near the top or bottom edge, so moving
  // over the text to select it leaves the page clean.
  const idleTimer = useRef<number | undefined>(undefined)
  const wake = useCallback((): void => {
    setChromeShown(true)
    window.clearTimeout(idleTimer.current)
    idleTimer.current = window.setTimeout(() => setChromeShown(false), CHROME_IDLE_MS)
  }, [])

  useEffect(() => {
    idleTimer.current = window.setTimeout(() => setChromeShown(false), CHROME_IDLE_MS)
    return () => window.clearTimeout(idleTimer.current)
  }, [])

  // The cursor hides on the same idle timer, but any movement brings it back, not only near an edge.
  const cursorTimer = useRef<number | undefined>(undefined)
  const stir = useCallback((): void => {
    setPointerResting(false)
    window.clearTimeout(cursorTimer.current)
    cursorTimer.current = window.setTimeout(() => setPointerResting(true), CHROME_IDLE_MS)
  }, [])
  useEffect(() => () => window.clearTimeout(cursorTimer.current), [])

  const cursorHidden = pointerResting && !chromeShown && panel === null && status === 'ready'
  const cursorHiddenRef = useRef(cursorHidden)
  useEffect(() => {
    cursorHiddenRef.current = cursorHidden
    for (const { doc } of viewRef.current?.renderer.getContents?.() ?? [])
      hideCursorIn(doc, cursorHidden)
  }, [cursorHidden])

  // The book loads once per open; handlers are read through a ref so a re-render never reloads it.
  const handlers = useRef({ back, dismissOverlay, flushPosition, stir, toggleBookmark, turn, wake })
  useLayoutEffect(() => {
    handlers.current = { back, dismissOverlay, flushPosition, stir, toggleBookmark, turn, wake }
  })

  useEffect(() => {
    const host = hostRef.current
    if (!host || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() =>
      setArea({ width: host.clientWidth, height: host.clientHeight })
    )
    observer.observe(host)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let cancelled = false
    const { flushPosition: flush } = handlers.current
    const view = document.createElement('foliate-view') as FoliateView
    view.style.display = 'block'
    view.style.height = '100%'
    view.style.width = '100%'
    host.append(view)
    viewRef.current = view

    const startedAt = Math.floor(Date.now() / 1000)
    const clock = new ReadingClock(Date.now())
    if (document.hidden) clock.pause(Date.now())
    let opened = false
    const saveTime = (): void => {
      const seconds = clock.seconds
      if (opened && seconds >= TIME_MINIMUM_SECONDS)
        recordReadingRef.current({ startedAt, seconds })
    }
    const touch = (): void => clock.activity(Date.now())
    const onVisibility = (): void => {
      if (document.hidden) {
        clock.pause(Date.now())
        saveTime()
      } else clock.resume(Date.now())
    }
    document.addEventListener('visibilitychange', onVisibility)
    const timeTimer = window.setInterval(saveTime, TIME_SAVE_MS)

    let lastFraction = 0
    const onRelocate = (event: Event): void => {
      const detail = (event as CustomEvent<Relocation>).detail
      // A chapter with no text has no pages to measure a position in.
      if (!Number.isFinite(detail.fraction)) detail.fraction = lastFraction
      lastFraction = detail.fraction
      const { renderer } = view
      touch()
      setShown(pageOf(view, detail))
      setPlace({
        fraction: detail.fraction ?? 0,
        chapter: detail.tocItem?.label?.trim() ?? '',
        tocItem: detail.tocItem ?? null,
        screen: renderer.page ?? 0,
        screens: renderer.pages ?? 0,
        columns: renderer.heads?.length ?? 1
      })
      if (!following.current) return
      pendingPosition.current = detail
      window.clearTimeout(saveTimer.current)
      saveTimer.current = window.setTimeout(() => handlers.current.flushPosition(), 800)
    }
    const follow = (): void => {
      following.current = true
    }
    for (const type of ['pointerdown', 'keydown', 'wheel']) {
      window.addEventListener(type, follow, true)
      window.addEventListener(type, touch, true)
    }

    const onLoad = (event: Event): void => {
      const { doc, index } = (event as CustomEvent<{ doc: Document; index: number }>).detail
      const restCursor = doc.createElement('style')
      restCursor.textContent =
        'html[data-cursor-hidden], html[data-cursor-hidden] * { cursor: none !important; }'
      doc.head?.append(restCursor)
      hideCursorIn(doc, cursorHiddenRef.current)
      doc.addEventListener('mousemove', () => handlers.current.stir())
      for (const type of ['pointerdown', 'keydown', 'wheel']) {
        doc.addEventListener(type, follow, true)
        doc.addEventListener(type, touch, true)
      }
      doc.addEventListener('keydown', (keyEvent) => {
        const current = handlers.current
        if (isBookmarkKey(keyEvent)) {
          keyEvent.preventDefault()
          current.toggleBookmark()
        } else if (current.turn(keyEvent.key, keyEvent.target)) keyEvent.preventDefault()
        else if (keyEvent.key === 'Escape' && !current.dismissOverlay()) current.back()
      })
      // A link has already claimed its click.
      doc.addEventListener('click', (clickEvent) => {
        const selection = doc.getSelection()
        if (clickEvent.defaultPrevented || (selection && !selection.isCollapsed)) return
        const frame = doc.defaultView?.frameElement?.getBoundingClientRect()
        turnAtEdge((frame?.left ?? 0) + clickEvent.clientX)
      })
      doc.addEventListener('pointerdown', () => {
        setOpened(null)
        setFootnote(null)
      })
      doc.addEventListener('pointerup', () => {
        // The selection settles after pointerup.
        window.setTimeout(() => {
          const selection = doc.getSelection()
          const text = selection?.toString().trim() ?? ''
          if (!selection || selection.isCollapsed || !selection.rangeCount || !text) {
            setPicked(null)
            setNoteDraft(null)
            return
          }
          const range = selection.getRangeAt(0)
          setOpened(null)
          setNoteDraft(null)
          setPicked({ cfi: view.getCFI(index, range), text, doc, ...pointOf(range, host) })
        })
      })
    }

    // The outer fifth of the reading area turns the page, margins included.
    const turnAtEdge = (pageX: number): void => {
      if (lookRef.current.flow !== 'paginated') return
      const area = host.getBoundingClientRect()
      const x = pageX - area.left
      if (x < area.width * 0.2) {
        setReturnTo(null)
        void view.goLeft()
      } else if (x > area.width * 0.8) {
        setReturnTo(null)
        void view.goRight()
      }
    }

    // A footnote opens in place; any other link inside the book jumps, with a way back.
    // Every link waits until its target is read: only then is it clear whether it is a note.
    const onLink = (event: Event): void => {
      const { a, href } = (event as CustomEvent<{ a: HTMLAnchorElement; href: string }>).detail
      const from = (view as FoliateView & { lastLocation?: { cfi?: string } }).lastLocation?.cfi
      event.preventDefault()
      setFootnote(null)
      const range = a.ownerDocument.createRange()
      range.selectNodeContents(a)
      const point = pointOf(range, host)
      const jump = (): void => {
        if (from) setReturnTo(from)
        void view.goTo(href)
      }
      void (async () => {
        try {
          const target = view.book.resolveHref?.(href)
          const doc = target ? await view.book.sections[target.index]?.createDocument?.() : null
          const found = target && doc ? target.anchor(doc) : null
          const text = isNoteReference(a) || isNoteTarget(found) ? noteText(found) : ''
          if (text) setFootnote({ text, href, ...point })
          else jump()
        } catch {
          // A note that can't be read in place is still reachable the ordinary way.
          jump()
        }
      })()
    }
    // Clicks inside a book frame never reach here; these are the margins around it.
    host.addEventListener('click', (clickEvent) => turnAtEdge(clickEvent.clientX))

    const onCreateOverlay = (): void => {
      for (const note of locatedRef.current) {
        void view.addAnnotation({ value: note.location!, quote: isQuote(note) })
      }
    }

    const onDraw = (event: Event): void => {
      const { draw, annotation } = (
        event as CustomEvent<{
          draw: (fn: typeof Overlayer.highlight, options: Record<string, unknown>) => void
          annotation: Annotation
        }>
      ).detail
      if (annotation.quote) draw(Overlayer.highlight, { color: HIGHLIGHT })
      else draw(Overlayer.underline, { color: UNDERLINE, width: 2 })
    }

    const onShowAnnotation = (event: Event): void => {
      const { value, range } = (event as CustomEvent<{ value: string; range: Range }>).detail
      const note = locatedRef.current.find((candidate) => candidate.location === value)
      if (note) setOpened({ note, ...pointOf(range, host) })
    }

    void (async () => {
      try {
        const [bytes, position] = await Promise.all([
          window.interleaf.readEpub(bookId),
          window.interleaf.getReadingPosition(bookId)
        ])
        if (cancelled) return
        const file = new File([bytes as Uint8Array<ArrayBuffer>], 'book.epub', {
          type: 'application/epub+zip'
        })
        await view.open(file)
        if (cancelled) return

        const target = view.book.transformTarget
        target?.addEventListener('load', (event) => {
          const detail = (event as CustomEvent<{ isScript: boolean; allow: boolean }>).detail
          if (detail.isScript) detail.allow = false
        })
        target?.addEventListener('data', (event) => {
          const detail = (event as CustomEvent<{ data: unknown; type: string }>).detail
          detail.data = Promise.resolve(detail.data)
            .then((data) =>
              typeof data === 'string' && isPage(detail.type) ? inertPage(data, detail.type) : data
            )
            .catch(() => '')
        })

        setToc(view.book.toc ?? [])
        view.addEventListener('relocate', onRelocate)
        view.addEventListener('load', onLoad)
        view.addEventListener('create-overlay', onCreateOverlay)
        view.addEventListener('draw-annotation', onDraw)
        view.addEventListener('show-annotation', onShowAnnotation)
        view.addEventListener('link', onLink)
        applyLook(view, lookRef.current, themeRef.current)
        // A quote from a replaced file may point nowhere; then open where reading stopped.
        let placed = false
        if (at) {
          try {
            await view.init({ lastLocation: at })
            placed = Boolean((view as FoliateView & { lastLocation?: unknown }).lastLocation)
          } catch {
            placed = false
          }
        }
        if (!placed) await view.init({ lastLocation: position?.cfi, showTextStart: !position })
        if (cancelled) return
        opened = true
        setStatus('ready')
        setReadyView(view)
      } catch (error) {
        if (cancelled) return
        setStatus('failed')
        setProblem(error instanceof Error ? error.message.replace(/^.*Error: /, '') : String(error))
      }
    })()

    return () => {
      for (const type of ['pointerdown', 'keydown', 'wheel']) {
        window.removeEventListener(type, follow, true)
        window.removeEventListener(type, touch, true)
      }
      document.removeEventListener('visibilitychange', onVisibility)
      window.clearInterval(timeTimer)
      clock.pause(Date.now())
      saveTime()
      cancelled = true
      flush()
      view.close?.()
      view.remove()
      viewRef.current = null
    }
  }, [bookId, at])

  useEffect(() => {
    if (viewRef.current && status === 'ready') applyLook(viewRef.current, look, themeShown)
  }, [look, themeShown, status])

  // Keeps the drawn highlights in step with the journal as quotes are added or removed.
  const drawn = useRef(new Set<string>())
  useEffect(() => {
    const view = viewRef.current
    if (!view || status !== 'ready') return
    const wanted = new Map(located.map((note) => [note.location!, isQuote(note)]))
    for (const value of drawn.current) {
      if (!wanted.has(value)) void view.deleteAnnotation({ value })
    }
    for (const [value, quote] of wanted) void view.addAnnotation({ value, quote })
    drawn.current = new Set(wanted.keys())
  }, [located, status])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        if (dismissOverlay()) event.stopPropagation()
        return
      }
      if (isBookmarkKey(event)) {
        event.preventDefault()
        handlers.current.toggleBookmark()
        return
      }
      if (turn(event.key, event.target)) event.preventDefault()
    }
    const onFullScreen = (): void => setFullScreen(document.fullscreenElement !== null)
    window.addEventListener('keydown', onKey, true)
    document.addEventListener('fullscreenchange', onFullScreen)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      document.removeEventListener('fullscreenchange', onFullScreen)
      if (document.fullscreenElement) void document.exitFullscreen()
    }
  }, [dismissOverlay, turn])

  async function saveQuote(): Promise<void> {
    if (!picked) return
    try {
      await createNote.mutateAsync({
        bookId,
        kind: QUOTE_KIND,
        bodyMd: picked.text,
        location: picked.cfi
      })
      notify('Quote saved.')
      clearSelection()
    } catch (error) {
      fail(error)
    }
  }

  async function saveNote(): Promise<void> {
    if (!picked || noteDraft === null) return
    try {
      const body = noteDraft.trim()
      await createNote.mutateAsync({
        bookId,
        kind: 'thought',
        bodyMd: body ? `${quoteLines(picked.text)}\n\n${body}` : quoteLines(picked.text),
        location: picked.cfi
      })
      notify('Note saved.')
      clearSelection()
    } catch (error) {
      fail(error)
    }
  }

  async function removeQuote(note: Note): Promise<void> {
    const sure = await confirm({
      title: 'Delete this quote?',
      body: 'It is removed from your journal too.',
      confirmLabel: 'Delete',
      destructive: true
    })
    if (!sure) return
    setOpened(null)
    deleteNote.mutate(note.id)
  }

  function go(target: string): void {
    setPanel(null)
    void viewRef.current?.goTo(target)
  }

  function toggleFullScreen(): void {
    if (document.fullscreenElement) void document.exitFullscreen()
    else void shellRef.current?.requestFullscreen()
  }

  if (!book) return null
  const theme = THEMES[themeShown]
  const dark = themeShown === 'dark'
  const chromeVisible = chromeShown || panel !== null || status !== 'ready'
  const askStart =
    status === 'ready' && !startAsked && (book.status === 'want' || book.status === 'abandoned')
  const askFinish =
    status === 'ready' &&
    !finishAsked &&
    !askStart &&
    book.status !== 'read' &&
    place.fraction >= 0.99

  return (
    <div
      ref={shellRef}
      data-testid="reader"
      className={`fixed inset-0 z-30 flex flex-col ${dark ? 'reader-dark' : ''} ${
        cursorHidden ? 'reader-cursor-hidden' : ''
      }`}
      style={
        {
          background: theme.background,
          color: theme.text,
          colorScheme: dark ? 'dark' : 'light',
          ...theme.colors
        } as CSSProperties
      }
      onMouseMove={(event) => {
        stir()
        const box = event.currentTarget.getBoundingClientRect()
        if (event.clientY - box.top < CHROME_EDGE || box.bottom - event.clientY < CHROME_EDGE)
          wake()
      }}
    >
      {/* Equal outer columns keep the title centred on the window, whatever sits either side. */}
      <header
        className={`grid grid-cols-[1fr_auto_1fr] items-center gap-3 px-4 py-2 transition-opacity duration-300 ${
          chromeVisible ? 'opacity-100' : 'opacity-0'
        }`}
      >
        <div>
          <button type="button" className="reader-btn" onClick={back}>
            ← Back
          </button>
        </div>
        <p className="max-w-[36vw] truncate text-center text-[13px] opacity-70">
          {book.title}
          {book.author ? ` · ${book.author}` : ''}
        </p>
        <div className="flex justify-end gap-1">
          {(['contents', 'search', 'highlights'] as const).map((name) => (
            <button
              key={name}
              type="button"
              aria-pressed={panel === name}
              aria-label={PANEL_LABELS[name]}
              title={PANEL_LABELS[name]}
              className="reader-btn reader-icon-btn"
              onClick={() => setPanel(panel === name ? null : name)}
            >
              {PANEL_ICONS[name]}
            </button>
          ))}
          <button
            type="button"
            aria-pressed={marked !== null}
            aria-label="Bookmark this page"
            title={marked ? 'Remove bookmark (Ctrl+D)' : 'Bookmark this page (Ctrl+D)'}
            className="reader-btn reader-icon-btn"
            disabled={status !== 'ready'}
            onClick={toggleBookmark}
          >
            <Icon filled={marked !== null}>
              <path d="M18 7v14l-6-4-6 4V7a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4z" />
            </Icon>
          </button>
          <button
            type="button"
            aria-pressed={panel === 'look'}
            aria-label="Text and layout"
            title="Text and layout"
            className="reader-btn reader-icon-btn"
            onClick={() => setPanel(panel === 'look' ? null : 'look')}
          >
            <span aria-hidden className="w-[18px] text-center text-[13px]">
              Aa
            </span>
          </button>
          <button
            type="button"
            aria-label={fullScreen ? 'Exit full screen' : 'Full screen'}
            title={fullScreen ? 'Exit full screen' : 'Full screen'}
            className="reader-btn reader-icon-btn"
            onClick={toggleFullScreen}
          >
            {fullScreen ? (
              <Icon>
                <path d="M15 19v-2a2 2 0 0 1 2-2h2M15 5v2a2 2 0 0 0 2 2h2M5 15h2a2 2 0 0 1 2 2v2M5 9h2a2 2 0 0 0 2-2V5" />
              </Icon>
            ) : (
              <Icon>
                <path d="M4 8V6a2 2 0 0 1 2-2h2M4 16v2a2 2 0 0 0 2 2h2M16 4h2a2 2 0 0 1 2 2v2M16 20h2a2 2 0 0 0 2-2v-2" />
              </Icon>
            )}
          </button>
        </div>
      </header>

      <div className="relative min-h-0 flex-1">
        <div ref={hostRef} className="absolute inset-0" />
        {marked && status === 'ready' && (
          <span aria-hidden data-testid="bookmark-ribbon" className="reader-ribbon" />
        )}

        {status === 'loading' && (
          <p className="absolute inset-0 grid place-items-center text-[13px] opacity-60">
            Opening the book…
          </p>
        )}
        {status === 'failed' && (
          <div className="absolute inset-0 grid place-items-center">
            <div className="max-w-sm text-center">
              <p className="text-[14px] font-medium">This book could not be opened.</p>
              <p className="mt-1 text-[13px] opacity-70">{problem}</p>
              <button type="button" className="reader-btn mt-3" onClick={back}>
                Back to the book
              </button>
            </div>
          </div>
        )}

        {picked && (
          <Popover point={picked} label="Selected text">
            {noteDraft === null ? (
              <div className="flex gap-1">
                <button type="button" className="reader-btn" onClick={() => void saveQuote()}>
                  Quote
                </button>
                <button type="button" className="reader-btn" onClick={() => setNoteDraft('')}>
                  Note
                </button>
              </div>
            ) : (
              <div className="w-72">
                <textarea
                  autoFocus
                  aria-label="Note on this passage"
                  className="field min-h-24 w-full text-[13px]"
                  value={noteDraft}
                  onChange={(event) => setNoteDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) void saveNote()
                  }}
                />
                <div className="mt-2 flex justify-end gap-1">
                  <button type="button" className="btn btn-ghost" onClick={clearSelection}>
                    Cancel
                  </button>
                  <button type="button" className="btn btn-primary" onClick={() => void saveNote()}>
                    Save note
                  </button>
                </div>
              </div>
            )}
          </Popover>
        )}

        {footnote && (
          <Popover point={footnote} label="Footnote">
            <div className="w-80 max-w-[70vw] p-1.5">
              <p className="max-h-56 overflow-y-auto text-[13px] leading-relaxed whitespace-pre-line">
                {footnote.text}
              </p>
              <div className="mt-2 flex justify-end">
                <button
                  type="button"
                  className="reader-btn"
                  onClick={() => {
                    const from = (
                      readyView as (FoliateView & { lastLocation?: { cfi?: string } }) | null
                    )?.lastLocation?.cfi
                    if (from) setReturnTo(from)
                    setFootnote(null)
                    void readyView?.goTo(footnote.href)
                  }}
                >
                  Go to note
                </button>
              </div>
            </div>
          </Popover>
        )}

        {returnTo && status === 'ready' && (
          <button
            type="button"
            className="absolute bottom-4 left-4 z-10 rounded-card border border-hairline bg-surface px-3 py-1.5 text-[13px] text-ink shadow-pop hover:bg-hover"
            onClick={() => {
              const back = returnTo
              setReturnTo(null)
              void readyView?.goTo(back)
            }}
          >
            ← Back to where you were
          </button>
        )}

        {opened && (
          <Popover point={opened} label={isQuote(opened.note) ? 'Quote' : 'Note'}>
            <div className="flex gap-1">
              {isQuote(opened.note) ? (
                <>
                  <button
                    type="button"
                    className="reader-btn"
                    onClick={() => navigate({ kind: 'quotes' })}
                  >
                    Open in Quotes
                  </button>
                  <button
                    type="button"
                    className="reader-btn"
                    onClick={() => void removeQuote(opened.note)}
                  >
                    Delete
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="reader-btn"
                  onClick={() => navigate({ kind: 'note', id: opened.note.id })}
                >
                  Open note
                </button>
              )}
            </div>
          </Popover>
        )}

        {panel && (
          <aside
            aria-label={PANEL_LABELS[panel]}
            className="absolute inset-y-0 right-0 z-10 flex w-[min(340px,90vw)] flex-col border-l border-hairline bg-surface text-ink shadow-pop"
          >
            {panel === 'contents' && <Contents items={toc} current={place.tocItem} onPick={go} />}
            {panel === 'search' && readyView && (
              <Search view={readyView} onPick={(cfi) => void readyView.goTo(cfi)} />
            )}
            {panel === 'highlights' && (
              <Marks
                notes={sortByPlace(located)}
                bookmarks={[...bookmarks].sort((a, b) => byPlace(a.cfi, b.cfi))}
                current={marked}
                onPick={(cfi) => go(cfi)}
                onRemove={(bookmark) => removeBookmark.mutate(bookmark.id, { onError: fail })}
              />
            )}
            {panel === 'look' && (
              <LookPanel look={look} room={widthRoom(look, area)} onChange={setLook} />
            )}
          </aside>
        )}

        {(askStart || askFinish) && (
          <div
            role="status"
            className="absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-3 rounded-card border border-hairline bg-surface px-4 py-2.5 text-[13px] text-ink shadow-pop"
          >
            <span>{askStart ? 'Start reading this book?' : 'Finished this book?'}</span>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                const patch = askStart
                  ? { status: 'reading' as const, startedAt: book.startedAt ?? today() }
                  : { status: 'read' as const, finishedAt: book.finishedAt ?? today() }
                updateBook.mutate({ id: book.id, patch })
                if (askStart) setStartAsked(true)
                else setFinishAsked(true)
              }}
            >
              {askStart ? 'Start reading' : 'Mark as read'}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => (askStart ? setStartAsked(true) : setFinishAsked(true))}
            >
              Not now
            </button>
          </div>
        )}
      </div>

      {/* The page and percentage stay while reading; the chapter and slider come back on movement. */}
      <footer className="relative flex items-center gap-3 px-5 py-2 text-[12px]">
        <span
          className={`w-1/3 truncate transition-opacity duration-300 ${
            chromeVisible ? 'opacity-70' : 'opacity-0'
          }`}
        >
          {place.chapter}
        </span>
        <input
          type="range"
          aria-label="Position in the book"
          min={0}
          max={1}
          step={0.001}
          value={place.fraction}
          disabled={status !== 'ready'}
          onChange={(event) => void viewRef.current?.goToFraction(Number(event.target.value))}
          className={`reader-progress min-w-0 flex-1 transition-opacity duration-300 ${
            chromeVisible ? '' : 'opacity-0!'
          }`}
        />
        {/* Centred on the window, under the page, as in a printed book. */}
        <span
          data-testid="reader-page"
          className={`pointer-events-none absolute inset-0 grid place-items-center tabular-nums transition-opacity duration-300 ${
            chromeVisible ? 'opacity-0' : 'opacity-55'
          }`}
        >
          {pageLabel(
            place.screen,
            place.screens,
            place.columns,
            look.flow === 'scrolled',
            look.pageCount
          )}
        </span>
        <span className="w-12 text-right tabular-nums opacity-55">
          {Math.round(place.fraction * 100)}%
        </span>
      </footer>
    </div>
  )
}

const PANEL_LABELS: Record<Panel, string> = {
  contents: 'Contents',
  search: 'Search',
  highlights: 'Highlights and bookmarks',
  look: 'Text and layout'
}

function Icon({ children, filled = false }: { children: ReactNode; filled?: boolean }): ReactNode {
  return (
    <svg
      aria-hidden
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  )
}

const PANEL_ICONS: Record<'contents' | 'search' | 'highlights', ReactNode> = {
  contents: (
    <Icon>
      <path d="M9 6h11M9 12h11M9 18h11M5 6v.01M5 12v.01M5 18v.01" />
    </Icon>
  ),
  search: (
    <Icon>
      <circle cx="10" cy="10" r="7" />
      <path d="m21 21-6-6" />
    </Icon>
  ),
  highlights: (
    <Icon>
      <path d="M3 19h4L17.5 8.5a2.83 2.83 0 0 0-4-4L3 15v4" />
      <path d="m12.5 5.5 4 4M4.5 13.5l4 4M21 15v4h-8l4-4z" />
    </Icon>
  )
}

function hideCursorIn(doc: Document, hidden: boolean): void {
  doc.documentElement.toggleAttribute('data-cursor-hidden', hidden)
}

function applyLook(view: FoliateView, look: ReaderLook, shown: ShownTheme): void {
  const renderer = view.renderer
  renderer.setAttribute('flow', look.flow)
  renderer.setAttribute('max-column-count', String(look.pages))
  renderer.setAttribute('max-inline-size', `${look.width}px`)
  renderer.setAttribute('margin', `${look.margin}px`)
  renderer.setAttribute('gap', '6%')
  renderer.setStyles?.(bookCss(look, shown))
}

function Popover({
  point,
  label,
  children
}: {
  point: Point
  label: string
  children: ReactNode
}): ReactNode {
  const below = point.y < 64
  return (
    <div
      role="dialog"
      aria-label={label}
      className="absolute z-20 rounded-card border border-hairline bg-surface p-1.5 text-ink shadow-pop"
      style={{
        left: Math.max(24, point.x),
        top: below ? point.y + 28 : point.y - 8,
        transform: below ? 'translateX(-50%)' : 'translate(-50%, -100%)'
      }}
    >
      {children}
    </div>
  )
}

function Contents({
  items,
  current,
  onPick
}: {
  items: TocItem[]
  current: TocItem | null
  onPick: (href: string) => void
}): ReactNode {
  const currentRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    currentRef.current?.scrollIntoView({ block: 'center' })
  }, [])

  if (items.length === 0) {
    return <p className="p-5 text-[13px] text-ink-muted">This book has no table of contents.</p>
  }
  const isCurrent = (item: TocItem): boolean =>
    current !== null &&
    (item === current || (item.href === current.href && item.label === current.label))
  const render = (list: TocItem[], depth: number): ReactNode => (
    <ul>
      {list.map((item, index) => {
        const here = isCurrent(item)
        return (
          <li key={`${item.href}-${index}`}>
            <button
              ref={here ? currentRef : undefined}
              type="button"
              aria-current={here ? 'location' : undefined}
              className={`w-full truncate rounded-control px-3 py-1.5 text-left text-[13px] hover:bg-hover ${
                here ? 'bg-accent-soft font-medium text-accent' : ''
              }`}
              style={{ paddingLeft: 12 + depth * 14 }}
              onClick={() => onPick(item.href)}
            >
              {item.label.trim() || 'Untitled'}
            </button>
            {item.subitems && item.subitems.length > 0 && render(item.subitems, depth + 1)}
          </li>
        )
      })}
    </ul>
  )
  return <nav className="overflow-y-auto p-2">{render(items, 0)}</nav>
}

function Search({ view, onPick }: { view: FoliateView; onPick: (cfi: string) => void }): ReactNode {
  const [query, setQuery] = useState('')
  const [groups, setGroups] = useState<SearchGroup[]>([])
  const [searching, setSearching] = useState(false)
  const [searched, setSearched] = useState(false)
  const run = useRef(0)

  useEffect(() => () => view.clearSearch(), [view])

  async function search(): Promise<void> {
    const text = query.trim()
    const id = ++run.current
    setGroups([])
    setSearched(false)
    if (!text) {
      view.clearSearch()
      return
    }
    setSearching(true)
    try {
      for await (const result of view.search({ query: text })) {
        if (id !== run.current || result === 'done') break
        if ('subitems' in result) setGroups((current) => [...current, result])
      }
    } finally {
      if (id === run.current) {
        setSearching(false)
        setSearched(true)
      }
    }
  }

  const count = groups.reduce((total, group) => total + group.subitems.length, 0)
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <form
        className="border-b border-hairline p-3"
        onSubmit={(event) => {
          event.preventDefault()
          void search()
        }}
      >
        <input
          autoFocus
          type="search"
          aria-label="Search in this book"
          placeholder="Search in this book…"
          className="field w-full text-[13px]"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <p className="mt-1.5 text-[11px] text-ink-faint" aria-live="polite">
          {searching
            ? 'Searching…'
            : searched
              ? `${count} ${count === 1 ? 'result' : 'results'}`
              : ''}
        </p>
      </form>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {groups.map((group, index) => (
          <section key={index} className="mb-2">
            <h3 className="px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
              {group.label || 'Untitled'}
            </h3>
            {group.subitems.map(({ cfi, excerpt }) => (
              <button
                key={cfi}
                type="button"
                className="w-full rounded-control px-3 py-1.5 text-left text-[12px] text-ink-muted hover:bg-hover"
                onClick={() => onPick(cfi)}
              >
                {excerpt.pre}
                <mark className="rounded-sm bg-accent-soft px-0.5 text-ink">{excerpt.match}</mark>
                {excerpt.post}
              </button>
            ))}
          </section>
        ))}
      </div>
    </div>
  )
}

function Marks({
  notes,
  bookmarks,
  current,
  onPick,
  onRemove
}: {
  notes: Note[]
  bookmarks: Bookmark[]
  current: Bookmark | null
  onPick: (cfi: string) => void
  onRemove: (bookmark: Bookmark) => void
}): ReactNode {
  const [tab, setTab] = useState<'highlights' | 'bookmarks'>(
    notes.length === 0 && bookmarks.length > 0 ? 'bookmarks' : 'highlights'
  )
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex gap-1 border-b border-hairline p-2" role="group" aria-label="Show">
        {(
          [
            ['highlights', 'Highlights'],
            ['bookmarks', 'Bookmarks']
          ] as const
        ).map(([name, label]) => (
          <button
            key={name}
            type="button"
            aria-pressed={tab === name}
            className={`rounded-control px-2.5 py-1 text-[12px] ${
              tab === name
                ? 'bg-accent-soft font-medium text-accent'
                : 'text-ink-muted hover:bg-hover'
            }`}
            onClick={() => setTab(name)}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'highlights' ? (
        <Highlights notes={notes} onPick={onPick} />
      ) : (
        <Bookmarks bookmarks={bookmarks} current={current} onPick={onPick} onRemove={onRemove} />
      )}
    </div>
  )
}

function Bookmarks({
  bookmarks,
  current,
  onPick,
  onRemove
}: {
  bookmarks: Bookmark[]
  current: Bookmark | null
  onPick: (cfi: string) => void
  onRemove: (bookmark: Bookmark) => void
}): ReactNode {
  if (bookmarks.length === 0) {
    return (
      <p className="p-5 text-[13px] text-ink-muted">
        Use the bookmark button or Ctrl+D to mark a page and find it here.
      </p>
    )
  }
  return (
    <ul className="min-h-0 flex-1 overflow-y-auto p-2">
      {bookmarks.map((bookmark) => {
        const when = relativeDate(bookmark.createdAt)
        return (
          <li
            key={bookmark.id}
            className={`group relative rounded-control ${bookmark.id === current?.id ? 'bg-sunken' : ''}`}
          >
            <button
              type="button"
              aria-current={bookmark.id === current?.id ? 'location' : undefined}
              className="w-full rounded-control px-3 py-2 pr-9 text-left hover:bg-hover"
              onClick={() => onPick(bookmark.cfi)}
            >
              <span className="flex justify-between gap-2 text-[11px] text-ink-faint">
                <span className="truncate">{bookmark.chapter ?? 'Bookmark'}</span>
                <span className="shrink-0">{when.charAt(0).toUpperCase() + when.slice(1)}</span>
              </span>
              <span className="mt-0.5 line-clamp-2 text-[13px]">
                {bookmark.excerpt || 'Marked page'}
              </span>
            </button>
            <button
              type="button"
              aria-label="Remove bookmark"
              title="Remove bookmark"
              className="absolute top-1.5 right-1.5 grid size-6 place-items-center rounded-control text-ink-faint opacity-0 group-hover:opacity-100 hover:bg-hover hover:text-ink focus-visible:opacity-100"
              onClick={() => onRemove(bookmark)}
            >
              ×
            </button>
          </li>
        )
      })}
    </ul>
  )
}

function Highlights({
  notes,
  onPick
}: {
  notes: Note[]
  onPick: (cfi: string) => void
}): ReactNode {
  if (notes.length === 0) {
    return (
      <p className="p-5 text-[13px] text-ink-muted">
        Select text while reading, then choose Quote or Note to keep it here.
      </p>
    )
  }
  return (
    <ul className="min-h-0 flex-1 divide-y divide-hairline overflow-y-auto p-2">
      {notes.map((note) => (
        <li key={note.id} className="py-1">
          <button
            type="button"
            className="w-full rounded-control px-3 py-2 text-left hover:bg-hover"
            onClick={() => onPick(note.location!)}
          >
            <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
              {isQuote(note) ? 'Quote' : 'Note'}
            </span>
            <span className="mt-0.5 line-clamp-3 text-[13px]">{toPlainText(note.bodyMd)}</span>
          </button>
        </li>
      ))}
    </ul>
  )
}

function LookPanel({
  look,
  room,
  onChange
}: {
  look: ReaderLook
  // The widest text width the window can show; wider changes nothing.
  room: number
  onChange: (next: ReaderLook) => void
}): ReactNode {
  const most = (key: keyof typeof LIMITS): number =>
    key === 'width' ? Math.min(LIMITS.width.max, room) : LIMITS[key].max
  const stepper = (key: keyof typeof LIMITS, label: string, shown: string): ReactNode => (
    <div className="flex items-center justify-between">
      <span className="text-[13px]">{label}</span>
      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-label={`Decrease ${label.toLowerCase()}`}
          className="btn btn-ghost w-8 justify-center"
          disabled={look[key] <= LIMITS[key].min}
          onClick={() => onChange(key === 'width' ? narrower(look, room) : step(look, key, -1))}
        >
          −
        </button>
        <span className="w-12 text-center text-[12px] tabular-nums text-ink-muted">{shown}</span>
        <button
          type="button"
          aria-label={`Increase ${label.toLowerCase()}`}
          className="btn btn-ghost w-8 justify-center"
          disabled={look[key] >= most(key)}
          onClick={() => onChange(step(look, key, 1))}
        >
          +
        </button>
      </div>
    </div>
  )

  return (
    <div className="space-y-5 overflow-y-auto p-5">
      <fieldset>
        <legend className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
          Theme
        </legend>
        <div className="grid grid-cols-4 gap-2">
          {THEME_CHOICES.map((name) => (
            <button
              key={name}
              type="button"
              aria-pressed={look.theme === name}
              title={name === 'auto' ? 'Light or dark, following the app' : undefined}
              className={`flex items-center justify-center gap-1.5 rounded-control border px-2 py-2 text-[12px] ${
                look.theme === name ? 'border-accent ring-1 ring-accent' : 'border-hairline-strong'
              } ${name === 'auto' ? 'bg-surface text-ink' : ''}`}
              style={
                name === 'auto'
                  ? undefined
                  : { background: THEMES[name].background, color: THEMES[name].text }
              }
              onClick={() => onChange({ ...look, theme: name })}
            >
              {name === 'auto' && (
                <span
                  aria-hidden
                  className="size-3 rounded-full border border-hairline-strong"
                  style={{
                    background: `linear-gradient(90deg, ${THEMES.light.background} 50%, ${THEMES.dark.background} 50%)`
                  }}
                />
              )}
              {name === 'auto' ? 'Auto' : THEMES[name].label}
            </button>
          ))}
        </div>
      </fieldset>

      <Segmented
        legend="Font"
        value={look.font}
        options={[
          ['book', 'Book'],
          ['serif', 'Serif'],
          ['sans', 'Sans']
        ]}
        onChange={(font) => onChange({ ...look, font })}
      />

      <Segmented
        legend="Alignment"
        value={look.align}
        options={[
          ['book', 'Book’s own'],
          ['left', 'Left'],
          ['justify', 'Justified']
        ]}
        onChange={(align) => onChange({ ...look, align })}
      />

      <div className="space-y-2">
        {stepper('size', 'Text size', `${look.size}%`)}
        {stepper('spacing', 'Line spacing', look.spacing.toFixed(1))}
        {stepper('width', 'Text width', `${look.width}`)}
        {stepper('margin', 'Margins', `${look.margin}`)}
      </div>

      <Segmented
        legend="Layout"
        value={layoutOf(look)}
        options={[
          ['two', 'Two pages'],
          ['one', 'One page'],
          ['scroll', 'Scroll']
        ]}
        onChange={(layout) => onChange(withLayout(look, layout))}
      />

      {look.flow === 'paginated' && (
        <Segmented
          legend="Page number"
          value={look.pageCount}
          options={[
            ['left', 'Pages left in chapter'],
            ['position', 'Page in chapter']
          ]}
          onChange={(pageCount) => onChange({ ...look, pageCount })}
        />
      )}
    </div>
  )
}

function Segmented<T extends string>({
  legend,
  value,
  options,
  onChange
}: {
  legend: string
  value: T
  options: [T, string][]
  onChange: (next: T) => void
}): ReactNode {
  return (
    <fieldset>
      <legend className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
        {legend}
      </legend>
      <div className="flex rounded-control border border-hairline-strong p-0.5">
        {options.map(([option, label]) => (
          <button
            key={option}
            type="button"
            aria-pressed={value === option}
            className={`flex-1 rounded-[3px] px-2 py-1 text-[12px] ${
              value === option ? 'bg-accent-soft font-medium text-accent' : 'text-ink-muted'
            }`}
            onClick={() => onChange(option)}
          >
            {label}
          </button>
        ))}
      </div>
    </fieldset>
  )
}
