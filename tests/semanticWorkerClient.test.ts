import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  embedInSemanticWorker,
  stopSemanticWorker
} from '../src/main/services/semanticWorkerClient'
import type { SemanticWorkerRequest } from '../src/main/services/semanticWorkerProtocol'

const createWorker = vi.hoisted(() => vi.fn())
vi.mock('../src/main/services/semanticWorker?nodeWorker', () => ({ default: createWorker }))

class FakeWorker extends EventEmitter {
  postMessage = vi.fn<(request: SemanticWorkerRequest) => void>()
  terminate = vi.fn(async () => 0)

  complete(index: number): void {
    const id = this.postMessage.mock.calls[index][0].id
    this.emit('message', { id, type: 'result', vectors: [[1]] })
  }
}

const embed = (): Promise<number[][]> => embedInSemanticWorker(['book'], 'cache', () => {})

describe('the recommendation worker lifecycle', () => {
  const workers: FakeWorker[] = []

  beforeEach(() => {
    workers.length = 0
    createWorker.mockImplementation(() => {
      const worker = new FakeWorker()
      workers.push(worker)
      return worker
    })
  })

  afterEach(async () => {
    await stopSemanticWorker(() => {})
  })

  it('stops immediately after the last queued job finishes', async () => {
    const first = embed()
    const second = embed()
    const [worker] = workers

    worker.complete(0)
    await expect(first).resolves.toEqual([[1]])
    expect(worker.terminate).not.toHaveBeenCalled()

    worker.complete(1)
    expect(worker.terminate).toHaveBeenCalledOnce()
    await expect(second).resolves.toEqual([[1]])
  })

  it('starts a new worker after the previous one has stopped', async () => {
    const first = embed()
    const [worker] = workers
    const stopped = Promise.withResolvers<number>()
    worker.terminate.mockReturnValueOnce(stopped.promise)
    worker.complete(0)
    await first

    const next = embed()
    expect(workers).toHaveLength(1)
    stopped.resolve(0)
    await vi.waitFor(() => expect(workers).toHaveLength(2))

    workers[1].complete(0)
    await expect(next).resolves.toEqual([[1]])
  })

  it('waits for model removal when a new request arrives during termination', async () => {
    const first = embed()
    const [worker] = workers
    const stopped = Promise.withResolvers<number>()
    worker.terminate.mockReturnValueOnce(stopped.promise)
    worker.complete(0)
    await first

    const next = embed()
    const removeModel = vi.fn(() => expect(workers).toHaveLength(1))
    const removal = stopSemanticWorker(removeModel)
    expect(removeModel).not.toHaveBeenCalled()
    expect(workers).toHaveLength(1)
    stopped.resolve(0)
    await removal

    expect(removeModel).toHaveBeenCalledOnce()
    await vi.waitFor(() => expect(workers).toHaveLength(2))
    workers[1].complete(0)
    await expect(next).resolves.toEqual([[1]])
  })
})
