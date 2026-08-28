// The editor shows no markdown, so rows, titles and search results must not
// either. A stripper, not a renderer: these are one-line previews.

/** Inline markers the editor can produce, longest first so `**` beats `*`. */
const INLINE = [
  // Code spans keep their contents but lose the fences.
  { pattern: /`{1,3}([^`]*)`{1,3}/g, replace: '$1' },
  { pattern: /\*\*\*([^*]+)\*\*\*/g, replace: '$1' },
  { pattern: /\*\*([^*]+)\*\*/g, replace: '$1' },
  { pattern: /\*([^*]+)\*/g, replace: '$1' },
  { pattern: /___([^_]+)___/g, replace: '$1' },
  { pattern: /__([^_]+)__/g, replace: '$1' },
  { pattern: /~~([^~]+)~~/g, replace: '$1' },
  // `<u>` is how underline is stored, since markdown has none.
  { pattern: /<\/?u>/g, replace: '' },
  // A link keeps its text, not its target.
  { pattern: /!?\[([^\]]*)\]\([^)]*\)/g, replace: '$1' }
]

/** What starts a block: heading hashes, quote arrows, list markers. */
const BLOCK_PREFIX = /^\s{0,3}(?:#{1,6}\s+|>\s?|[-*+]\s+|\d+[.)]\s+)/

function stripLine(line: string): string {
  let out = line
  // Repeated because a line can nest them: `> - **quoted bullet**`.
  for (let i = 0; i < 3; i++) {
    const next = out.replace(BLOCK_PREFIX, '')
    if (next === out) break
    out = next
  }
  for (const { pattern, replace } of INLINE) out = out.replace(pattern, replace)
  return out
}

/** One line of plain words, suitable for a list row or a title. */
export function toPlainText(markdown: string): string {
  return markdown.split(/\r?\n/).map(stripLine).join(' ').replace(/\s+/g, ' ').trim()
}
