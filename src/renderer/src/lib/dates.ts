/** Shared so a date reads the same on the book page and in the notes index. */

// Unix seconds, the column type everywhere in the schema, to a full date.
export function formatDate(unix: number): string {
  return new Date(unix * 1000).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  })
}

// Both directions go through the local calendar: `new Date('2026-08-09')` is
// UTC midnight, which at a negative offset is the 8th.
export function toDateInput(unix: number | null): string {
  if (unix === null) return ''
  const date = new Date(unix * 1000)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

/** `''` clears the date; anything unparseable is treated the same way. */
export function fromDateInput(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim())
  if (!match) return null

  const [, year, month, day] = match
  const date = new Date(Number(year), Number(month) - 1, Number(day))
  return Number.isNaN(date.getTime()) ? null : Math.floor(date.getTime() / 1000)
}

/** Recent timestamps read better as a distance than as a date. */
export function relativeDate(unix: number): string {
  const days = (Date.now() / 1000 - unix) / 86400
  if (days < 1) return 'today'
  if (days < 2) return 'yesterday'
  if (days < 7) return `${Math.floor(days)} days ago`
  return new Date(unix * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
