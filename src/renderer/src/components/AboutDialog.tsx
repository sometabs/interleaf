import * as Dialog from '@radix-ui/react-dialog'
import type { AppDiagnostics } from '@shared/api'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'

import { fail, notify } from '../lib/feedback'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
}

type Availability =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'offline' }
  | { kind: 'result'; available: boolean; checkedAt: number }

const STATUS_CACHE_MS = 5 * 60 * 1000

export default function AboutDialog({ open, onOpenChange }: Props): ReactNode {
  const [diagnostics, setDiagnostics] = useState<AppDiagnostics | null>(null)
  const [online, setOnline] = useState(() => navigator.onLine)
  const [availability, setAvailability] = useState<Availability>({ kind: 'idle' })
  const diagnosticsRequest = useRef<Promise<void> | null>(null)
  const checkInFlight = useRef(false)
  const cachedStatus = useRef<{ available: boolean; checkedAt: number } | null>(null)

  useEffect(() => {
    const update = (): void => setOnline(navigator.onLine)
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
    }
  }, [])

  useEffect(() => {
    if (!open || diagnosticsRequest.current) return

    const request = window.interleaf
      .getAppDiagnostics()
      .then(setDiagnostics)
      .catch(fail)
      .finally(() => {
        if (diagnosticsRequest.current === request) diagnosticsRequest.current = null
      })
    diagnosticsRequest.current = request
  }, [open])

  const checkOpenLibrary = useCallback(
    async (force = false): Promise<void> => {
      if (!online) {
        setAvailability({ kind: 'offline' })
        return
      }
      if (checkInFlight.current) return

      const cached = cachedStatus.current
      if (!force && cached && Date.now() - cached.checkedAt < STATUS_CACHE_MS) {
        setAvailability({ kind: 'result', ...cached })
        return
      }

      checkInFlight.current = true
      setAvailability({ kind: 'checking' })
      try {
        const result = {
          available: await window.interleaf.checkOpenLibrary(),
          checkedAt: Date.now()
        }
        cachedStatus.current = result
        setAvailability({ kind: 'result', ...result })
      } catch {
        const result = { available: false, checkedAt: Date.now() }
        cachedStatus.current = result
        setAvailability({ kind: 'result', ...result })
      } finally {
        checkInFlight.current = false
      }
    },
    [online]
  )

  useEffect(() => {
    if (!open) return
    const timer = window.setTimeout(() => void checkOpenLibrary(), 0)
    return () => window.clearTimeout(timer)
  }, [checkOpenLibrary, open])

  async function copyDiagnostics(): Promise<void> {
    if (!diagnostics) return

    const openLibrary =
      availability.kind === 'result'
        ? availability.available
          ? 'Available'
          : 'Unavailable'
        : availability.kind === 'checking'
          ? 'Checking'
          : availability.kind === 'offline'
            ? 'Not checked (offline)'
            : 'Not checked'
    const summary = [
      `Interleaf ${diagnostics.version}`,
      `Database schema: ${diagnostics.schemaVersion}`,
      `Advanced model: ${diagnostics.advancedModelInstalled ? 'Downloaded' : 'Not downloaded'}`,
      `Network: ${online ? 'Online' : 'Offline'}`,
      `Open Library: ${openLibrary}`
    ].join('\n')

    try {
      await navigator.clipboard.writeText(summary)
      notify('Diagnostics copied.')
    } catch (error) {
      fail(error)
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-ink/25 backdrop-blur-[2px]" />
        <Dialog.Content className="fixed left-1/2 top-[12vh] z-50 w-[min(520px,calc(100vw-32px))] -translate-x-1/2 overflow-hidden rounded-card border border-hairline bg-surface shadow-pop">
          <header className="flex items-start justify-between border-b border-hairline px-5 py-4">
            <div>
              <Dialog.Title className="text-[17px] font-semibold tracking-tight">
                About &amp; diagnostics
              </Dialog.Title>
              <Dialog.Description className="mt-0.5 text-[12px] text-ink-muted">
                App information and on-demand service status.
              </Dialog.Description>
            </div>
            <Dialog.Close
              className="btn btn-ghost -mr-1 rounded-control px-2 py-1 text-ink-faint"
              aria-label="Close"
            >
              ×
            </Dialog.Close>
          </header>

          <div className="space-y-5 p-5">
            <section aria-label="Application information" className="space-y-2.5">
              <h2 className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
                Application
              </h2>
              <div className="overflow-hidden rounded-control border border-hairline">
                <InfoRow label="Version">{diagnostics?.version ?? 'Loading…'}</InfoRow>
                <InfoRow label="Advanced model">
                  {diagnostics
                    ? diagnostics.advancedModelInstalled
                      ? 'Downloaded'
                      : 'Not downloaded'
                    : 'Loading…'}
                </InfoRow>
                <InfoRow label="Data location">
                  <span className="break-all text-right text-[11px]">
                    {diagnostics?.dataDirectory ?? 'Loading…'}
                  </span>
                </InfoRow>
              </div>
            </section>

            <section aria-label="Connectivity status" className="space-y-2.5">
              <div className="flex items-center justify-between">
                <h2 className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
                  Connectivity
                </h2>
                <button
                  type="button"
                  className="btn btn-ghost px-2 py-1 text-[12px]"
                  disabled={!online || availability.kind === 'checking'}
                  onClick={() => void checkOpenLibrary(true)}
                >
                  {availability.kind === 'checking' ? 'Checking…' : 'Check again'}
                </button>
              </div>
              <div className="overflow-hidden rounded-control border border-hairline">
                <InfoRow label="Network">
                  <Status available={online}>{online ? 'Online' : 'Offline'}</Status>
                </InfoRow>
                <InfoRow label="Open Library">
                  <OpenLibraryStatus status={availability} />
                </InfoRow>
              </div>
              {availability.kind === 'result' && (
                <p className="text-right text-[11px] text-ink-faint">
                  Checked at{' '}
                  {new Date(availability.checkedAt).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit'
                  })}
                </p>
              )}
            </section>

            <div className="flex justify-end">
              <button
                type="button"
                className="btn btn-secondary"
                disabled={!diagnostics}
                onClick={() => void copyDiagnostics()}
              >
                Copy diagnostics
              </button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function InfoRow({ label, children }: { label: string; children: ReactNode }): ReactNode {
  return (
    <div className="flex min-h-10 items-center justify-between gap-4 border-b border-hairline px-3 py-2 last:border-b-0">
      <span className="shrink-0 text-[13px] text-ink-muted">{label}</span>
      <span className="min-w-0 text-right text-[13px] font-medium">{children}</span>
    </div>
  )
}

function Status({ available, children }: { available: boolean; children: ReactNode }): ReactNode {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className={`size-2 rounded-full ${available ? 'bg-emerald-500' : 'bg-red-500'}`}
        aria-hidden="true"
      />
      {children}
    </span>
  )
}

function OpenLibraryStatus({ status }: { status: Availability }): ReactNode {
  if (status.kind === 'checking') return <span aria-live="polite">Checking…</span>
  if (status.kind === 'offline') return <Status available={false}>Not checked — offline</Status>
  if (status.kind === 'result') {
    return (
      <Status available={status.available}>{status.available ? 'Available' : 'Unavailable'}</Status>
    )
  }
  return <span>Not checked</span>
}
