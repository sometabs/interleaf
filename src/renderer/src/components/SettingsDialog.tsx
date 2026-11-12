import * as Dialog from '@radix-ui/react-dialog'
import { useState, type ReactNode } from 'react'

import { confirm } from '../lib/confirm'
import { useAppDiagnostics } from '../lib/queries'
import { useSettings } from '../lib/settings'

const ADVANCED_DESCRIPTION =
  'Combines keyword matching with AI to find books with similar themes. It runs on your device and uses more RAM while analyzing new books.'

export default function SettingsDialog({ collapsed }: { collapsed: boolean }): ReactNode {
  const [open, setOpen] = useState(false)
  const settings = useSettings()
  const { data: diagnostics, isError: diagnosticsError } = useAppDiagnostics(open)

  async function toggleAdvanced(): Promise<void> {
    if (settings.downloadAcknowledged) {
      settings.setAdvancedEnabled(!settings.advancedEnabled)
      return
    }
    const accepted = await confirm({
      title: 'Turn on advanced recommendations?',
      body: `${ADVANCED_DESCRIPTION} The first run may need an internet connection to download the 35 MB model from Hugging Face.`,
      confirmLabel: 'Turn on',
      cancelLabel: 'Not now'
    })
    if (accepted) settings.setAdvancedEnabled(true)
  }

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button
          type="button"
          aria-label="Settings"
          title={collapsed ? 'Settings' : undefined}
          className={`btn btn-ghost text-ink-muted ${
            collapsed ? 'sidebar-icon-button size-9 px-0' : 'w-full justify-start'
          }`}
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            className="size-4 shrink-0"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M4 6h16M4 12h16M4 18h16M8 3.5v5M15 9.5v5M10 15.5v5" />
          </svg>
          {!collapsed && 'Settings'}
        </button>
      </Dialog.Trigger>

      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-overlay backdrop-blur-[2px]" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed left-1/2 top-[10vh] z-50 max-h-[80vh] w-[min(520px,calc(100vw-32px))] -translate-x-1/2 overflow-y-auto rounded-card border border-hairline bg-surface shadow-pop"
          onEscapeKeyDown={(event) => event.stopPropagation()}
        >
          <header className="flex items-center justify-between border-b border-hairline px-5 py-3">
            <Dialog.Title className="text-[17px] font-semibold">Settings</Dialog.Title>
            <Dialog.Close asChild>
              <button type="button" className="btn btn-ghost">
                Close
              </button>
            </Dialog.Close>
          </header>

          <div className="divide-y divide-hairline px-5">
            <section aria-label="Appearance" className="space-y-3 py-4">
              <h2 className="eyebrow">Appearance</h2>
              <Choices
                label="Theme"
                options={['light', 'dark', 'system']}
                value={settings.theme}
                onChange={settings.setTheme}
              />
              <Switch
                label="Motion"
                checked={settings.motionEnabled}
                onToggle={() => settings.setMotionEnabled(!settings.motionEnabled)}
              />
            </section>

            <section aria-label="Discover" className="space-y-3 py-4">
              <h2 className="eyebrow">Discover</h2>
              <Choices
                label="Discover layout"
                options={['grid', 'tree']}
                value={settings.discoverLayout}
                onChange={settings.setDiscoverLayout}
              />
              <div>
                <Switch
                  label="Advanced recommendations"
                  checked={settings.advancedEnabled}
                  onToggle={() => void toggleAdvanced()}
                />
                <p className="mt-1 text-[13px] leading-relaxed text-ink-muted">
                  {ADVANCED_DESCRIPTION}
                </p>
              </div>
              <div>
                <p className="text-[13px]">Recommendation model</p>
                <p className="text-xs text-ink-muted">
                  {diagnostics
                    ? diagnostics.advancedModelInstalled
                      ? 'Downloaded'
                      : 'Download on first use'
                    : diagnosticsError
                      ? 'Status unavailable'
                      : 'Checking…'}
                </p>
              </div>
            </section>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function Choices<T extends string>({
  label,
  options,
  value,
  onChange
}: {
  label: string
  options: T[]
  value: T
  onChange: (value: T) => void
}): ReactNode {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="text-[14px]">{label}</span>
      <div role="group" aria-label={label} className="inline-flex rounded-control bg-sunken p-0.5">
        {options.map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={value === option}
            onClick={() => onChange(option)}
            className={`rounded-control px-2.5 py-1 text-[12px] capitalize ${
              value === option
                ? 'bg-surface font-medium text-ink shadow-card'
                : 'text-ink-muted hover:text-ink'
            }`}
          >
            {option[0].toUpperCase() + option.slice(1)}
          </button>
        ))}
      </div>
    </div>
  )
}

function Switch({
  label,
  checked,
  onToggle
}: {
  label: string
  checked: boolean
  onToggle: () => void
}): ReactNode {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onToggle}
      className="flex w-full items-center justify-between gap-3 rounded-control text-left text-[14px]"
    >
      {label}
      <span
        aria-hidden="true"
        className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${checked ? 'bg-action' : 'bg-hairline-strong'}`}
      >
        <span
          className={`absolute top-0.5 left-0.5 size-4 rounded-full bg-white shadow-card transition-transform ${checked ? 'translate-x-4' : ''}`}
        />
      </span>
    </button>
  )
}
