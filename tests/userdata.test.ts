import { join } from 'path'
import { describe, expect, it } from 'vitest'

import { resolveDbPath, resolveUserDataDir } from '../src/main/db/userdata'

const root = 'app-data'

describe('resolveUserDataDir', () => {
  it('uses a separate directory outside packaged builds', () => {
    expect(resolveUserDataDir(root, false)).toBe(join(root, 'Interleaf Dev'))
  })

  it('uses the app directory in packaged builds', () => {
    expect(resolveUserDataDir(root, true)).toBe(join(root, 'Interleaf'))
  })
})

describe('resolveDbPath', () => {
  it('keeps the database inside the profile directory', () => {
    expect(resolveDbPath(root)).toBe(join(root, 'interleaf.db'))
  })
})
