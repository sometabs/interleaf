import { useEffect, useState, type ReactNode } from 'react'

import type { ReadyUpdate, ReleaseNoteLine } from '../../../shared/api'

const MAX_LINES = 6
const RELEASES = 'https://github.com/sometabs/interleaf/releases/tag/v'

function shortened(notes: ReleaseNoteLine[]): ReleaseNoteLine[] {
  const shown = notes.slice(0, MAX_LINES)
  // A heading cut off from everything under it says nothing.
  while (shown.length < notes.length && shown.at(-1)?.heading) shown.pop()
  return shown
}

function Notes({ lines }: { lines: ReleaseNoteLine[] }): ReactNode {
  const groups: { heading: string | null; items: string[] }[] = []
  for (const line of lines) {
    if (line.heading || groups.length === 0) {
      groups.push({ heading: line.heading ? line.text : null, items: [] })
    }
    if (!line.heading) groups[groups.length - 1].items.push(line.text)
  }

  return (
    <div className="mt-3 space-y-2">
      {groups.map((group, index) => (
        <div key={index}>
          {group.heading && (
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
              {group.heading}
            </h3>
          )}
          {group.items.length > 0 && (
            <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[13px]">
              {group.items.map((item, itemIndex) => (
                <li key={itemIndex}>{item}</li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  )
}

export default function UpdateNotice(): ReactNode {
  const [update, setUpdate] = useState<ReadyUpdate | null>(null)
  const [hidden, setHidden] = useState(false)
  const [restarting, setRestarting] = useState(false)

  useEffect(() => {
    let live = true
    // The download can finish before this mounts, so ask as well as listen.
    void window.interleaf.getReadyUpdate().then((ready) => {
      if (live && ready) setUpdate(ready)
    })
    const stop = window.interleaf.onUpdateReady(setUpdate)
    return () => {
      live = false
      stop()
    }
  }, [])

  if (!update || hidden) return null

  const shown = shortened(update.notes)

  return (
    <section
      aria-label="Update ready"
      className="fixed bottom-6 right-6 z-50 w-[min(320px,calc(100vw-48px))] rounded-card border border-hairline bg-surface p-4 shadow-pop"
    >
      <p className="text-[14px] font-medium">Interleaf {update.version} is ready</p>
      {shown.length > 0 && <Notes lines={shown} />}
      {shown.length < update.notes.length && (
        <a
          href={`${RELEASES}${update.version}`}
          target="_blank"
          rel="noreferrer"
          className="mt-1 inline-block text-[13px] text-accent hover:underline"
        >
          See all changes
        </a>
      )}
      <p className={`${shown.length > 0 ? 'mt-3' : 'mt-1'} text-[13px] text-ink-muted`}>
        Restart now, or it installs when you close Interleaf.
      </p>
      <div className="mt-3 flex justify-end gap-2">
        <button type="button" className="btn btn-ghost" onClick={() => setHidden(true)}>
          Later
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={restarting}
          onClick={() => {
            setRestarting(true)
            void window.interleaf.restartToUpdate()
          }}
        >
          Restart now
        </button>
      </div>
    </section>
  )
}
