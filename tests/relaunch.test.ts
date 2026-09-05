import { describe, expect, it } from 'vitest'

import { relaunchOptions } from '../src/main/services/backup'

describe('relaunching after a restore', () => {
  it('names the AppImage when the app is running as one', () => {
    expect(relaunchOptions('/home/reader/Apps/Interleaf.AppImage')).toEqual({
      execPath: '/home/reader/Apps/Interleaf.AppImage'
    })
  })

  it('leaves Electron to work it out anywhere else', () => {
    expect(relaunchOptions(undefined)).toBeUndefined()
  })

  // An empty variable is set but says nothing, and an empty execPath relaunches
  // nothing at all.
  it('ignores the variable when it is empty', () => {
    expect(relaunchOptions('')).toBeUndefined()
  })
})
