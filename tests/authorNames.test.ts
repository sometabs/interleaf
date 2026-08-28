import { describe, expect, it } from 'vitest'

import { isLatinScript, latinAuthorName } from '../src/main/services/authorNames'

// Fixtures keep the proportions of real responses: the answer is found by
// counting agreement, so one of each would prove nothing.
const TOLSTOY = [
  'Leo Tolstoy',
  'Leo Tolstoy',
  'LEO TOLSTOY',
  'Count Leo Tolstoy',
  'Tolstoy, Leo',
  'Leo Nikolayevich Tolstoy',
  'Lev Nikolayevich Tolstoy',
  'Lev Tolstoi',
  'Léon Tolstoï',
  'Lev Nikolaevič Tolstoj',
  'L. N. Tolstoy',
  'Tolstoy, Leo, graf',
  'Leo Tolstoi',
  'Mr Leo Tolstoy',
  'граф Лев Толстой'
]

const MURAKAMI = [
  'Haruki Murakami',
  'Haruki Murakami',
  'HARUKI MURAKAMI',
  'Murakami Haruki',
  'Haruki MURAKAMI',
  'Murakami Kharuki',
  'Харуки Мураками',
  '무라카미 하루키',
  '村上, 春树',
  'הרוקי מורקמי'
]

describe('isLatinScript', () => {
  it('accepts a name written in Latin letters, accents and all', () => {
    for (const name of ['Leo Tolstoy', 'Kenzaburō Ōe', 'Ursula K. Le Guin', "Patrick O'Brian"]) {
      expect(isLatinScript(name)).toBe(true)
    }
  })

  it('rejects every other script', () => {
    for (const name of ['Лев Толстой', '村上春樹', 'نجيب محفوظ', '한강', 'Νίκος Καζαντζάκης']) {
      expect(isLatinScript(name)).toBe(false)
    }
  })

  it('rejects a string with no letters at all', () => {
    expect(isLatinScript('###')).toBe(false)
    expect(isLatinScript('')).toBe(false)
  })

  // Unicode calls `=` and `+` symbols rather than punctuation, so a class
  // built on `\p{P}` alone misses them.
  it('accepts the symbols a catalogue leaves in a name', () => {
    for (const name of ['The name of the rose =', 'Jean+Luc Martin', 'A~B Smith', 'Smith & Sons']) {
      expect(isLatinScript(name)).toBe(true)
    }
  })

  it('leaves such a name alone rather than rewriting it', () => {
    expect(latinAuthorName('Le Guin =', TOLSTOY)).toBe('Le Guin =')
  })
})

