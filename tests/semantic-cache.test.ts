import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  embeddingFingerprint,
  loadEmbeddingCache,
  saveEmbeddingCache
} from '../src/main/services/semanticCache'

const temporaryDirectories: string[] = []

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'interleaf-semantic-cache-'))
  temporaryDirectories.push(directory)
  return directory
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

describe('semantic embedding cache', () => {
  it('restores vectors saved by an earlier app session', async () => {
    const directory = await temporaryDirectory()
    const key = embeddingFingerprint('Subjects: philosophy')

    await saveEmbeddingCache(directory, 'model-v1', new Map([[key, [0.25, 0.75]]]))

    expect(await loadEmbeddingCache(directory, 'model-v1')).toEqual(new Map([[key, [0.25, 0.75]]]))
  })

  it('ignores embeddings from a different model', async () => {
    const directory = await temporaryDirectory()
    const key = embeddingFingerprint('Subjects: science fiction')
    await saveEmbeddingCache(directory, 'old-model', new Map([[key, [1, 0]]]))

    expect(await loadEmbeddingCache(directory, 'new-model')).toEqual(new Map())
  })

  it('recovers from a damaged cache file', async () => {
    const directory = await temporaryDirectory()
    await writeFile(join(directory, 'book-embeddings-v1.json'), 'not json', 'utf8')

    expect(await loadEmbeddingCache(directory, 'model-v1')).toEqual(new Map())
  })
})
