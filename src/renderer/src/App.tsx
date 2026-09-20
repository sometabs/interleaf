import { useEffect, useState, type ReactNode } from 'react'

import AddBookDialog from './components/AddBookDialog'
import BookDetail from './components/BookDetail'
import CalibreImport from './components/CalibreImport'
import CommandPalette from './components/CommandPalette'
import ConfirmDialog from './components/ConfirmDialog'
import Data from './components/Data'
import Discover from './components/Discover'
import Empty from './components/Empty'
import Library from './components/Library'
import NoteView from './components/NoteView'
import Notes from './components/Notes'
import Quotes from './components/Quotes'
import ReadingQueue from './components/ReadingQueue'
import ReviewView from './components/ReviewView'
import Reviews from './components/Reviews'
import Sidebar from './components/Sidebar'
import Toasts from './components/Toasts'
import { usePendingConfirm } from './lib/confirm'
import { usePersistentState } from './lib/persistent'
import { useBook } from './lib/queries'
import { useView } from './lib/view'

export default function App(): ReactNode {
  const { view, back } = useView()
  const [addOpen, setAddOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [sidebarExpanded, setSidebarExpanded] = usePersistentState(
    'interleaf.sidebarExpanded',
    true,
    (raw) => (typeof raw === 'boolean' ? raw : null)
  )
  const confirming = usePendingConfirm() !== null

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      const mod = event.ctrlKey || event.metaKey

      if (mod && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setPaletteOpen((open) => !open)
        return
      }
      if (mod && event.key.toLowerCase() === 'n') {
        event.preventDefault()
        setAddOpen(true)
        return
      }
      // Radix owns Escape while a dialog is open, and without the confirm
      // check one press would dismiss the dialog and walk back a screen.
      if (event.key === 'Escape' && !addOpen && !paletteOpen && !confirming) back()
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [addOpen, paletteOpen, confirming, back])

  return (
    <div className="app-shell h-screen" data-sidebar-expanded={sidebarExpanded}>
      <Sidebar
        collapsed={!sidebarExpanded}
        onAdd={() => setAddOpen(true)}
        onPalette={() => setPaletteOpen(true)}
        onToggle={() => setSidebarExpanded(!sidebarExpanded)}
      />

      <main className="min-h-0 min-w-0 bg-canvas">
        {view.kind === 'library' && <Library onAdd={() => setAddOpen(true)} />}
        {view.kind === 'queue' && <ReadingQueue />}
        {view.kind === 'book' && <BookRoute id={view.id} />}
        {view.kind === 'reviews' && <Reviews />}
        {view.kind === 'review' && <ReviewView key={view.id} noteId={view.id} />}
        {view.kind === 'notes' && <Notes />}
        {view.kind === 'quotes' && <Quotes />}
        {view.kind === 'note' && <NoteView key={view.id} noteId={view.id} />}
        {view.kind === 'discover' && <Discover />}
        {view.kind === 'data' && <Data />}
        {view.kind === 'import' && <CalibreImport plan={view.plan} />}
      </main>

      <AddBookDialog open={addOpen} onOpenChange={setAddOpen} />
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        onAddBook={() => setAddOpen(true)}
      />
      <ConfirmDialog />
      <Toasts />
    </div>
  )
}

// Read from the library list rather than passed down, so there is no second
// source of truth to go stale.
function BookRoute({ id }: { id: number }): ReactNode {
  const book = useBook(id)
  if (!book) return <Empty title="That book is no longer in your library." />
  return <BookDetail key={id} book={book} />
}
