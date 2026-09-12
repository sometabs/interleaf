import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { resolveDbPath, resolveUserDataDir } from '../src/main/db/userdata'

// Electron names the userData directory after the app, and the app was renamed.

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'interleaf-userdata-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('resolveUserDataDir', () => {
  it('uses a separate directory outside packaged builds', () => {
    expect(resolveUserDataDir(root, false)).toBe(join(root, 'Interleaf Dev'))
  })

  it('does not migrate legacy production data in development', () => {
    const legacy = join(root, 'bookhook')
    mkdirSync(legacy, { recursive: true })
    writeFileSync(join(legacy, 'bookhook.db'), 'production data')

    expect(resolveUserDataDir(root, false)).toBe(join(root, 'Interleaf Dev'))
    expect(readFileSync(join(legacy, 'bookhook.db'), 'utf8')).toBe('production data')
  })

  it('names the current directory on a fresh install', () => {
    expect(resolveUserDataDir(root, true)).toBe(join(root, 'Interleaf'))
  })

  it('moves a directory left behind by the old name', () => {
    const legacy = join(root, 'bookhook')
    mkdirSync(join(legacy, 'covers'), { recursive: true })
    writeFileSync(join(legacy, 'covers', 'book-1-2.jpg'), 'jpeg bytes')
    writeFileSync(join(legacy, 'bookhook.db'), 'sqlite bytes')

    const dir = resolveUserDataDir(root, true)

    expect(dir).toBe(join(root, 'Interleaf'))
    expect(existsSync(legacy)).toBe(false)
    // The cover cache and Local Storage ride along, which is why the whole
    // directory moves rather than just the file.
    expect(readFileSync(join(dir, 'covers', 'book-1-2.jpg'), 'utf8')).toBe('jpeg bytes')
    expect(readFileSync(join(dir, 'bookhook.db'), 'utf8')).toBe('sqlite bytes')
  })

  it('leaves the old directory alone once the current one exists', () => {
    const legacy = join(root, 'bookhook')
    mkdirSync(legacy, { recursive: true })
    writeFileSync(join(legacy, 'bookhook.db'), 'stale')
    const current = join(root, 'Interleaf')
    mkdirSync(current, { recursive: true })
    writeFileSync(join(current, 'interleaf.db'), 'live')

    expect(resolveUserDataDir(root, true)).toBe(current)
    expect(readFileSync(join(current, 'interleaf.db'), 'utf8')).toBe('live')
    expect(existsSync(join(legacy, 'bookhook.db'))).toBe(true)
  })
})

describe('resolveDbPath', () => {
  it('names the current file on a fresh install', () => {
    expect(resolveDbPath(root)).toBe(join(root, 'interleaf.db'))
  })

  it('renames a database written under the old name', () => {
    writeFileSync(join(root, 'bookhook.db'), 'sqlite bytes')

    expect(resolveDbPath(root)).toBe(join(root, 'interleaf.db'))
    expect(readFileSync(join(root, 'interleaf.db'), 'utf8')).toBe('sqlite bytes')
    expect(existsSync(join(root, 'bookhook.db'))).toBe(false)
  })

  it('carries the write-ahead log across with it', () => {
    // A -wal left behind is committed transactions the renamed database
    // cannot see.
    writeFileSync(join(root, 'bookhook.db'), 'sqlite bytes')
    writeFileSync(join(root, 'bookhook.db-wal'), 'uncheckpointed commits')
    writeFileSync(join(root, 'bookhook.db-shm'), 'shared memory')

    resolveDbPath(root)

    expect(readFileSync(join(root, 'interleaf.db-wal'), 'utf8')).toBe('uncheckpointed commits')
    expect(readFileSync(join(root, 'interleaf.db-shm'), 'utf8')).toBe('shared memory')
    expect(existsSync(join(root, 'bookhook.db-wal'))).toBe(false)
  })

  it('prefers the current file when both are present', () => {
    writeFileSync(join(root, 'bookhook.db'), 'stale')
    writeFileSync(join(root, 'interleaf.db'), 'live')

    expect(resolveDbPath(root)).toBe(join(root, 'interleaf.db'))
    expect(readFileSync(join(root, 'interleaf.db'), 'utf8')).toBe('live')
  })
})
