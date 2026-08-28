import { describe, expect, it } from 'vitest'

import { deriveTitle } from '../src/main/lib/markdown'

describe('deriveTitle', () => {
  it('prefers the first heading', () => {
    expect(deriveTitle('# The Dispossessed\n\nsome prose')).toBe('The Dispossessed')
  })

  it('falls back to the first non-empty line', () => {
    expect(deriveTitle('\n\njust a thought\nmore')).toBe('just a thought')
  })

  it('returns empty string for an empty body', () => {
    expect(deriveTitle('   \n\n  ')).toBe('')
  })

  it('truncates very long titles', () => {
    expect(deriveTitle('x'.repeat(300))).toHaveLength(120)
  })
})
