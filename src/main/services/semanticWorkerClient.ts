import type { Worker } from 'node:worker_threads'

import createSemanticWorker from './semanticWorker?nodeWorker'
import type { SemanticProgress } from '../../shared/api'
import type { SemanticWorkerRequest, SemanticWorkerResponse } from './semanticWorkerProtocol'

interface PendingRequest {
  resolve: (vectors: number[][]) => void
  reject: (error: Error) => void
  progress: (progress: SemanticProgress) => void
}

let worker: Worker | null = null
let stopping: Promise<void> | null = null
let nextRequestId = 1
const pending = new Map<number, PendingRequest>()

function rejectPending(error: Error): void {
  for (const request of pending.values()) request.reject(error)
  pending.clear()
}

function stopWhenDrained(): void {
  const current = worker
  if (pending.size > 0 || !current) return
  worker = null
  stopping = current
    .terminate()
    .then(() => undefined)
    .finally(() => {
      stopping = null
    })
  void stopping.catch((error) => console.warn('[semantic] could not stop worker:', error))
}

function semanticWorker(): Worker {
  if (worker) return worker

  const created = createSemanticWorker({ name: 'interleaf-semantic' })
  worker = created

  created.on('message', (message: SemanticWorkerResponse) => {
    if (worker !== created) return
    const request = pending.get(message.id)
    if (!request) return

    if (message.type === 'progress') {
      request.progress(message.progress)
      return
    }

    pending.delete(message.id)
    if (message.type === 'result') request.resolve(message.vectors)
    else request.reject(new Error(message.message))
    // The worker sends its result after finishing the embedding cache write.
    stopWhenDrained()
  })

  created.on('error', (error) => {
    if (worker !== created) return
    worker = null
    rejectPending(error)
  })

  created.on('exit', (code) => {
    if (worker !== created) return
    worker = null
    rejectPending(new Error(`Recommendation model worker stopped (${code}).`))
  })

  return created
}

export async function embedInSemanticWorker(
  texts: string[],
  cacheDir: string,
  progress: (progress: SemanticProgress) => void
): Promise<number[][]> {
  // Wait for the previous worker to release its files before starting a new one.
  while (stopping) await stopping
  const current = semanticWorker()
  const id = nextRequestId++

  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, progress })
    const request: SemanticWorkerRequest = { id, texts, cacheDir }
    try {
      current.postMessage(request)
    } catch (error) {
      pending.delete(id)
      reject(error instanceof Error ? error : new Error(String(error)))
      stopWhenDrained()
    }
  })
}
