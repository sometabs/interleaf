import { describe, expect, it } from 'vitest'

import { htmlToMarkdown, markdownToHtml } from '../src/renderer/src/lib/editor/markdown'

function roundTrip(markdown: string): string {
  return htmlToMarkdown(markdownToHtml(markdown))
}

describe('markdown survives a round trip', () => {
  const cases: [name: string, markdown: string][] = [
    ['plain text', 'Just a sentence.'],
    ['bold', 'the **desert** planet'],
    ['italic', 'the *desert* planet'],
    ['bold and italic together', 'the ***desert*** planet'],
    ['underline', 'the <u>desert</u> planet'],
    ['underline inside bold', 'the **<u>desert</u>** planet'],
    ['heading 1', '# On Dune'],
    ['heading 2', '## What stayed with me'],
    ['heading 3', '### A smaller point'],
    ['bullet list', '-   one\n-   two'],
    ['numbered list', '1.  one\n2.  two'],
    ['quote', '> Fear is the mind-killer.'],
    ['double brackets in prose', 'see [[Dune]] for more'],
    ['a hash in prose', 'filed under #scifi today'],
    ['consecutive lines', 'first line\nsecond line'],
    ['paragraphs', 'first para\n\nsecond para'],
    // Syntax the editor no longer reads, which must survive as typed.
    ['backticks in prose', 'the `spice` must flow'],
    ['three dashes', 'a\n\n---\n\nb'],
    ['a fence', '```\ncode\n```'],
    ['link syntax', 'see [a](http://b.com)'],
    ['a table', '| a | b |\n| - | - |\n| 1 | 2 |'],
    ['equals signs under a line', 'Title\n====='],
    ['tildes', '~~gone~~'],
    [
      'a whole note',
      '# On Dune\n\nHerbert makes the desert a **character**, not a *setting*.\n\n' +
        '## What stayed with me\n\n-   the water discipline\n-   the <u>Litany</u>\n\n' +
        '> Fear is the mind-killer.\n\nFiled under #scifi, see [[Children of Dune]].'
    ]
  ]

  for (const [name, markdown] of cases) {
    it(name, () => {
      expect(roundTrip(markdown)).toBe(markdown)
    })
  }

  // Twice: a stable format is not the same as an idempotent one.
  it('is stable across repeated saves', () => {
    const note = '# Title\n\nsome **text**\n\n-   a\n-   b'
    const once = roundTrip(note)
    expect(roundTrip(once)).toBe(once)
  })

  it('does not add trailing whitespace to a line', () => {
    expect(roundTrip('first line\nsecond line')).not.toContain(' \n')
  })

  // The editor wraps list-item text in a paragraph, unlike markdown-it. Naive
  // serialisation leaves a blank indented line that grows on each save.
  it('writes list items the way a person would', () => {
    const fromEditor =
      '<ul><li><p>the water discipline</p></li><li><p>the desert as a character</p></li></ul>'

    expect(htmlToMarkdown(fromEditor)).toBe(
      '-   the water discipline\n-   the desert as a character'
    )
  })

  it('keeps the spacing in a list item that really has two blocks', () => {
    const fromEditor = '<ul><li><p>first</p><p>second</p></li></ul>'

    expect(htmlToMarkdown(fromEditor)).toContain('first')
    expect(htmlToMarkdown(fromEditor)).toContain('second')
    expect(htmlToMarkdown(fromEditor)).not.toBe('-   firstsecond')
  })
})

// Parsing markdown the editor cannot make builds a node it drops on load and
// writes back as a loss on the next save.
describe('markdown the editor does not read', () => {
  const inert: [name: string, markdown: string, mustNotContain: string][] = [
    ['a horizontal rule', 'a\n\n---\n\nb', '<hr'],
    ['a fenced code block', '```\ncode\n```', '<pre'],
    ['an indented code block', '    code', '<code'],
    ['inline code', 'the `spice` must flow', '<code'],
    ['a link', 'see [a](http://b.com)', '<a '],
    ['an image', '![alt](http://b.com/c.png)', '<img'],
    ['a table', '| a | b |\n| - | - |\n| 1 | 2 |', '<table'],
    ['strikethrough', '~~gone~~', '<s>'],
    ['a setext heading', 'Title\n=====', '<h1'],
    ['a bare URL', 'https://example.com', '<a ']
  ]

  for (const [name, markdown, tag] of inert) {
    it(`leaves ${name} as text`, () => {
      expect(markdownToHtml(markdown)).not.toContain(tag)
    })
  }

  it('still reads everything the toolbar offers', () => {
    const html = markdownToHtml(
      '# One\n\n## Two\n\n**b** *i* <u>u</u>\n\n-   a\n\n1.  b\n\n> quote'
    )

    for (const tag of ['<h1', '<h2', '<strong', '<em', '<u>', '<ul', '<ol', '<blockquote']) {
      expect(html).toContain(tag)
    }
  })

  // Turndown escapes anything that could start markdown syntax, which for
  // syntax no longer read just puts backslashes in the file.
  it('writes no backslashes for syntax it does not read', () => {
    expect(roundTrip('a\n\n---\n\nb')).not.toContain('\\')
    expect(roundTrip('the `spice` must flow')).not.toContain('\\')
    expect(roundTrip('see [[Dune]] and [a](b)')).not.toContain('\\')
  })

  it('still escapes syntax it does read', () => {
    // Stored bare, this paragraph would reopen as a bullet.
    expect(htmlToMarkdown('<p>- not a list</p>')).toBe('\\- not a list')
    expect(htmlToMarkdown('<p># not a heading</p>')).toBe('\\# not a heading')
  })
})
