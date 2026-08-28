// The canonical name is often the original script. A name already in Latin is
// left alone, so the failure mode is a no-op.

// `\p{S}` is included because Unicode files `=`, `+` and `©` as symbols rather
// than punctuation.
const LATIN_ONLY = /^[\p{Script=Latin}\p{Mark}\p{N}\p{P}\p{S}\p{Zs}]+$/u

export function isLatinScript(text: string): boolean {
  return LATIN_ONLY.test(text) && /\p{Script=Latin}/u.test(text)
}

// The alternates hold every European catalogue's transliteration at once, so
// the vote prefers plain-ASCII spellings.
function isPlainAscii(text: string): boolean {
  return /^[ -~]+$/.test(text)
}

function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
}

function tokens(name: string): string[] {
  return fold(name)
    .split(/[^a-z]+/)
    .filter(Boolean)
}

// Words that describe a person rather than name them.
const NOT_A_NAME = new Set([
  'count',
  'graf',
  'sir',
  'lady',
  'mr',
  'mrs',
  'ms',
  'dr',
  'prof',
  'professor',
  'pseud',
  'pseudonym',
  'editor',
  'editors',
  'translator',
  'translated',
  'illustrator',
  'staff',
  'author',
  'et',
  'al',
  'and',
  'by',
  'the',
  'of',
  'ed'
])

// Commas are the inverted "Tolstoy, Leo" form, digits are lifespans, full stops
// are initials, and repeats are importer duplication.
function plausible(candidate: string, exclude: ReadonlySet<string>): string[] | null {
  if (/[,.()[\]<>0-9]/.test(candidate)) return null
  // Inside a word it is a name (O'Brien); on either end it is a soft sign
  // carried over from Cyrillic.
  if (/(^|\s)['’ʹʺ`]|['’ʹʺ`](\s|$)/.test(candidate)) return null

  const parts = tokens(candidate)
  if (parts.length < 2 || parts.length > 3) return null
  if (parts.some((part) => part.length < 2)) return null
  if (parts.some((part) => NOT_A_NAME.has(part))) return null
  if (new Set(parts).size !== parts.length) return null
  if (parts.some((part) => exclude.has(part))) return null
  return parts
}

// Transliteration has no single right answer, so rather than pick a scheme,
// count how many other spellings agree on the words and on their order.
function consensus(alternates: readonly string[]): {
  word: Map<string, number>
  order: Map<string, number>
} {
  const word = new Map<string, number>()
  const order = new Map<string, number>()

  for (const alternate of alternates) {
    const parts = tokens(alternate).filter((part) => part.length > 1)
    for (const part of new Set(parts)) word.set(part, (word.get(part) ?? 0) + 1)
    for (let i = 0; i < parts.length - 1; i++) {
      const pair = `${parts[i]} ${parts[i + 1]}`
      order.set(pair, (order.get(pair) ?? 0) + 1)
    }
  }

  return { word, order }
}

// Repaired per word, so "Le Guin", "McEwan" and "van Gogh" each keep the word
// this must not touch.
function recase(name: string): string {
  return name.replace(/\p{L}[\p{L}\p{M}'’-]*/gu, (word) => {
    const shouted = word === word.toUpperCase() && word.length > 1
    const mumbled = word === word.toLowerCase()
    if (!shouted && !mumbled) return word
    return word[0].toUpperCase() + word.slice(1).toLowerCase()
  })
}

// `alternates` is flat across all the work's authors, so `coAuthors` is
// subtracted first or a novel gets attributed to its translator.
export function latinAuthorName(
  name: string,
  alternates: readonly string[] = [],
  coAuthors: readonly string[] = []
): string {
  if (isLatinScript(name)) return name

  const exclude = new Set(coAuthors.filter(isLatinScript).flatMap(tokens))
  const latin = alternates.filter(isLatinScript)
  const ascii = latin.filter(isPlainAscii)
  const pool = ascii.length > 0 ? ascii : latin
  const { word, order } = consensus(pool)

  let best: string | null = null
  let bestScore = 0

  for (const candidate of pool) {
    const parts = plausible(candidate, exclude)
    if (!parts) continue

    let score = parts.reduce((sum, part) => sum + (word.get(part) ?? 0), 0)
    for (let i = 0; i < parts.length - 1; i++) {
      score += order.get(`${parts[i]} ${parts[i + 1]}`) ?? 0
    }
    // Per word, so a middle name cannot win by length alone.
    score = (score / parts.length) * (parts.length === 2 ? 1.1 : 1)

    if (score > bestScore) {
      bestScore = score
      best = candidate
    }
  }

  return best === null ? name : recase(best.trim())
}
