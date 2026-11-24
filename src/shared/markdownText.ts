// Plain text stored as note markdown must come back as the same characters, so
// everything the note parser would read as syntax is backslash-escaped. Must
// agree with the rules left enabled in `renderer/src/lib/editor/markdown.ts`.

const ANYWHERE: [RegExp, string][] = [
  [/\\/g, '\\\\'],
  [/\*/g, '\\*'],
  [/_/g, '\\_'],
  // Only what could open a tag or an entity: `a < b` and `fish & chips` stay readable.
  [/<(?=[A-Za-z/!?])/g, '\\<'],
  [/&(?=#?[A-Za-z0-9]+;)/g, '\\&']
]

// Each takes effect only at the start of a line, after up to three spaces.
const LINE_START: [RegExp, string][] = [
  [/^( {0,3})(#{1,6})(?=\s|$)/gm, '$1\\$2'],
  [/^( {0,3})>/gm, '$1\\>'],
  [/^( {0,3})([-+])(?=\s|$)/gm, '$1\\$2'],
  [/^( {0,3})(\d{1,9})([.)])(?=\s|$)/gm, '$1$2\\$3']
]

export function escapeMarkdownText(text: string): string {
  let out = text
  for (const [pattern, replacement] of [...ANYWHERE, ...LINE_START]) {
    out = out.replace(pattern, replacement)
  }
  return out
}
