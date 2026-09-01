import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let cache: string

// The module reaches for Electron's userData path; the test supplies its own.
vi.mock('electron', () => ({ app: { getPath: () => cache } }))

// Hoisted: a `doMock` after `load()` leaves the real client bound, and the
// guard under test then passes on that client's own checks instead.
const { downloaded } = vi.hoisted(() => ({ downloaded: vi.fn() }))
vi.mock('../src/main/services/openlibrary', () => ({ downloadCover: downloaded }))

async function load(): Promise<typeof import('../src/main/services/covers')> {
  vi.resetModules()
  return import('../src/main/services/covers')
}

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)])
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64, 2)
])
const WEBP = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.from([0, 0, 0, 0]),
  Buffer.from('WEBP'),
  Buffer.alloc(64, 3)
])

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'covers-'))
  cache = dir
  // Always succeeds, so nothing but the id guard can prevent the write.
  downloaded.mockReset()
  downloaded.mockResolvedValue(JPEG)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function writeSource(name: string, bytes: Buffer): string {
  const path = join(dir, name)
  writeFileSync(path, bytes)
  return path
}

describe('choosing a cover file', () => {
  it('stores a JPEG and returns the name to save on the book', async () => {
    const { importCoverFile, coversDir } = await load()

    const name = importCoverFile(7, writeSource('jacket.jpg', JPEG))

    expect(name).toMatch(/^book-7-[0-9a-f]{12}\.jpg$/)
    expect(readFileSync(join(coversDir(), name))).toEqual(JPEG)
  })

  it('accepts a PNG', async () => {
    const { importCoverFile } = await load()
    expect(importCoverFile(1, writeSource('a.png', PNG))).toMatch(/\.png$/)
  })

  it('accepts a WebP', async () => {
    const { importCoverFile } = await load()
    expect(importCoverFile(1, writeSource('a.webp', WEBP))).toMatch(/\.webp$/)
  })

  it('refuses a file that is not an image however it is named', async () => {
    const { importCoverFile, CoverError } = await load()
    const path = writeSource('trojan.jpg', Buffer.from('MZ this is an executable'))

    expect(() => importCoverFile(1, path)).toThrow(CoverError)
    expect(() => importCoverFile(1, path)).toThrow(/not a JPEG, PNG or WebP/)
  })

  it('names the real format rather than the extension it was given', async () => {
    const { importCoverFile } = await load()

    expect(importCoverFile(1, writeSource('mislabelled.jpg', PNG))).toMatch(/\.png$/)
  })

  it('refuses an image past the size cap', async () => {
    const { importCoverFile, CoverError } = await load()
    const huge = Buffer.concat([JPEG, Buffer.alloc(11 * 1024 * 1024)])

    expect(() => importCoverFile(1, writeSource('huge.jpg', huge))).toThrow(CoverError)
  })

  it('refuses a file that is not there', async () => {
    const { importCoverFile, CoverError } = await load()

    expect(() => importCoverFile(1, join(dir, 'missing.jpg'))).toThrow(CoverError)
  })

  it('refuses a file too short to identify', async () => {
    const { importCoverFile, CoverError } = await load()

    expect(() => importCoverFile(1, writeSource('tiny.jpg', Buffer.from([0xff, 0xd8])))).toThrow(
      CoverError
    )
  })

  // The renderer caches by URL, so reused names keep the old jacket on screen.
  it('gives a different name to a different image', async () => {
    const { importCoverFile } = await load()

    const first = importCoverFile(1, writeSource('one.jpg', JPEG))
    const second = importCoverFile(1, writeSource('two.png', PNG))

    expect(second).not.toBe(first)
  })

  it('gives the same name to the same bytes', async () => {
    const { importCoverFile } = await load()

    expect(importCoverFile(1, writeSource('one.jpg', JPEG))).toBe(
      importCoverFile(1, writeSource('copy.jpg', JPEG))
    )
  })

  it('produces a name the cover resolver accepts', async () => {
    const { importCoverFile, resolveCoverPath } = await load()

    const name = importCoverFile(42, writeSource('jacket.jpg', JPEG))

    expect(resolveCoverPath(name)).not.toBeNull()
  })
})

