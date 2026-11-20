// A pause longer than this means the reader stepped away; only this much of it counts.
export const IDLE_CAP_MS = 3 * 60_000

// Counts time between signs of reading (a page turn, a scroll, a key), capping each gap.
export class ReadingClock {
  private last: number | null
  private total = 0

  constructor(
    now: number,
    private readonly cap = IDLE_CAP_MS
  ) {
    this.last = now
  }

  activity(now: number): void {
    if (this.last !== null) this.total += Math.min(Math.max(0, now - this.last), this.cap)
    this.last = now
  }

  pause(now: number): void {
    this.activity(now)
    this.last = null
  }

  resume(now: number): void {
    if (this.last === null) this.last = now
  }

  get seconds(): number {
    return Math.floor(this.total / 1000)
  }
}

export function formatDuration(seconds: number): string {
  const minutes = Math.round(seconds / 60)
  if (minutes < 1) return 'under a minute'
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (hours === 0) return `${rest} min`
  if (hours >= 10 || rest === 0) return `${hours} h`
  return `${hours} h ${rest} min`
}
