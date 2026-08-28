import { app } from 'electron'
import { createHash } from 'crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { basename, join } from 'path'

import { downloadCover } from './openlibrary'

// Cover images live beside the database, outside the app bundle.
export function coversDir(): string {
  const dir = join(app.getPath('userData'), 'covers')
  mkdirSync(dir, { recursive: true })
  return dir
}

// The name arrives from the renderer, so anything escaping the cache directory
// is refused.
export function resolveCoverPath(fileName: string): string | null {
  const safe = basename(fileName)
  if (!safe || safe !== fileName) return null
  if (!/^[\w.-]+\.(jpg|jpeg|png|webp)$/i.test(safe)) return null

  const full = join(coversDir(), safe)
  return existsSync(full) ? full : null
}

// These ids arrive as IPC arguments, so `number` says nothing at runtime and
// `../` in one walks `join` out of the cache directory.
export function isSafeId(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 1e12
}

// Null when unavailable: a missing cover must never block adding a book.
export async function cacheCover(bookId: number, coverId: number): Promise<string | null> {
  if (!isSafeId(coverId) || !isSafeId(bookId)) return null

  const bytes = await downloadCover(coverId)
  if (!bytes) return null

  const fileName = `book-${bookId}-${coverId}.jpg`
  try {
    writeFileSync(join(coversDir(), fileName), bytes)
    return fileName
  } catch {
    return null
  }
}

// The first bytes, not the extension, so a mislabelled image is refused at the
// picker rather than drawing broken later.
function imageKind(bytes: Buffer): 'jpg' | 'png' | 'webp' | null {
  if (bytes.length < 12) return null
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg'
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
    return 'png'
  if (
    bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
    bytes.subarray(8, 12).toString('ascii') === 'WEBP'
  )
    return 'webp'
  return null
}

const MAX_COVER_BYTES = 10 * 1024 * 1024

export class CoverError extends Error {}

// The name carries a digest of the bytes: the renderer caches by URL, so a
// reused name leaves the old jacket on screen until a restart.
export function importCoverFile(bookId: number, sourcePath: string): string {
  // The only untrusted part of the name below: the digest and extension are
  // derived here rather than supplied.
  if (!isSafeId(bookId)) throw new CoverError('That cover could not be saved.')

  let bytes: Buffer
  try {
    bytes = readFileSync(sourcePath)
  } catch {
    throw new CoverError('That file could not be read.')
  }

  if (bytes.byteLength > MAX_COVER_BYTES) {
    throw new CoverError('That image is larger than 10 MB.')
  }

  const kind = imageKind(bytes)
  if (!kind) {
    throw new CoverError('That file is not a JPEG, PNG or WebP image.')
  }

  const digest = createHash('sha1').update(bytes).digest('hex').slice(0, 12)
  const fileName = `book-${bookId}-${digest}.${kind}`
  writeFileSync(join(coversDir(), fileName), bytes)
  return fileName
}

// One fetch per cover id, however many tiles ask for it at once.
const inFlight = new Map<number, Promise<string | null>>()

// The renderer cannot fetch these itself: covers.openlibrary.org redirects to
// archive.org, and Chromium enforces `img-src` against the redirect target.
export function coverForId(rawId: string): Promise<string | null> {
  if (!/^[0-9]{1,12}$/.test(rawId)) return Promise.resolve(null)
  const coverId = Number(rawId)

  const fileName = `cover-${coverId}.jpg`
  const cached = resolveCoverPath(fileName)
  if (cached) return Promise.resolve(cached)

  const existing = inFlight.get(coverId)
  if (existing) return existing

  const pending = downloadCover(coverId, 'M')
    .then((bytes) => {
      if (!bytes) return null
      writeFileSync(join(coversDir(), fileName), bytes)
      return resolveCoverPath(fileName)
    })
    .catch(() => null)
    .finally(() => inFlight.delete(coverId))

  inFlight.set(coverId, pending)
  return pending
}
