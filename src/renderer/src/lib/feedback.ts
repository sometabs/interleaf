import { useSyncExternalStore } from 'react'

export interface Message {
  id: number
  text: string
  kind: 'error' | 'info'
}

// Outside React so the query client can report a failed mutation without a
// hook, and components need no try/catch.
let messages: Message[] = []
const listeners = new Set<() => void>()
let nextId = 1

function emit(): void {
  for (const listener of listeners) listener()
}

function push(text: string, kind: Message['kind']): void {
  const id = nextId++
  messages = [...messages, { id, text, kind }]
  emit()
  // Errors stay until dismissed; a confirmation should not linger.
  if (kind === 'info') setTimeout(() => dismiss(id), 3200)
}

export function notify(text: string): void {
  push(text, 'info')
}

export function fail(error: unknown): void {
  push(readMessage(error), 'error')
}

export function dismiss(id: number): void {
  messages = messages.filter((m) => m.id !== id)
  emit()
}

export function useMessages(): Message[] {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => messages,
    () => messages
  )
}

/** Electron prefixes IPC failures with the handler path; strip it for humans. */
function readMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  return raw.replace(/^Error invoking remote method '[^']+':\s*/, '').replace(/^Error:\s*/, '')
}

/** Test seam: clears state between cases. */
export function resetMessages(): void {
  messages = []
  emit()
}
