import * as AlertDialog from '@radix-ui/react-alert-dialog'
import type { ReactNode } from 'react'

import { answer, usePendingConfirm } from '../lib/confirm'

// An alert dialog, not a plain one: it starts on Cancel and ignores a stray
// Enter, so the safe answer is the easy one.
export default function ConfirmDialog(): ReactNode {
  const request = usePendingConfirm()
  if (!request) return null

  const { id, title, body, confirmLabel = 'Confirm', cancelLabel = 'Cancel', destructive } = request

  return (
    <AlertDialog.Root
      open
      // Radix reports Escape and the like here; there is no other way to close.
      onOpenChange={(open) => {
        if (!open) answer(id, false)
      }}
    >
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-40 bg-ink/25 backdrop-blur-[2px]" />
        <AlertDialog.Content className="fixed left-1/2 top-[22vh] z-50 w-[min(420px,calc(100vw-32px))] -translate-x-1/2 rounded-card border border-hairline bg-surface p-5 shadow-pop">
          <AlertDialog.Title className="text-[15px] font-semibold">{title}</AlertDialog.Title>

          {body ? (
            <AlertDialog.Description className="mt-1.5 text-[13px] leading-relaxed text-ink-muted">
              {body}
            </AlertDialog.Description>
          ) : (
            // Radix warns without one, and a heading with no body reads to a
            // screen reader as though something were missing.
            <AlertDialog.Description className="sr-only">
              Choose {confirmLabel} or {cancelLabel}.
            </AlertDialog.Description>
          )}

          <div className="mt-5 flex justify-end gap-2">
            <AlertDialog.Cancel asChild>
              <button type="button" className="btn btn-outline">
                {cancelLabel}
              </button>
            </AlertDialog.Cancel>
            <AlertDialog.Action asChild>
              <button
                type="button"
                className={destructive ? 'btn btn-destructive' : 'btn btn-primary'}
                onClick={() => answer(id, true)}
              >
                {confirmLabel}
              </button>
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  )
}
