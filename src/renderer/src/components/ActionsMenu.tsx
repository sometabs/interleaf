import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'

export interface MenuAction {
  label: string
  onSelect: () => void
  danger?: boolean
  disabled?: boolean
}

// For actions used rarely enough that they shouldn't sit on the page.
export default function ActionsMenu({
  label,
  actions
}: {
  label: string
  actions: MenuAction[]
}): ReactNode {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    root.current?.querySelector<HTMLButtonElement>('[role=menuitem]:not(:disabled)')?.focus()
    const onPointer = (event: PointerEvent): void => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    // Capture, so Escape closes the menu before the app's "go back" shortcut sees it.
    const onKey = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      setOpen(false)
      trigger.current?.focus()
    }
    document.addEventListener('pointerdown', onPointer)
    window.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [open])

  function move(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    const items = [
      ...(root.current?.querySelectorAll<HTMLButtonElement>('[role=menuitem]:not(:disabled)') ?? [])
    ]
    const at = items.indexOf(document.activeElement as HTMLButtonElement)
    const next = event.key === 'ArrowDown' ? at + 1 : at - 1
    items[(next + items.length) % items.length]?.focus()
  }

  return (
    <div ref={root} className="relative">
      <button
        ref={trigger}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        className="btn btn-ghost px-2.5 text-[16px] leading-none"
        onClick={() => setOpen((current) => !current)}
      >
        <span aria-hidden>⋯</span>
      </button>
      {open && (
        <div
          role="menu"
          aria-label={label}
          onKeyDown={move}
          className="absolute right-0 z-20 mt-1 min-w-52 rounded-card border border-hairline bg-surface p-1 shadow-pop"
        >
          {actions.map((action) => (
            <button
              key={action.label}
              type="button"
              role="menuitem"
              disabled={action.disabled}
              className={`block w-full rounded-control px-3 py-1.5 text-left text-[13px] hover:bg-hover focus:bg-hover focus:outline-none disabled:opacity-50 ${
                action.danger ? 'text-danger' : 'text-ink'
              }`}
              onClick={() => {
                setOpen(false)
                action.onSelect()
              }}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
