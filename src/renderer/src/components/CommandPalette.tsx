import * as Dialog from '@radix-ui/react-dialog'
import { HL_END, HL_START } from '@shared/api'
import { toPlainText } from '@shared/plaintext'
import { Command } from 'cmdk'
import { useState, type ReactNode } from 'react'

import { notify } from '../lib/feedback'
import { useExportBackup, useSearch } from '../lib/queries'
import { useView } from '../lib/view'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  onAddBook: () => void
}

const shortcutClass =
  'shrink-0 rounded-control border border-hairline-strong bg-surface px-1.5 py-0.5 text-[11px] text-ink-muted'

export default function CommandPalette({ open, onOpenChange, onAddBook }: Props): ReactNode {
  const { navigate } = useView()
  const [query, setQuery] = useState('')

  const exportBackup = useExportBackup()
  const { data: hits = [] } = useSearch(query)

  function run(action: () => void): void {
    onOpenChange(false)
    setQuery('')
    action()
  }

  const commands = [
    { id: 'add', label: 'Add a book', shortcut: 'Control+N', run: onAddBook },
    {
      id: 'note',
      label: 'New note',
      run: () => navigate({ kind: 'new-note' })
    },
    { id: 'library', label: 'Go to Library', run: () => navigate({ kind: 'library' }) },
    { id: 'queue', label: 'Go to Reading queue', run: () => navigate({ kind: 'queue' }) },
    { id: 'history', label: 'Go to Reading history', run: () => navigate({ kind: 'history' }) },
    { id: 'reviews', label: 'Go to Reviews', run: () => navigate({ kind: 'reviews' }) },
    { id: 'notes', label: 'Go to Notes', run: () => navigate({ kind: 'notes' }) },
    { id: 'quotes', label: 'Go to Quotes', run: () => navigate({ kind: 'quotes' }) },
    { id: 'discover', label: 'Go to Discover', run: () => navigate({ kind: 'discover' }) },
    { id: 'stats', label: 'Go to Stats', run: () => navigate({ kind: 'stats' }) },
    {
      // Restoring is not here: it replaces the library and restarts the app,
      // which is not something to reach by typing three letters.
      id: 'backup',
      label: 'Back up the library',
      run: () =>
        exportBackup.mutate(undefined, {
          onSuccess: (result) =>
            result && notify(`Backed up ${result.books} books to ${result.dir}`)
        })
    }
  ]

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-overlay backdrop-blur-[2px]" />
        <Dialog.Content className="fixed left-1/2 top-[12vh] z-50 w-[min(600px,calc(100vw-32px))] -translate-x-1/2 overflow-hidden rounded-card border border-hairline bg-surface shadow-pop">
          <Dialog.Title className="sr-only">Command palette</Dialog.Title>
          <Dialog.Description className="sr-only">
            Search your notes and books, or run a command.
          </Dialog.Description>

          <Command shouldFilter={false} loop>
            <Command.Input
              autoFocus
              value={query}
              onValueChange={setQuery}
              placeholder="Search notes and books, or run a command…"
              className="w-full border-b border-hairline px-4 py-3.5 text-[15px] outline-none placeholder:text-ink-faint"
            />

            <Command.List className="max-h-[52vh] overflow-y-auto p-2">
              <Command.Empty className="px-4 py-6 text-center text-[13px] text-ink-muted">
                No matches.
              </Command.Empty>

              <Command.Group>
                {commands
                  .filter((command) =>
                    command.label.toLowerCase().includes(query.trim().toLowerCase())
                  )
                  .map((command) => (
                    <Item
                      key={command.id}
                      shortcut={command.shortcut}
                      onSelect={() => run(command.run)}
                    >
                      <span className="flex-1">{command.label}</span>
                    </Item>
                  ))}
              </Command.Group>

              {hits.length > 0 && (
                <Command.Group>
                  {hits.map((hit) => (
                    <Item
                      key={`${hit.kind}-${hit.id}`}
                      kind={hit.kind}
                      onSelect={() =>
                        run(() =>
                          navigate(
                            hit.kind === 'book'
                              ? { kind: 'book', id: hit.id }
                              : { kind: 'note', id: hit.id }
                          )
                        )
                      }
                    >
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate">{toPlainText(hit.title) || 'Untitled'}</span>
                        {hit.snippet && (
                          <span className="truncate text-[12px] text-ink-muted">
                            {highlight(toPlainText(hit.snippet))}
                          </span>
                        )}
                      </span>
                      {hit.subtitle && (
                        <span className="shrink-0 truncate text-[11px] text-ink-faint">
                          {hit.subtitle}
                        </span>
                      )}
                    </Item>
                  ))}
                </Command.Group>
              )}
            </Command.List>
          </Command>
          <footer className="flex items-center justify-end gap-2 border-t border-hairline px-4 py-2 text-[11px] text-ink-muted">
            Open or close palette
            <kbd className={shortcutClass}>Ctrl+K</kbd>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function Item({
  kind,
  shortcut,
  onSelect,
  children
}: {
  kind?: 'book' | 'note'
  shortcut?: string
  onSelect: () => void
  children: ReactNode
}): ReactNode {
  return (
    <Command.Item
      onSelect={onSelect}
      aria-keyshortcuts={shortcut}
      className="flex cursor-pointer items-baseline gap-3 rounded-control px-3 py-2 data-[selected=true]:bg-accent-soft"
    >
      {kind && (
        <span className="w-10 shrink-0 text-[10px] uppercase tracking-wider text-ink-faint">
          {kind}
        </span>
      )}
      {children}
      {shortcut && (
        <kbd aria-hidden="true" className={shortcutClass}>
          {shortcut.replace('Control+', 'Ctrl+')}
        </kbd>
      )}
    </Command.Item>
  )
}

// FTS snippets mark hits with control characters rather than HTML, so no
// markup from a note body can be injected.
function highlight(snippet: string): ReactNode[] {
  const parts: ReactNode[] = []
  let rest = snippet
  let key = 0

  while (rest.length > 0) {
    const start = rest.indexOf(HL_START)
    if (start === -1) {
      parts.push(<span key={key++}>{rest}</span>)
      break
    }
    if (start > 0) parts.push(<span key={key++}>{rest.slice(0, start)}</span>)

    const end = rest.indexOf(HL_END, start)
    if (end === -1) {
      parts.push(<span key={key++}>{rest.slice(start + 1)}</span>)
      break
    }
    parts.push(
      <mark key={key++} className="bg-transparent font-semibold text-accent">
        {rest.slice(start + 1, end)}
      </mark>
    )
    rest = rest.slice(end + 1)
  }

  return parts
}
