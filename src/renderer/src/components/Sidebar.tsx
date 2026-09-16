import type { ReactNode } from 'react'

import { useBooks, useNotes } from '../lib/queries'
import { isQuote } from '../lib/quotes'
import { useView, type View } from '../lib/view'

interface Props {
  onAdd: () => void
  onPalette: () => void
}

interface NavItem {
  label: string
  view: View
  icon: ReactNode
  count?: number
  /** Views that should also light this item up. */
  matches: View['kind'][]
}

function Icon({ children }: { children: ReactNode }): ReactNode {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0"
    >
      {children}
    </svg>
  )
}

export default function Sidebar({ onAdd, onPalette }: Props): ReactNode {
  const { view, navigate } = useView()
  const { data: books } = useBooks()
  const { data: notes } = useNotes()

  const items: NavItem[] = [
    {
      label: 'Library',
      view: { kind: 'library' },
      matches: ['library', 'book'],
      count: books?.length,
      icon: (
        <Icon>
          <path d="M4 4h6v16H4zM14 4h6v16h-6z" />
        </Icon>
      )
    },
    {
      label: 'Reading queue',
      view: { kind: 'queue' },
      matches: ['queue'],
      count: books?.filter((book) => book.status === 'want').length,
      icon: (
        <Icon>
          <path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" />
        </Icon>
      )
    },
    {
      label: 'Reviews',
      view: { kind: 'reviews' },
      matches: ['reviews', 'review'],
      count: notes?.filter((note) => note.kind === 'review').length,
      icon: (
        <Icon>
          <path d="m12 4 2.3 4.8 5.2.7-3.8 3.7.9 5.3-4.6-2.5-4.6 2.5.9-5.3-3.8-3.7 5.2-.7z" />
        </Icon>
      )
    },
    {
      label: 'Notes',
      view: { kind: 'notes' },
      matches: ['notes', 'note'],
      count: notes?.filter((note) => note.kind === 'thought').length,
      icon: (
        <Icon>
          <path d="M5 3h9l5 5v13H5zM14 3v5h5M8.5 13h7M8.5 17h4" />
        </Icon>
      )
    },
    {
      label: 'Quotes',
      view: { kind: 'quotes' },
      matches: ['quotes'],
      count: notes?.filter(isQuote).length,
      // Quotation marks drawn rather than typed, so they sit on the same 24px
      // grid and stroke width as the other icons.
      icon: (
        <Icon>
          <path d="M9 7c-2.2 0-4 1.8-4 4s1.8 4 4 4c0 2-1.5 3.5-3 4M19 7c-2.2 0-4 1.8-4 4s1.8 4 4 4c0 2-1.5 3.5-3 4" />
        </Icon>
      )
    },
    {
      label: 'Discover',
      view: { kind: 'discover' },
      matches: ['discover'],
      icon: (
        <Icon>
          <circle cx="12" cy="12" r="9" />
          <path d="m15 9-2 5-5 2 2-5z" />
        </Icon>
      )
    },
    {
      label: 'Data',
      view: { kind: 'data' },
      matches: ['data'],
      icon: (
        <Icon>
          <ellipse cx="12" cy="6" rx="8" ry="3" />
          <path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" />
        </Icon>
      )
    }
  ]

  return (
    <aside className="flex min-h-0 flex-col border-r border-hairline bg-surface">
      <header className="flex items-center justify-between px-4 pt-4 pb-3">
        <span className="font-semibold tracking-tight">Interleaf</span>
        <button
          type="button"
          onClick={onPalette}
          title="Search and commands (Ctrl+K)"
          aria-label="Search and commands"
          className="btn btn-ghost rounded-control px-1.5 py-1.5 text-ink-faint hover:text-ink"
        >
          <Icon>
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </Icon>
        </button>
      </header>

      <nav className="flex flex-col gap-0.5 px-2">
        {items.map((item) => {
          const active = item.matches.includes(view.kind)
          return (
            <button
              key={item.label}
              type="button"
              onClick={() => navigate(item.view)}
              aria-current={active ? 'page' : undefined}
              className={`flex w-full items-center gap-2.5 rounded-control px-2.5 py-2 text-left text-[14px] transition-colors ${
                active
                  ? 'bg-accent-soft font-medium text-accent'
                  : 'text-ink-muted hover:bg-hover hover:text-ink'
              }`}
            >
              {item.icon}
              <span className="flex-1">{item.label}</span>
              {item.count !== undefined && (
                <span className="text-xs tabular-nums text-ink-faint">{item.count}</span>
              )}
            </button>
          )
        })}
      </nav>

      <div className="flex-1" />

      <footer className="p-3">
        <button type="button" className="btn btn-primary w-full" onClick={onAdd}>
          Add book
        </button>
      </footer>
    </aside>
  )
}
