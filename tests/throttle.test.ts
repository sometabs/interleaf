import { describe, expect, it } from 'vitest'

import { createThrottle } from '../src/main/lib/throttle'

interface FakeClock {
  now: () => number
  sleep: (ms: number) => Promise<void>
  advance: (ms: number) => void
  readonly time: number
}

// A fake clock: `sleep` advances time instantly rather than waiting.
function fakeClock(): FakeClock {
  let time = 1000
  return {
    now: () => time,
    sleep: async (ms: number) => {
      time += ms
    },
    advance: (ms: number) => {
      time += ms
    },
    get time() {
      return time
    }
  }
}

describe('createThrottle', () => {
  it('runs a single task immediately', async () => {
    const clock = fakeClock()
    const throttle = createThrottle(1000, clock)

    const started = await throttle(async () => clock.now())
    expect(started).toBe(1000)
  })

  it('spaces consecutive tasks by at least the interval', async () => {
    const clock = fakeClock()
    const throttle = createThrottle(1000, clock)
    const starts: number[] = []

    await Promise.all([
      throttle(async () => void starts.push(clock.now())),
      throttle(async () => void starts.push(clock.now())),
      throttle(async () => void starts.push(clock.now()))
    ])

    expect(starts).toEqual([1000, 2000, 3000])
  })

  it('does not delay a task that arrives after the interval has already passed', async () => {
    const clock = fakeClock()
    const throttle = createThrottle(1000, clock)

    await throttle(async () => undefined)
    clock.advance(5000)

    const second = await throttle(async () => clock.now())
    expect(second).toBe(6000)
  })

  it('preserves submission order', async () => {
    const clock = fakeClock()
    const throttle = createThrottle(10, clock)
    const order: number[] = []

    await Promise.all([1, 2, 3, 4, 5].map((n) => throttle(async () => void order.push(n))))

    expect(order).toEqual([1, 2, 3, 4, 5])
  })

  it('keeps draining the queue after a task rejects', async () => {
    const clock = fakeClock()
    const throttle = createThrottle(100, clock)

    const failed = throttle(async () => {
      throw new Error('boom')
    })
    const after = throttle(async () => 'ran anyway')

    await expect(failed).rejects.toThrow('boom')
    await expect(after).resolves.toBe('ran anyway')
  })

  it('propagates the task result to its own caller', async () => {
    const clock = fakeClock()
    const throttle = createThrottle(5, clock)

    const results = await Promise.all([
      throttle(async () => 'a'),
      throttle(async () => 'b'),
      throttle(async () => 'c')
    ])

    expect(results).toEqual(['a', 'b', 'c'])
  })
})
