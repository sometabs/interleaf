// Open Library's raw subjects are cataloguing data and are never displayed;
// books are classified into the taxonomy below instead.

// Every book has exactly one, always.
export type BookGroup = 'Fiction' | 'Non-fiction'

export interface BookCategories {
  group: BookGroup
  // Never includes the group itself.
  genres: string[]
}

// The first rule a subject matches wins, so a qualifier of a broader word must
// come first: "Historical fiction" before "History".
const RULES: readonly (readonly [string, BookGroup, RegExp])[] = [
  [
    'True Crime',
    'Non-fiction',
    /true crime|serial (killer|murder)|murder case|criminal investigation/
  ],

  [
    'Science Fiction',
    'Fiction',
    /science.?fiction|sci-?fi|space opera|cyberpunk|dystopi|time travel/
  ],
  ['Fantasy', 'Fiction', /fantasy|wizard|dragon|sword and sorcery|mythical|magic/],
  ['Historical Fiction', 'Fiction', /historical fiction|historical novel/],
  ['Mystery', 'Fiction', /mystery|detective|whodunit|noir|crime fiction/],
  ['Thriller & Suspense', 'Fiction', /thriller|suspense|espionage|spy stories/],
  ['Horror', 'Fiction', /horror|ghost stories|vampire|zombie|supernatural/],
  ['Romance', 'Fiction', /romance|love stories/],
  ['Young Adult', 'Fiction', /young adult|juvenile fiction|teenagers.{0,12}fiction/],
  ['Children', 'Fiction', /juvenile|children|picture books/],
  ['Poetry', 'Fiction', /poetry|poems|verse/],
  ['Comics & Graphic Novels', 'Fiction', /comic|graphic novel|manga|cartoons/],
  ['Drama', 'Fiction', /drama|plays|theater|theatre|tragedies/],

  ['Philosophy', 'Non-fiction', /philosoph|ethics|metaphysics|epistemolog|stoic|logic/],
  ['Biography & Memoir', 'Non-fiction', /biograph|autobiograph|memoir|diaries|personal narratives/],
  [
    'History',
    'Non-fiction',
    /history|historical|civilization|ancient|medieval|world war|revolution/
  ],
  [
    'Psychology',
    'Non-fiction',
    /psycholog|mental health|cognitive|behaviou?r|emotions|consciousness/
  ],
  [
    'Religion & Spirituality',
    'Non-fiction',
    /religio|bible|christian|islam|buddh|hindu|spiritual|theolog|myth/
  ],
  [
    'Politics',
    'Non-fiction',
    /politic|government|democracy|\blaw\b|sociolog|social science|economics/
  ],
  [
    'Business',
    'Non-fiction',
    /business|management|finance|marketing|entrepreneur|leadership|investing/
  ],
  [
    'Technology',
    'Non-fiction',
    /computer|software|programming|technolog|engineering|internet|robot/
  ],
  [
    'Science',
    'Non-fiction',
    /science|physics|biology|chemistry|astronom|mathematic|evolution|climate/
  ],
  ['Sports', 'Non-fiction', /sports|athlet|running|marathon|triathlon|football|cycling|climbing/],
  ['Health & Fitness', 'Non-fiction', /health|medicine|medical|fitness|nutrition|diet|disease/],
  [
    'Self-Help',
    'Non-fiction',
    /self-?help|personal development|productivity|habits|success|motivation/
  ],
  ['Travel', 'Non-fiction', /travel|guidebook|voyages|description and travel/],
  ['Cookbooks & Food', 'Non-fiction', /cook|recipe|cuisine|baking|\bfood\b/],
  [
    'Art & Photography',
    'Non-fiction',
    /\bart\b|painting|photograph|music|design|architecture|sculpture/
  ],
  ['Nature', 'Non-fiction', /nature|animals|environment|ecolog|gardening|plants/],
  ['Education', 'Non-fiction', /education|teaching|study|reference|handbook|essays/]
]

const GROUP_OF = new Map(RULES.map(([label, group]) => [label, group]))

const GENRES: readonly string[] = [...GROUP_OF.keys()]

export const GENRES_BY_GROUP: Readonly<Record<BookGroup, readonly string[]>> = {
  Fiction: GENRES.filter((genre) => GROUP_OF.get(genre) === 'Fiction'),
  'Non-fiction': GENRES.filter((genre) => GROUP_OF.get(genre) === 'Non-fiction')
}

function isGenre(value: string): boolean {
  return GROUP_OF.has(value)
}

// Chosen genres replace the inferred ones. The group is derived, since asking
// separately would allow "Fantasy" filed under Non-fiction.
export function fromChosenGenres(chosen: readonly string[]): BookCategories | null {
  const genres = chosen.filter(isGenre)
  if (genres.length === 0) return null
  // Choosing across both groups is possible, so the first one decides.
  return { group: GROUP_OF.get(genres[0]) as BookGroup, genres }
}

// `genre:` facets state the kind of book outright; every other facet describes
// packaging or setting, so it is dropped.
const GENRE_FACET = /^genre:\s*/i
const OTHER_FACET = /^[a-z_]+:/i

// Past five, a chip row is the subject list again.
const MAX_GENRES = 5

function classifyOne(subject: string): string | null {
  const value = subject.trim().toLowerCase()
  if (value.length === 0) return null
  for (const [label, , pattern] of RULES) if (pattern.test(value)) return label
  return null
}

// Subjects vote rather than the first winning, and ties go to whichever came
// first, since Open Library lists subjects roughly most-salient-first.
export function classify(subjects: string[]): BookCategories {
  const facets = subjects.filter((subject) => GENRE_FACET.test(subject))
  const ballot = facets.length > 0 ? facets.map((g) => g.replace(GENRE_FACET, '')) : subjects

  const votes = new Map<string, number>()
  for (const subject of ballot) {
    if (facets.length === 0 && OTHER_FACET.test(subject)) continue
    const label = classifyOne(subject)
    if (label !== null) votes.set(label, (votes.get(label) ?? 0) + 1)
  }

  // Insertion order follows the subject list, so a stable sort breaks ties by
  // salience on its own.
  const genres = [...votes]
    .sort(([, a], [, b]) => b - a)
    .slice(0, MAX_GENRES)
    .map(([label]) => label)

  return { group: groupOf(subjects, genres), genres }
}

// Genres decide it where there are any: "Psychology" is a stronger statement
// than the word "fiction" appearing somewhere in a subject list.
function groupOf(subjects: string[], genres: string[]): BookGroup {
  let fiction = 0
  for (const genre of genres) if (GROUP_OF.get(genre) === 'Fiction') fiction += 1
  const nonFiction = genres.length - fiction

  if (fiction !== nonFiction) return fiction > nonFiction ? 'Fiction' : 'Non-fiction'

  const text = subjects.join(' | ').toLowerCase()
  if (/non-?fiction/.test(text)) return 'Non-fiction'
  if (/\bfiction\b|\bnovels?\b|short stories/.test(text)) return 'Fiction'

  // Novels are tagged "Fiction" almost without exception, so a record with
  // neither is far more often a technical or reference work.
  return 'Non-fiction'
}
