import type { ReactNode } from 'react'

import { dismiss, useMessages } from '../lib/feedback'

export default function Toasts(): ReactNode {
  const messages = useMessages()
  if (messages.length === 0) return null

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex flex-col items-center gap-2">
      {messages.map((message) => (
        <div
          key={message.id}
          role={message.kind === 'error' ? 'alert' : 'status'}
          className={`pointer-events-auto flex max-w-[min(640px,calc(100vw-48px))] items-center gap-3 rounded-card px-4 py-2.5 text-[13px] shadow-pop ${
            message.kind === 'error'
              ? 'border border-danger/30 bg-danger-soft text-danger'
              : 'border border-hairline bg-surface text-ink-muted'
          }`}
        >
          <span>{message.text}</span>
          <button
            type="button"
            onClick={() => dismiss(message.id)}
            aria-label="Dismiss"
            className="opacity-60 hover:opacity-100"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  )
}
