import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export type CachedEmbedding = number[]

interface CacheFile {
  version: 1
  model: string
  embeddings: Record<string, CachedEmbedding>
}

const CACHE_FILE = 'book-embeddings-v1.json'

export function embeddingFingerprint(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

function validVector(value: unknown): value is CachedEmbedding {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((component) => typeof component === 'number' && Number.isFinite(component))
  )
}

// The cache is derived data. A missing, stale, or damaged file is safely
// ignored and rebuilt the next time Semantic mode needs it.
export async function loadEmbeddingCache(
  cacheDir: string,
  model: string
): Promise<Map<string, CachedEmbedding>> {
  try {
    const parsed = JSON.parse(
      await readFile(join(cacheDir, CACHE_FILE), 'utf8')
    ) as Partial<CacheFile>
    if (parsed.version !== 1 || parsed.model !== model || !parsed.embeddings) return new Map()

    return new Map(
      Object.entries(parsed.embeddings).filter(
        (entry): entry is [string, CachedEmbedding] =>
          /^[a-f\d]{64}$/.test(entry[0]) && validVector(entry[1])
      )
    )
  } catch {
    return new Map()
  }
}

export async function saveEmbeddingCache(
  cacheDir: string,
  model: string,
  embeddings: Map<string, CachedEmbedding>
): Promise<void> {
  await mkdir(cacheDir, { recursive: true })
  const file: CacheFile = {
    version: 1,
    model,
    embeddings: Object.fromEntries(embeddings)
  }
  await writeFile(join(cacheDir, CACHE_FILE), JSON.stringify(file), 'utf8')
}
