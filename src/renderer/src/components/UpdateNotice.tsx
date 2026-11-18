import { useEffect, useState, type ReactNode } from 'react'

export default function UpdateNotice(): ReactNode {
  const [version, setVersion] = useState<string | null>(null)
  const [hidden, setHidden] = useState(false)
  const [restarting, setRestarting] = useState(false)

  useEffect(() => {
    let live = true
    // The download can finish before this mounts, so ask as well as listen.
    void window.interleaf.getReadyUpdate().then((ready) => {
      if (live && ready) setVersion(ready)
    })
    const stop = window.interleaf.onUpdateReady(setVersion)
    return () => {
      live = false
      stop()
    }
  }, [])

  if (!version || hidden) return null

  return (
    <section
      aria-label="Update ready"
      className="fixed bottom-6 right-6 z-50 w-[min(320px,calc(100vw-48px))] rounded-card border border-hairline bg-surface p-4 shadow-pop"
    >
      <p className="text-[14px] font-medium">Interleaf {version} is ready</p>
      <p className="mt-1 text-[13px] text-ink-muted">
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
