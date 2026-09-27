import { createHash } from 'node:crypto'

export interface KindleHighlight {
  sourceBookKey: string
  title: string
  author: string | null
  text: string
  location: string | null
  timestamp: string | undefined
}

const NOT_A_CLIPPINGS_FILE =
  'That file is not a Kindle clippings file. Choose the “My Clippings.txt” file from your Kindle.'

function normalized(value: string): string {
  return value.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase()
}

function sourceBookKey(title: string, author: string | null): string {
  return createHash('sha256')
    .update(`${normalized(title)}\u0000${normalized(author ?? '')}`)
    .digest('hex')
}

function bookHeader(header: string): { title: string; author: string | null } {
  // Kindle puts authors in the final parentheses. A title containing earlier
  // parentheses remains intact because the title side is greedy.
  const match = header.match(/^(.*\S)\s+\(([^()]*)\)\s*$/)
  if (!match) return { title: header.trim(), author: null }

  const author = match[2]
    .split(';')
    .map((name) => name.trim())
    .filter(Boolean)
    .join(', ')
  return { title: match[1].trim(), author: author || null }
}

export function parseKindleClippings(raw: string): KindleHighlight[] {
  const blocks = raw.replace(/\uFEFF/g, '').split(/^[ \t]*={10}[ \t]*$/m)
  const highlights: KindleHighlight[] = []
  let recognised = false

  for (const rawBlock of blocks) {
    const lines = rawBlock.replace(/\r/g, '').split('\n')
    while (lines[0]?.trim() === '') lines.shift()
    while (lines.at(-1)?.trim() === '') lines.pop()
    if (lines.length < 2) continue

    const metadataIndex = lines.findIndex((line, index) => index > 0 && /^-\s+Your\s+/i.test(line))
    if (metadataIndex === -1) continue

    const metadata = lines[metadataIndex].trim()
    if (!/^-\s+Your\s+(?:Bookmark|Highlight|Note)\b/i.test(metadata)) continue
    recognised = true
    if (!/^-\s+Your\s+Highlight\b/i.test(metadata)) continue

    const text = lines
      .slice(metadataIndex + 1)
      .join('\n')
      .trim()
    if (!text) continue

    const { title, author } = bookHeader(lines.slice(0, metadataIndex).join(' ').trim())
    if (!title) continue

    const location = metadata.match(/\bLocation\s+([^|]+)/i)?.[1]?.trim() || null
    const timestamp = metadata.match(/\bAdded on\s+(.+)$/i)?.[1]?.trim()
    highlights.push({
      sourceBookKey: sourceBookKey(title, author),
      title,
      author,
      text,
      location,
      timestamp
    })
  }

  if (!recognised) throw new Error(NOT_A_CLIPPINGS_FILE)
  return highlights
}
