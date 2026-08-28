import { useSyncExternalStore } from 'react'

export interface ConfirmRequest {
  /** The question, as a statement of what is about to happen. */
  title: string
  /** What it costs. Skip it when the title already says everything. */
  body?: string
  // Names the action rather than agreeing: "Delete", not "OK".
  confirmLabel?: string
  cancelLabel?: string
  /** Paints the confirm button red. Cancel keeps the focus either way. */
  destructive?: boolean
}

interface Pending extends ConfirmRequest {
  id: number
  settle: (answer: boolean) => void
}

// Outside React so a call site can await it without threading dialog state
// through every component. The native box blocks the renderer thread.
let pending: Pending | null = null
const listeners = new Set<() => void>()
let nextId = 1

function emit(): void {
  for (const listener of listeners) listener()
}

export function confirm(request: ConfirmRequest): Promise<boolean> {
  // One question at a time: an abandoned promise would hang its caller forever.
  pending?.settle(false)

  return new Promise<boolean>((resolve) => {
    pending = { ...request, id: nextId++, settle: resolve }
    emit()
  })
}

/** The dialog's only way to reply. Answering twice is a no-op. */
export function answer(id: number, value: boolean): void {
  if (pending?.id !== id) return
  const { settle } = pending
  pending = null
  emit()
  settle(value)
}

export function usePendingConfirm(): Pending | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => pending,
    () => pending
  )
}

/** Test seam: cancels anything left open between cases. */
export function resetConfirm(): void {
  pending?.settle(false)
  pending = null
  emit()
}
