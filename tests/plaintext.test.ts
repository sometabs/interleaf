import { describe, expect, it } from 'vitest'

import { deriveTitle } from '../src/main/lib/markdown'
import { toPlainText } from '../src/shared/plaintext'

describe('reducing a note to its words', () => {
  const cases: [name: string, markdown: string, plain: string][] = [
    ['bold', 'the **desert** planet', 'the desert planet'],
    ['italic', 'the *desert* planet', 'the desert planet'],
    ['bold italic', 'the ***desert*** planet', 'the desert planet'],
    ['underscored bold', 'the __desert__ planet', 'the desert planet'],
    ['underline', 'the <u>desert</u> planet', 'the desert planet'],
    ['strikethrough', 'the ~~desert~~ planet', 'the desert planet'],
    ['inline code', 'the `spice` must flow', 'the spice must flow'],
    ['heading', '# On Dune', 'On Dune'],
    ['deep heading', '### A smaller point', 'A smaller point'],
    ['quote', '> Fear is the mind-killer.', 'Fear is the mind-killer.'],
    ['bullet', '-   the water discipline', 'the water discipline'],
    ['numbered', '1.  the water discipline', 'the water discipline'],
    ['a link keeps its words', 'see [Dune](https://example.com) now', 'see Dune now'],
    ['a quoted bullet', '> - **nested**', 'nested'],
    ['plain text is untouched', 'Just a sentence.', 'Just a sentence.']
  ]

  for (const [name, markdown, plain] of cases) {
    it(name, () => {
      expect(toPlainText(markdown)).toBe(plain)
    })
  }

  it('flattens a whole note into one line', () => {
    const note = '# **Test**\n\n**Test** **Hello world**\n\n- **bro**'

    expect(toPlainText(note)).toBe('Test Test Hello world bro')
  })

  it('leaves an asterisk that is not formatting alone', () => {
    expect(toPlainText('2 * 3 = 6')).toBe('2 * 3 = 6')
  })
})

describe('the title derived from a body', () => {
  it('takes the words, not the markup', () => {
    expect(deriveTitle('# **Test**\n\nbody')).toBe('Test')
  })

  it('handles a bolded first line with no heading', () => {
    expect(deriveTitle('**Test**')).toBe('Test')
  })

  it('still prefers the first non-empty line', () => {
    expect(deriveTitle('\n\n## Second thoughts\n\nmore')).toBe('Second thoughts')
  })

  it('truncates a long one', () => {
    expect(deriveTitle('**' + 'a'.repeat(200) + '**', 10)).toBe('aaaaaaaaa…')
  })

  it('is empty for an empty body', () => {
    expect(deriveTitle('')).toBe('')
  })
})

describe('healing a title written before markdown was stripped', () => {
  it('recognises `**Test**` as one we generated', async () => {
    const { createDatabase } = await import('../src/main/db/database')
    const notes = await import('../src/main/repos/notes')
    const db = createDatabase(':memory:')

    const note = notes.createNote(db, { bodyMd: '**Test**' })
    db.prepare('UPDATE note SET title = ? WHERE id = ?').run('**Test**', note.id)

    const updated = notes.updateNote(db, note.id, { bodyMd: '**Test two**' })

    expect(updated?.title).toBe('Test two')
  })

  it('still never rewrites a title the user chose', async () => {
    const { createDatabase } = await import('../src/main/db/database')
    const notes = await import('../src/main/repos/notes')
    const db = createDatabase(':memory:')

    const note = notes.createNote(db, { title: 'My Title', bodyMd: '**Test**' })
    const updated = notes.updateNote(db, note.id, { bodyMd: '**Something else**' })

    expect(updated?.title).toBe('My Title')
  })
})

describe('cleaning titles already on disk', () => {
  it('rewrites a stored title that carries markdown', async () => {
    const { createDatabase, MIGRATIONS } = await import('../src/main/db/database')
    const notes = await import('../src/main/repos/notes')
    const db = createDatabase(':memory:')

    const note = notes.createNote(db, { bodyMd: '**Test**' })
    db.prepare('UPDATE note SET title = ? WHERE id = ?').run('**Test**', note.id)

    db.exec(MIGRATIONS[3])

    expect(notes.getNote(db, note.id)?.title).toBe('Test')
  })

  it('leaves a clean title exactly as it is', async () => {
    const { createDatabase, MIGRATIONS } = await import('../src/main/db/database')
    const notes = await import('../src/main/repos/notes')
    const db = createDatabase(':memory:')

    const note = notes.createNote(db, { title: 'A Perfectly Good Title', bodyMd: 'body' })
    db.exec(MIGRATIONS[3])

    expect(notes.getNote(db, note.id)?.title).toBe('A Perfectly Good Title')
  })

  it('runs on a database opened fresh, without being asked twice', async () => {
    const { createDatabase } = await import('../src/main/db/database')
    const db = createDatabase(':memory:')

    // The function must outlive the migration, or later use fails with
    // "no such function".
    expect(db.prepare("SELECT strip_markdown('**x**') AS v").get()).toEqual({ v: 'x' })
  })
})
