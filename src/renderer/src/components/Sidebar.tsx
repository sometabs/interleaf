import { Fragment, type ReactNode } from 'react'

import { useBooks, useNotes } from '../lib/queries'
import { isQuote } from '../lib/quotes'
import { reviewEntries } from '../lib/reviews'
import { useView, type View } from '../lib/view'
import SettingsDialog from './SettingsDialog'

interface Props {
  onAbout: () => void
  onAdd: () => void
  onPalette: () => void
  collapsed?: boolean
  onToggle?: () => void
}

interface NavItem {
  label: string
  view: View
  icon: ReactNode
  count?: number
  /** Views that should also light this item up. */
  matches: View['kind'][]
  group: 'books' | 'journal' | 'explore'
}

const GROUP_LABELS: Record<NavItem['group'], string> = {
  books: 'Books',
  journal: 'Journal',
  explore: 'Explore'
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

export default function Sidebar({
  collapsed = false,
  onAbout,
  onAdd,
  onPalette,
  onToggle
}: Props): ReactNode {
  const { view, navigate } = useView()
  const { data: books } = useBooks()
  const { data: notes } = useNotes()

  const items: NavItem[] = [
    {
      label: 'Library',
      group: 'books',
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
      group: 'books',
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
      label: 'Reading history',
      group: 'books',
      view: { kind: 'history' },
      matches: ['history'],
      count: books?.filter((book) => book.status === 'read').length,
      icon: (
        <Icon>
          <path d="M3 11a9 9 0 1 1 2.6 7.4M3 5v6h6M12 7v5l3 2" />
        </Icon>
      )
    },
    {
      label: 'Reviews',
      group: 'journal',
      view: { kind: 'reviews' },
      matches: ['reviews', 'review'],
      count: books && notes ? reviewEntries(books, notes).length : undefined,
      icon: (
        <Icon>
          <path d="m12 4 2.3 4.8 5.2.7-3.8 3.7.9 5.3-4.6-2.5-4.6 2.5.9-5.3-3.8-3.7 5.2-.7z" />
        </Icon>
      )
    },
    {
      label: 'Notes',
      group: 'journal',
      view: { kind: 'notes' },
      matches: ['notes', 'note', 'new-note'],
      count: notes?.filter((note) => note.kind === 'thought').length,
      icon: (
        <Icon>
          <path d="M5 3h9l5 5v13H5zM14 3v5h5M8.5 13h7M8.5 17h4" />
        </Icon>
      )
    },
    {
      label: 'Quotes',
      group: 'journal',
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
      group: 'explore',
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
      label: 'Stats',
      group: 'explore',
      view: { kind: 'stats' },
      matches: ['stats'],
      icon: (
        <Icon>
          <path d="M5 20V10M12 20V4M19 20v-7" />
        </Icon>
      )
    }
  ]

  const dataActive = view.kind === 'data'
  const dataIcon = (
    <Icon>
      <ellipse cx="12" cy="6" rx="8" ry="3" />
      <path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" />
    </Icon>
  )

  return (
    <aside
      className={`flex min-h-0 flex-col border-r border-hairline bg-surface ${
        collapsed ? 'sidebar-collapsed' : ''
      }`}
    >
      <header
        className={`flex items-center ${
          collapsed ? 'justify-center px-2 pt-3 pb-1.5' : 'justify-between px-4 pt-4 pb-3'
        }`}
      >
        {collapsed ? (
          <button
            type="button"
            onClick={onToggle}
            title="Show sidebar"
            aria-label="Show sidebar"
            aria-expanded={false}
            className="btn btn-ghost rounded-control px-1.5 py-1.5 text-ink-faint hover:text-ink"
          >
            <Icon>
              <rect x="4" y="4" width="16" height="16" rx="1" />
              <path d="M9 4v16" />
            </Icon>
          </button>
        ) : (
          <>
            <span className="font-semibold tracking-tight">Interleaf</span>
            <div className="flex items-center gap-0.5">
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
              <button
                type="button"
                onClick={onToggle}
                title="Hide sidebar"
                aria-label="Hide sidebar"
                aria-expanded={true}
                className="btn btn-ghost rounded-control px-1.5 py-1.5 text-ink-faint hover:text-ink"
              >
                <Icon>
                  <rect x="4" y="4" width="16" height="16" rx="1" />
                  <path d="M9 4v16" />
                </Icon>
              </button>
            </div>
          </>
        )}
      </header>

      {collapsed && (
        <div className="flex justify-center px-2 pb-1">
          <button
            type="button"
            onClick={onPalette}
            title="Search and commands (Ctrl+K)"
            aria-label="Search and commands"
            className="sidebar-icon-button btn btn-ghost rounded-control px-1.5 py-1.5 text-ink-faint hover:text-ink"
          >
            <Icon>
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </Icon>
          </button>
        </div>
      )}

      {/* Scrolls only when the window is too short for the list; the footer stays put. */}
      <nav
        className={`sidebar-scroll flex min-h-0 flex-1 flex-col gap-0.5 overflow-x-hidden overflow-y-auto ${
          collapsed ? 'items-center px-2' : 'px-2'
        }`}
      >
        {items.map((item, index) => {
          const active = item.matches.includes(view.kind)
          const startsGroup = index === 0 || items[index - 1].group !== item.group
          return (
            <Fragment key={item.label}>
              {/* Collapsed to icons, a label would not fit: a short rule marks the break instead. */}
              {startsGroup &&
                (collapsed ? (
                  index > 0 && (
                    <span aria-hidden className="my-1 h-px w-5 shrink-0 bg-hairline-strong" />
                  )
                ) : (
                  <span
                    className={`shrink-0 px-2.5 pb-1 text-[11px] font-medium tracking-wider text-ink-faint uppercase ${
                      index > 0 ? 'pt-3' : 'pt-0.5'
                    }`}
                  >
                    {GROUP_LABELS[item.group]}
                  </span>
                ))}
              <button
                type="button"
                onClick={() => navigate(item.view)}
                aria-current={active ? 'page' : undefined}
                aria-label={collapsed ? item.label : undefined}
                title={collapsed ? item.label : undefined}
                className={`flex shrink-0 items-center gap-2.5 rounded-control py-2 text-left text-[14px] transition-colors ${
                  collapsed ? 'sidebar-icon-button size-9 justify-center px-0' : 'w-full px-2.5'
                } ${
                  active
                    ? 'sidebar-nav-active font-medium'
                    : 'text-ink-muted hover:bg-hover hover:text-ink'
                }`}
              >
                {item.icon}
                {!collapsed && <span className="flex-1">{item.label}</span>}
                {!collapsed && item.count !== undefined && (
                  <span className="text-xs tabular-nums text-ink-faint">{item.count}</span>
                )}
              </button>
            </Fragment>
          )
        })}
      </nav>

      <footer
        className={
          collapsed ? 'flex shrink-0 flex-col items-center gap-0.5 p-2' : 'shrink-0 space-y-2 p-3'
        }
      >
        {/* Visited rarely, like Settings, so it waits down here rather than among the daily views. */}
        <button
          type="button"
          onClick={() => navigate({ kind: 'data' })}
          aria-current={dataActive ? 'page' : undefined}
          aria-label="Data"
          title={collapsed ? 'Data' : undefined}
          className={`btn btn-ghost ${
            collapsed ? 'sidebar-icon-button size-9 px-0' : 'w-full justify-start'
          } ${dataActive ? 'sidebar-nav-active font-medium' : 'text-ink-muted'}`}
        >
          {dataIcon}
          {!collapsed && 'Data'}
        </button>
        <SettingsDialog collapsed={collapsed} />
        {collapsed ? (
          <>
            <button
              type="button"
              title="About & diagnostics"
              aria-label="About & diagnostics"
              onClick={onAbout}
              className="sidebar-icon-button btn btn-ghost size-9 px-0 text-ink-faint hover:text-ink"
            >
              <Icon>
                <circle cx="12" cy="12" r="9" />
                <path d="M12 11v6M12 7h.01" />
              </Icon>
            </button>
            <button
              type="button"
              title="Add book (Ctrl+N)"
              aria-label="Add book"
              onClick={onAdd}
              className="sidebar-icon-button btn btn-primary size-9 px-0"
            >
              <Icon>
                <path d="M12 5v14M5 12h14" />
              </Icon>
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className="btn btn-ghost w-full justify-start text-ink-muted"
              onClick={onAbout}
            >
              <Icon>
                <circle cx="12" cy="12" r="9" />
                <path d="M12 11v6M12 7h.01" />
              </Icon>
              About &amp; diagnostics
            </button>
            <button type="button" className="btn btn-primary w-full" onClick={onAdd}>
              Add book
            </button>
          </>
        )}
      </footer>
    </aside>
  )
}
