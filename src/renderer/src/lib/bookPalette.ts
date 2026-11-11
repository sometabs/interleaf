interface BookPalette {
  cover: string
  spine: string
  ink: string
  detail: string
}

const PALETTES: readonly BookPalette[] = [
  { cover: '#3f5268', spine: '#2d3d50', ink: '#f7f4ec', detail: '#9daaba' },
  { cover: '#7a4650', spine: '#5e3039', ink: '#fff7ed', detail: '#cba0a6' },
  { cover: '#657560', spine: '#4b5b47', ink: '#fbf8eb', detail: '#aeb8a8' },
  { cover: '#936b38', spine: '#714d25', ink: '#fff8e8', detail: '#d1b786' },
  { cover: '#416969', spine: '#2d5050', ink: '#f4fbf8', detail: '#91b2af' },
  { cover: '#66536f', spine: '#4d3c57', ink: '#fbf5ff', detail: '#ad9ab5' }
]

export function paletteFor(title: string): BookPalette {
  let hash = 2166136261
  for (const char of title.normalize('NFKC').toLowerCase()) {
    hash ^= char.codePointAt(0) ?? 0
    hash = Math.imul(hash, 16777619)
  }
  return PALETTES[(hash >>> 0) % PALETTES.length]
}
