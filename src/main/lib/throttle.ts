/** Injectable so timing can be tested without real clocks. */
export interface ThrottleDeps {
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}

export type Throttle = <T>(task: () => Promise<T>) => Promise<T>

// One at a time, with `minIntervalMs` between the start of one and the next.
export function createThrottle(minIntervalMs: number, deps: ThrottleDeps = {}): Throttle {
  const now = deps.now ?? (() => Date.now())
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))

  let queue: Promise<unknown> = Promise.resolve()
  let lastStart = -Infinity

  return <T>(task: () => Promise<T>): Promise<T> => {
    const run = async (): Promise<T> => {
      const wait = lastStart + minIntervalMs - now()
      if (wait > 0) await sleep(wait)
      lastStart = now()
      return task()
    }

    // Chained on both settle and reject, so one failure cannot stall the queue.
    const result = queue.then(run, run)
    queue = result.then(
      () => undefined,
      () => undefined
    )
    return result
  }
}