// Both ids reach `cacheCover` as IPC arguments, so `number` says nothing at
// runtime and `../` in one escapes the cache directory.
describe('cover id validation', () => {
  // Lands one level out: `book-1-..` is a literal segment that absorbs the
  // first `../`, so two only reach back to the directory itself.
  const ESCAPES = '../../../escaped'

  it('refuses a cover id that walks out of the cache directory', async () => {
    const { cacheCover, coversDir } = await load()

    const result = await cacheCover(1, ESCAPES as unknown as number)

    expect(result).toBeNull()
    expect(existsSync(join(dir, 'escaped.jpg'))).toBe(false)
    // Rejected before the network, so a crafted id cannot probe paths either.
    expect(downloaded).not.toHaveBeenCalled()
    expect(existsSync(join(coversDir(), 'escaped.jpg'))).toBe(false)
  })

  it('refuses a book id that walks out of the cache directory', async () => {
    const { cacheCover } = await load()

    expect(await cacheCover(ESCAPES as unknown as number, 14625765)).toBeNull()
    expect(existsSync(join(dir, 'escaped.jpg'))).toBe(false)
  })

  it('still caches a legitimate cover', async () => {
    const { cacheCover, coversDir } = await load()

    const name = await cacheCover(7, 14625765)

    expect(name).toBe('book-7-14625765.jpg')
    expect(readFileSync(join(coversDir(), name!))).toEqual(JPEG)
  })

  it.each([
    ['a traversal string', ESCAPES],
    ['a numeric string', '14625765'],
    ['a float', 1.5],
    ['zero', 0],
    ['a negative', -1],
    ['NaN', NaN],
    ['Infinity', Infinity],
    ['null', null],
    ['undefined', undefined],
    ['an object with toString', { toString: () => '../x' }]
  ])('rejects %s', async (_label, value) => {
    const { isSafeId } = await load()
    expect(isSafeId(value)).toBe(false)
  })

  it('accepts a real Open Library cover id', async () => {
    const { isSafeId } = await load()
    expect(isSafeId(14625765)).toBe(true)
  })

  // The path comes from a native dialog, but the id it is filed under comes
  // straight from the renderer.
  it('refuses a book id that walks out of the cache directory when importing', async () => {
    const { importCoverFile, CoverError } = await load()
    const source = writeSource('jacket.jpg', JPEG)

    expect(() => importCoverFile(ESCAPES as unknown as number, source)).toThrow(CoverError)
    expect(existsSync(join(dir, 'escaped.jpg'))).toBe(false)
  })
})

describe('sweeping the cover cache', () => {
  function seedCache(): string {
    const dir = mkdtempSync(join(tmpdir(), 'interleaf-prune-'))
    writeFileSync(join(dir, 'book-1-99.jpg'), 'IN USE')
    writeFileSync(join(dir, 'book-404-7.jpg'), 'ORPHANED')
    writeFileSync(join(dir, 'cover-12345.jpg'), 'A BOOK NOBODY OWNS')
    return dir
  }

  it('removes a jacket whose book is gone', async () => {
    const { pruneOrphanCovers } = await load()
    const dir = seedCache()
    try {
      expect(pruneOrphanCovers(dir, new Set(['book-1-99.jpg']))).toBe(1)
      expect(existsSync(join(dir, 'book-404-7.jpg'))).toBe(false)
      expect(existsSync(join(dir, 'book-1-99.jpg'))).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('keeps the Discover thumbnails, which belong to no book by design', async () => {
    const { pruneOrphanCovers } = await load()
    const dir = seedCache()
    try {
      pruneOrphanCovers(dir, new Set())
      expect(existsSync(join(dir, 'cover-12345.jpg'))).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
