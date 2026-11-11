import * as Dialog from '@radix-ui/react-dialog'
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'

import { usePersistentState } from '../lib/persistent'

type Theme = 'light' | 'dark' | 'system'

const THEMES: { value: Theme; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' }
]

export default function Appearance({ collapsed = false }: { collapsed?: boolean }): ReactNode {
  const [theme, setTheme] = usePersistentState<Theme>('interleaf.theme', 'light', (raw) =>
    raw === 'light' || raw === 'dark' || raw === 'system' ? raw : null
  )
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState({ left: 0, bottom: 0 })
  const trigger = useRef<HTMLButtonElement>(null)
  const selected = useRef<HTMLButtonElement>(null)

  function positionPopover(): void {
    const rect = trigger.current?.getBoundingClientRect()
    if (rect) setPosition({ left: rect.left, bottom: window.innerHeight - rect.top + 8 })
  }

  function changeOpen(next: boolean): void {
    if (next) positionPopover()
    setOpen(next)
  }

  useEffect(() => {
    if (!open) return
    window.addEventListener('resize', positionPopover)
    return () => window.removeEventListener('resize', positionPopover)
  }, [open])

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  return (
    <Dialog.Root open={open} onOpenChange={changeOpen} modal={false}>
      <Dialog.Trigger asChild>
        <button
          ref={trigger}
          type="button"
          aria-label="Appearance"
          title={`Appearance: ${theme}`}
          className={`btn btn-ghost text-ink-muted ${
            collapsed ? 'sidebar-icon-button size-9 px-0' : 'w-full justify-start'
          }`}
        >
          <ThemeIcon theme={theme} />
          {!collapsed && (
            <>
              <span className="flex-1 text-left">Appearance</span>
              <span className="text-[11px] text-ink-faint">
                {THEMES.find((option) => option.value === theme)?.label}
              </span>
            </>
          )}
        </button>
      </Dialog.Trigger>

      <Dialog.Portal>
        <Dialog.Content
          aria-describedby={undefined}
          style={position}
          className="fixed z-50 w-60 rounded-card border border-hairline-strong bg-surface p-2 shadow-pop"
          onOpenAutoFocus={(event) => {
            event.preventDefault()
            selected.current?.focus()
          }}
          onEscapeKeyDown={(event) => event.stopPropagation()}
        >
          <Dialog.Title className="eyebrow px-2 pt-1 pb-2">Appearance</Dialog.Title>
          <div className="grid grid-cols-3 gap-1">
            {THEMES.map((option) => {
              const active = theme === option.value
              return (
                <Dialog.Close key={option.value} asChild>
                  <button
                    ref={active ? selected : undefined}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setTheme(option.value)}
                    className={`relative flex flex-col items-center gap-2 rounded-control border px-2 py-3 text-[12px] ${
                      active
                        ? 'border-accent/40 bg-accent-soft text-accent'
                        : 'border-transparent text-ink-muted hover:bg-hover hover:text-ink'
                    }`}
                  >
                    <ThemeIcon theme={option.value} size={20} />
                    {option.label}
                    {active && (
                      <svg
                        aria-hidden="true"
                        viewBox="0 0 12 12"
                        className="absolute top-1 right-1 size-3"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                      >
                        <path d="m2.5 6 2.2 2.2 4.8-4.8" />
                      </svg>
                    )}
                  </button>
                </Dialog.Close>
              )
            })}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function ThemeIcon({ theme, size = 16 }: { theme: Theme; size?: number }): ReactNode {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      className="shrink-0"
    >
      {theme === 'light' ? (
        <>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M5 19l1.5-1.5M17.5 6.5 19 5" />
        </>
      ) : theme === 'dark' ? (
        <path d="M20.5 14A9 9 0 0 1 10 3.5 9 9 0 1 0 20.5 14Z" />
      ) : (
        <>
          <rect x="3" y="4" width="18" height="13" rx="2" />
          <path d="M8 21h8M12 17v4" />
        </>
      )}
    </svg>
  )
}
