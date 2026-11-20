import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { readMainSettings, writeMainSettings } from '../src/main/services/mainSettings'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'interleaf-settings-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('settings kept outside the database', () => {
  it('remembers a chosen backup folder', () => {
    const folder = join(dir, 'Synced backups')
    writeMainSettings(dir, { backupFolder: folder })

    expect(readMainSettings(dir)).toEqual({ backupFolder: folder })
  })

  it('reads nothing when the file is missing or damaged', () => {
    expect(readMainSettings(dir)).toEqual({})
    writeFileSync(join(dir, 'settings.json'), '{ not json')
    expect(readMainSettings(dir)).toEqual({})
  })

  // A relative path would resolve against wherever the app happened to start.
  it('ignores a backup folder that is not a full path', () => {
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({ backupFolder: 'backups' }))

    expect(readMainSettings(dir)).toEqual({})
  })
})
