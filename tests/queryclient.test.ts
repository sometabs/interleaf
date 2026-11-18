import { onlineManager } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createQueryClient } from '../src/renderer/src/lib/queryClient'

describe('query client', () => {
  afterEach(() => onlineManager.setOnline(true))

  // Every read and write is local, so a dropped network must not hold back a save.
  it('saves and reads while the system reports no network', async () => {
    onlineManager.setOnline(false)
    const client = createQueryClient()
    const save = vi.fn(async () => 'saved')

    const result = await client
      .getMutationCache()
      .build(client, { mutationFn: save })
      .execute(undefined)
    const read = await client.fetchQuery({ queryKey: ['books'], queryFn: async () => ['Dune'] })

    expect(result).toBe('saved')
    expect(read).toEqual(['Dune'])
  })
})
