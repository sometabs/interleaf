// The editor shows no markdown, so rows, titles and search results must not
// either. A stripper, not a renderer: these are one-line previews.

/** Inline markers the editor can produce, longest first so `**` beats `*`. Backticks,
 * `~~` and `[a](b)` are text to the editor, so they stay text here too. */
const INLINE = [
  { pattern: /\*\*\*([^*]+)\*\*\*/g, replace: '$1' },
  { pattern: /\*\*([^*]+)\*\*/g, replace: '$1' },
  { pattern: /\*([^*]+)\*/g, replace: '$1' },
  { pattern: /___([^_]+)___/g, replace: '$1' },
  { pattern: /__([^_]+)__/g, replace: '$1' },
  // The tags the editor reads, as in `renderer/src/lib/editor/markdown.ts`.
  { pattern: /<\/?(u|strong|em|b|i)>/gi, replace: '' }
]

/** What starts a block: heading hashes, quote arrows, list markers. */
const BLOCK_PREFIX = /^\s{0,3}(?:#{1,6}\s+|>\s?|[-*+]\s+|\d+[.)]\s+)/

// An escaped character is text, so it is set aside before any marker is matched.
const ESCAPED = /\\([!-/:-@[-`{-~])/g
const SET_ASIDE = /\uE000(\d+)\uE001/g

function stripLine(line: string): string {
  const kept: string[] = []
  let out = line.replace(ESCAPED, (_, char: string) => `\uE000${kept.push(char) - 1}\uE001`)
  // Repeated because a line can nest them: `> - **quoted bullet**`.
  for (let i = 0; i < 3; i++) {
    const next = out.replace(BLOCK_PREFIX, '')
    if (next === out) break
    out = next
  }
  for (const { pattern, replace } of INLINE) out = out.replace(pattern, replace)
  return out.replace(SET_ASIDE, (_, index: string) => kept[Number(index)])
}

/** One line of plain words, suitable for a list row or a title. */
export function toPlainText(markdown: string): string {
  return markdown.split(/\r?\n/).map(stripLine).join(' ').replace(/\s+/g, ' ').trim()
}
