import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'

const script = readFileSync(resolve('src/renderer/public/theme-init.js'), 'utf8')

describe('theme before the app mounts', () => {
  it.each([
    ['"dark"', 'dark'],
    ['"light"', 'light'],
    ['"system"', 'system'],
    [null, 'light'],
    ['invalid JSON', 'light'],
    ['"unknown"', 'light']
  ])('uses stored %s safely before the first paint', (stored, expected) => {
    const dataset: Record<string, string> = {}
    runInNewContext(script, {
      localStorage: { getItem: () => stored },
      document: { documentElement: { dataset } }
    })
    expect(dataset.theme).toBe(expected)
  })

  it('still starts when local storage is unavailable', () => {
    const dataset: Record<string, string> = {}
    runInNewContext(script, {
      localStorage: {
        getItem: () => {
          throw new Error('Storage is disabled')
        }
      },
      document: { documentElement: { dataset } }
    })
    expect(dataset.theme).toBe('light')
  })
})
