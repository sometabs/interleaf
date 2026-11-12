import * as Dialog from '@radix-ui/react-dialog'
import { Command } from 'cmdk'
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode
} from 'react'

interface Option {
  value: string
  label: string
  detail?: string | null
}

interface Props {
  label: string
  options: Option[]
  value?: string
  onChange: (value: string) => void
  searchLabel?: string
  active?: boolean
  align?: 'start' | 'end'
}

const rowClass =
  'flex w-full cursor-pointer items-center gap-3 rounded-control px-2.5 py-2 text-left text-[13px] text-ink-muted hover:bg-hover hover:text-ink data-[selected=true]:bg-hover data-[selected=true]:text-ink data-[current=true]:text-accent'

export default function FilterPicker({
  label,
  options,
  value,
  onChange,
  searchLabel,
  active = false,
  align = 'start'
}: Props): ReactNode {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<CSSProperties>({})
  const trigger = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const search = useRef<HTMLInputElement>(null)
  const selected = options.find((option) => option.value === value)
  const display = value === undefined ? label : (selected?.label ?? options[0]?.label ?? label)

  const positionPanel = useCallback((): void => {
    const rect = trigger.current?.getBoundingClientRect()
    if (!rect) return
    if (rect.bottom < 0 || rect.top > innerHeight) {
      setOpen(false)
      return
    }
    const margin = 8
    const gap = 6
    const width = Math.min(Math.max(rect.width, searchLabel ? 304 : 176), innerWidth - margin * 2)
    const left = align === 'end' ? rect.right - width : rect.left
    const above = rect.top - gap - margin
    const below = innerHeight - rect.bottom - gap - margin
    const opensBelow = below >= 300 || below >= above
    setPosition({
      width,
      left: Math.max(margin, Math.min(left, innerWidth - width - margin)),
      ...(opensBelow ? { top: rect.bottom + gap } : { bottom: innerHeight - rect.top + gap }),
      maxHeight: Math.min(300, opensBelow ? below : above)
    })
  }, [align, searchLabel])

  useEffect(() => {
    if (!open) return
    function followTrigger(event: Event): void {
      if (!(event.target instanceof Node) || !panel.current?.contains(event.target)) {
        positionPanel()
      }
    }
    window.addEventListener('resize', positionPanel)
    window.addEventListener('scroll', followTrigger, true)
    return () => {
      window.removeEventListener('resize', positionPanel)
      window.removeEventListener('scroll', followTrigger, true)
    }
  }, [open, positionPanel])

  function choose(next: string): void {
    onChange(next)
    setOpen(false)
  }

  return (
    <Dialog.Root
      modal={false}
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) positionPanel()
      }}
    >
      <Dialog.Trigger asChild>
        <button
          ref={trigger}
          type="button"
          aria-label={value === undefined ? label : `${label}, ${display}`}
          className={`btn btn-outline min-w-0 max-w-56 justify-between gap-2 px-2.5 py-1.5 text-[13px] ${
            active ? 'border-accent/40 bg-accent-soft text-accent' : 'text-ink-muted'
          }`}
        >
          <span className="truncate">{display}</span>
          <svg aria-hidden="true" viewBox="0 0 16 16" className="size-3.5 shrink-0" fill="none">
            <path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Content
          ref={panel}
          aria-describedby={undefined}
          style={position}
          className="fixed z-50 flex flex-col overflow-hidden rounded-card border border-hairline-strong bg-surface shadow-pop"
          onOpenAutoFocus={(event) => {
            const target =
              search.current ??
              panel.current?.querySelector<HTMLButtonElement>('button[aria-pressed="true"]') ??
              panel.current?.querySelector('button')
            if (target) {
              event.preventDefault()
              target.focus()
            }
          }}
          onEscapeKeyDown={(event) => event.stopPropagation()}
        >
          <Dialog.Title className="sr-only">{label}</Dialog.Title>
          {searchLabel ? (
            <Command
              label={searchLabel}
              defaultValue={selected && `filter:${selected.value}`}
              filter={matchOption}
              loop
              className="flex min-h-0 flex-col"
            >
              <Command.Input
                ref={search}
                placeholder={`${searchLabel}…`}
                className="w-full shrink-0 border-b border-hairline px-3 py-2.5 text-[13px] outline-none placeholder:text-ink-faint"
              />
              <Command.List className="min-h-0 overflow-y-auto overscroll-contain p-1">
                <Command.Empty className="px-2.5 py-3 text-[13px] text-ink-muted">
                  No matches.
                </Command.Empty>
                {options.map((option) => (
                  <Command.Item
                    key={option.value}
                    aria-label={option.detail ? `${option.label}, ${option.detail}` : option.label}
                    value={`filter:${option.value}`}
                    keywords={[option.label, option.detail ?? '']}
                    onSelect={() => choose(option.value)}
                    data-current={option.value === value}
                    className={rowClass}
                  >
                    <OptionContent option={option} current={option.value === value} />
                  </Command.Item>
                ))}
              </Command.List>
            </Command>
          ) : (
            <div className="overflow-y-auto overscroll-contain p-1" onKeyDown={moveFocus}>
              {options.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={option.value === value}
                  data-current={option.value === value}
                  className={rowClass}
                  onClick={() => choose(option.value)}
                >
                  <OptionContent option={option} current={option.value === value} />
                </button>
              ))}
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function OptionContent({ option, current }: { option: Option; current: boolean }): ReactNode {
  return (
    <>
      <span className="min-w-0 flex-1 wrap-anywhere">
        <span className="block">{option.label}</span>
        {option.detail && <span className="block text-[11px] text-ink-faint">{option.detail}</span>}
      </span>
      <svg
        aria-hidden="true"
        viewBox="0 0 16 16"
        className={`size-4 shrink-0 text-accent ${current ? '' : 'invisible'}`}
        fill="none"
      >
        <path d="m3.5 8 3 3 6-6" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    </>
  )
}

function matchOption(_value: string, query: string, keywords?: string[]): number {
  const text = keywords?.join(' ').toLowerCase() ?? ''
  return query
    .toLowerCase()
    .trim()
    .split(/\s+/)
    .every((term) => text.includes(term))
    ? 1
    : 0
}

function moveFocus(event: KeyboardEvent<HTMLDivElement>): void {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
  const buttons = [...event.currentTarget.querySelectorAll('button')]
  if (buttons.length === 0) return
  event.preventDefault()
  const index = buttons.findIndex((button) => button === event.target)
  if (event.key === 'Home') buttons[0].focus()
  else if (event.key === 'End') buttons.at(-1)?.focus()
  else {
    const direction = event.key === 'ArrowDown' ? 1 : -1
    buttons[(index + direction + buttons.length) % buttons.length].focus()
  }
}
