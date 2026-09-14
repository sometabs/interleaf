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
let nextRequestId = 1
const pending = new Map<number, PendingRequest>()

function rejectPending(error: Error): void {
  for (const request of pending.values()) request.reject(error)
  pending.clear()
}

function semanticWorker(): Worker {
  if (worker) return worker

  const created = createSemanticWorker({ name: 'interleaf-semantic' })
  worker = created

  created.on('message', (message: SemanticWorkerResponse) => {
    const request = pending.get(message.id)
    if (!request) return

    if (message.type === 'progress') {
      request.progress(message.progress)
      return
    }

    pending.delete(message.id)
    if (message.type === 'result') request.resolve(message.vectors)
    else request.reject(new Error(message.message))
  })

  created.on('error', (error) => {
    if (worker === created) worker = null
    rejectPending(error)
  })

  created.on('exit', (code) => {
    if (worker !== created) return
    worker = null
    if (pending.size > 0) rejectPending(new Error(`Advanced ranking worker stopped (${code}).`))
  })

  return created
}

export function embedInSemanticWorker(
  texts: string[],
  cacheDir: string,
  progress: (progress: SemanticProgress) => void
): Promise<number[][]> {
  const id = nextRequestId++

  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, progress })
    const request: SemanticWorkerRequest = { id, texts, cacheDir }
    try {
      semanticWorker().postMessage(request)
    } catch (error) {
      pending.delete(id)
      reject(error instanceof Error ? error : new Error(String(error)))
    }
  })
}
