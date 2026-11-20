import type { ReactNode } from 'react'

import { useRestoreBackup } from '../lib/queries'

function Icon({ children }: { children: ReactNode }): ReactNode {
  return (
    <svg
      aria-hidden
      width="18"
      height="18"
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

// Shown only while the library is empty. A restore here needs no warning: there is nothing to replace.
export default function Welcome({ onAdd }: { onAdd: () => void }): ReactNode {
  const restore = useRestoreBackup()

  return (
    <div className="flex h-full items-center justify-center overflow-y-auto px-8 py-12">
      <div className="w-full max-w-md">
        <h1 className="text-[22px]">Welcome to Interleaf</h1>
        <p className="mt-1.5 text-[14px] leading-relaxed text-ink-muted">
          Your library, reading journal and EPUB reader, kept on this computer. Start by bringing in
          your first books.
        </p>

        <div className="mt-6 flex flex-col gap-2">
          <button
            type="button"
            className="flex items-center gap-3 rounded-card bg-action px-4 py-3 text-left text-white transition-colors hover:bg-action-hover"
            onClick={onAdd}
          >
            <Icon>
              <circle cx="10" cy="10" r="7" />
              <path d="m21 21-6-6" />
            </Icon>
            <span className="flex-1">
              <span className="block text-[14px] font-medium">Add a book</span>
              <span className="block text-[12px] opacity-80">Search by title, author or ISBN</span>
            </span>
          </button>

          <button
            type="button"
            className="flex items-center gap-3 rounded-card border border-hairline bg-surface px-4 py-3 text-left transition-colors hover:bg-hover disabled:opacity-60"
            disabled={restore.isPending}
            onClick={() => restore.mutate()}
          >
            <span className="text-ink-muted">
              <Icon>
                <path d="M3.06 13a9 9 0 1 0 .49-4.087" />
                <path d="M3 4.001v5h5" />
                <path d="M12 8v4l2 2" />
              </Icon>
            </span>
            <span className="flex-1">
              <span className="block text-[14px] font-medium text-ink">
                {restore.isPending ? 'Restoring…' : 'Restore a backup'}
              </span>
              <span className="block text-[12px] text-ink-faint">Moving from another computer</span>
            </span>
          </button>
        </div>

        <p className="mt-4 rounded-card border border-dashed border-hairline-strong px-4 py-3.5 text-center text-[13px] text-ink-faint">
          Or drop an EPUB anywhere on this window
        </p>
      </div>
    </div>
  )
}
