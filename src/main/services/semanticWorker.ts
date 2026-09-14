import { availableParallelism } from 'node:os'
import { parentPort } from 'node:worker_threads'

import type { SemanticProgress } from '../../shared/api'
import { embeddingFingerprint, loadEmbeddingCache, saveEmbeddingCache } from './semanticCache'
import {
  SEMANTIC_EMBEDDING_MODEL,
  SEMANTIC_MODEL_ID,
  type SemanticWorkerRequest,
  type SemanticWorkerResponse
} from './semanticWorkerProtocol'

const BATCH_SIZE = 8

interface TensorLike {
  tolist(): unknown[]
}

type Extractor = (
  texts: string[],
  options: { pooling: 'cls'; normalize: true }
) => Promise<TensorLike>

interface PipelineProgress {
  status?: string
  file?: string
  loaded?: number
  total?: number
}

const port = parentPort
if (!port) throw new Error('Advanced ranking worker requires a parent process.')

let extractorPromise: Promise<Extractor> | null = null
let embeddingCacheState: {
  cacheDir: string
  embeddings: Promise<Map<string, number[]>>
} | null = null

function embeddingsFor(cacheDir: string): Promise<Map<string, number[]>> {
  if (embeddingCacheState?.cacheDir !== cacheDir) {
    embeddingCacheState = {
      cacheDir,
      embeddings: loadEmbeddingCache(cacheDir, SEMANTIC_EMBEDDING_MODEL)
    }
  }
  return embeddingCacheState.embeddings
}

function send(message: SemanticWorkerResponse): void {
  port!.postMessage(message)
}

function report(id: number, progress: SemanticProgress): void {
  send({ id, type: 'progress', progress })
}

function modelFileName(file: string | undefined): string {
  if (!file) return 'model files'
  return file.split(/[\\/]/).pop() || 'model files'
}

async function loadExtractor(
  cacheDir: string,
  progress: (progress: SemanticProgress) => void
): Promise<Extractor> {
  if (extractorPromise) return extractorPromise

  extractorPromise = (async () => {
    progress({ phase: 'model', done: 0, total: 1, label: 'Loading BGE Small…' })

    const moduleName = '@huggingface/transformers'
    const transformers = (await import(moduleName)) as {
      pipeline(
        task: 'feature-extraction',
        model: string,
        options: {
          dtype: 'q8'
          cache_dir: string
          session_options: { intraOpNumThreads: number; interOpNumThreads: number }
          progress_callback: (event: PipelineProgress) => void
        }
      ): Promise<Extractor>
    }

    let lastProgress = ''
    const extractor = await transformers.pipeline('feature-extraction', SEMANTIC_MODEL_ID, {
      dtype: 'q8',
      cache_dir: cacheDir,
      // Leave CPU capacity for Chromium and the Electron main process.
      session_options: {
        intraOpNumThreads: Math.max(1, Math.min(2, availableParallelism() - 1)),
        interOpNumThreads: 1
      },
      progress_callback: (event) => {
        if (event.status !== 'progress') return
        const total = Math.max(1, Number(event.total) || 1)
        const done = Math.min(total, Math.max(0, Number(event.loaded) || 0))
        const key = `${event.file}:${Math.floor((done / total) * 100)}`
        if (key === lastProgress) return
        lastProgress = key
        progress({
          phase: 'model',
          done,
          total,
          label: `Loading ${modelFileName(event.file)}…`
        })
      }
    })

    progress({ phase: 'model', done: 1, total: 1, label: 'BGE Small is ready' })
    return extractor
  })()

  try {
    return await extractorPromise
  } catch (error) {
    extractorPromise = null
    throw error
  }
}

function rowsOf(value: unknown[]): number[][] {
  if (!Array.isArray(value)) throw new Error('The embedding model returned an invalid result.')
  return value.map((row) => {
    if (!Array.isArray(row) || row.some((item) => typeof item !== 'number')) {
      throw new Error('The embedding model returned an invalid vector.')
    }
    return row as number[]
  })
}

async function handle(request: SemanticWorkerRequest): Promise<void> {
  const progress = (event: SemanticProgress): void => report(request.id, event)

  try {
    const embeddingCache = await embeddingsFor(request.cacheDir)
    const keys = new Map(request.texts.map((text) => [text, embeddingFingerprint(text)] as const))
    const missing = request.texts.filter((text) => !embeddingCache.has(keys.get(text)!))

    if (missing.length > 0) {
      const extractor = await loadExtractor(request.cacheDir, progress)

      for (let start = 0; start < missing.length; start += BATCH_SIZE) {
        const batch = missing.slice(start, start + BATCH_SIZE)
        progress({
          phase: 'embedding',
          done: start,
          total: missing.length,
          label: `Understanding books ${start + 1}–${Math.min(start + batch.length, missing.length)}…`
        })
        const output = await extractor(batch, { pooling: 'cls', normalize: true })
        const rows = rowsOf(output.tolist())
        if (rows.length !== batch.length) {
          throw new Error('The embedding model returned the wrong number of vectors.')
        }
        batch.forEach((text, index) => embeddingCache.set(keys.get(text)!, rows[index]))
      }

      progress({
        phase: 'embedding',
        done: missing.length,
        total: missing.length,
        label: 'Saving book embeddings…'
      })
      try {
        await saveEmbeddingCache(request.cacheDir, SEMANTIC_EMBEDDING_MODEL, embeddingCache)
      } catch (error) {
        // The cache is optional derived data; inference results remain usable.
        console.warn('[semantic] could not save the embedding cache:', error)
      }
    }

    progress({
      phase: 'embedding',
      done: request.texts.length,
      total: request.texts.length || 1,
      label: missing.length === 0 ? 'Reusing saved book embeddings' : 'Book embeddings are ready'
    })
    const vectors = request.texts.map((text) => embeddingCache.get(keys.get(text)!)!)
    send({ id: request.id, type: 'result', vectors })
  } catch (error) {
    send({
      id: request.id,
      type: 'error',
      message: error instanceof Error ? error.message : String(error)
    })
  }
}

// Requests are serialized so one model instance never runs overlapping ONNX
// sessions when the user switches between grid and tree quickly.
let queue = Promise.resolve()
port.on('message', (request: SemanticWorkerRequest) => {
  queue = queue.then(() => handle(request))
})