describe('latinAuthorName', () => {
  it('leaves a name that is already Latin exactly as it is', () => {
    for (const name of ['Frank Herbert', 'Serajul ISLAM', 'Ursula K. Le Guin', 'Kenzaburō Ōe']) {
      expect(latinAuthorName(name, TOLSTOY)).toBe(name)
    }
  })

  it('finds the English spelling of a Cyrillic name', () => {
    expect(latinAuthorName('Лев Толстой', TOLSTOY)).toBe('Leo Tolstoy')
  })

  it('finds the English spelling of a Japanese name', () => {
    expect(latinAuthorName('村上春樹', MURAKAMI)).toBe('Haruki Murakami')
  })

  // Ties break towards the unaccented spelling, or the winner is
  // "Fédor Dostoïevski" rather than what the English cover says.
  it('prefers the unaccented spelling over the French or Spanish one', () => {
    const alternates = [
      'Fyodor Dostoyevsky',
      'Fyodor Dostoyevsky',
      'Fyodor Dostoevsky',
      'Fédor Dostoïevski',
      'Fédor Dostoïevski',
      'Fédor Dostoïevski',
      'Fiódor Dostoievski',
      'Fjodor Dostojewski',
      'Fëdor Dostoevskij'
    ]

    expect(latinAuthorName('Фёдор Михайлович Достоевский', alternates)).toBe('Fyodor Dostoyevsky')
  })

  it('falls back to an accented spelling when nobody wrote a plain one', () => {
    expect(latinAuthorName('نجيب محفوظ', ['Najīb Mahfūz', 'Najīb Mahfūz'])).toBe('Najīb Mahfūz')
  })

  it('repairs a record that shouts or mumbles', () => {
    expect(latinAuthorName('三島由紀夫', ['Yukio MISHIMA', 'yukio mishima', 'Yukio MISHIMA'])).toBe(
      'Yukio Mishima'
    )
  })

  it('keeps casing a librarian meant', () => {
    const alternates = ['ursula k le guin', 'Ursula Le Guin', 'Ursula Le Guin']
    expect(latinAuthorName('アーシュラ・K・ル＝グウィン', alternates)).toBe('Ursula Le Guin')
  })

  // Each fixture makes the rejected form the popular one, or the vote alone
  // gives the right answer and the rule under test proves nothing.
  describe('what it refuses to call a name', () => {
    const cases: [what: string, alternates: string[], expected: string][] = [
      [
        'the inverted catalogue form',
        ['Tolstoy, Leo', 'Tolstoy, Leo', 'Tolstoy, Leo', 'Leo Tolstoy'],
        'Leo Tolstoy'
      ],
      [
        'a librarian’s annotation',
        ['Tolstoy Leo 1828-1910', 'Tolstoy Leo 1828-1910', 'Tolstoy Leo 1828-1910', 'Leo Tolstoy'],
        'Leo Tolstoy'
      ],
      [
        'a title of address',
        ['Count Tolstoy', 'Count Tolstoy', 'Count Tolstoy', 'Leo Tolstoy'],
        'Leo Tolstoy'
      ],
      [
        'a role rather than a person',
        ['Tolstoy Staff', 'Tolstoy Staff', 'Tolstoy Staff', 'Leo Tolstoy'],
        'Leo Tolstoy'
      ],
      [
        'initials',
        ['F Dostoevsky', 'F Dostoevsky', 'F Dostoevsky', 'Fyodor Dostoyevsky'],
        'Fyodor Dostoyevsky'
      ],
      [
        'a word imported twice',
        [
          'Fyodor Fyodor Dostoevsky',
          'Fyodor Fyodor Dostoevsky',
          'Fyodor Fyodor Dostoevsky',
          'Fyodor Dostoyevsky'
        ],
        'Fyodor Dostoyevsky'
      ],
      [
        'a surname on its own',
        ['Dostoevsky', 'Dostoevsky', 'Dostoevsky', 'Fyodor Dostoyevsky'],
        'Fyodor Dostoyevsky'
      ],
      [
        'a trailing full stop',
        ['Tolstoy Leo.', 'Tolstoy Leo.', 'Tolstoy Leo.', 'Leo Tolstoy'],
        'Leo Tolstoy'
      ],
      [
        'a soft sign left dangling',
        ["Tolstoy' 'Leo", "Tolstoy' 'Leo", "Tolstoy' 'Leo", 'Leo Tolstoy'],
        'Leo Tolstoy'
      ]
    ]

    for (const [what, alternates, expected] of cases) {
      it(`refuses ${what}`, () => {
        expect(latinAuthorName('Лев Толстой', alternates)).toBe(expected)
      })
    }

    it('keeps a single name when there is nothing better', () => {
      expect(latinAuthorName('Лев Толстой', ['Tolstoy, Leo', 'L. N. T.'])).toBe('Лев Толстой')
    })

    it('keeps the original when there are no alternates at all', () => {
      expect(latinAuthorName('村上春樹')).toBe('村上春樹')
    })
  })

  // Both orderings are real spellings and score identically by words alone,
  // so the fixture leads with the losing one.
  it('follows the order the records agree on, not the first one offered', () => {
    const alternates = ['Murakami Haruki', 'Haruki Murakami', 'Haruki Murakami', 'Haruki Murakami']

    expect(latinAuthorName('村上春樹', alternates)).toBe('Haruki Murakami')
  })

  // `author_alternative_name` is flat across every author on the work, so a
  // translator's spellings sit in the same list.
  it('does not hand a book to its translator', () => {
    const alternates = [
      'James Philip Gabriel',
      'Philip Gabriel',
      'Gabriel Philip',
      'Haruki Murakami'
    ]

    expect(latinAuthorName('村上春樹', alternates, ['Philip Gabriel'])).toBe('Haruki Murakami')
  })

  it('still uses a co-author who is written in the same script as the first', () => {
    // A Cyrillic co-author cannot be confused with a Latin alternate.
    expect(latinAuthorName('Лев Толстой', TOLSTOY, ['Софья Толстая'])).toBe('Leo Tolstoy')
  })
})
