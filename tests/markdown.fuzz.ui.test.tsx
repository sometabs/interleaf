import { Editor as TiptapEditor } from '@tiptap/core'
import { afterEach, describe, expect, it } from 'vitest'

import { noteExtensions } from '../src/renderer/src/lib/editor/extensions'
import { htmlToMarkdown, markdownToHtml } from '../src/renderer/src/lib/editor/markdown'
import { escapeMarkdownText } from '../src/shared/markdownText'
import { toPlainText } from '../src/shared/plaintext'

// Pieces that mean something to markdown or HTML, mixed with ordinary words.
const PIECES = [
  ...'!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~'.split(''),
  ...['<u>', '</u>', '<name>', '<b>', '</em>', '<!--', '-->', '<a href="x">', '<?x?>'],
  ...['&amp;', '&#65;', '&copy;', '&', '# ', '## ', '> ', '- ', '+ ', '* ', '1. ', '2) '],
  ...['**', '__', '***', '\\*', '\\\\', '---', '===', '[a](b)', '`x`', '~~', '|'],
  ...['word', 'Dune', 'x', '42', '1984', ' ', ' ', ' ']
]

// Deterministic, so a failure names the same string on every run.
function random(seed: number): () => number {
  let state = seed
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648
    return state / 2147483648
  }
}

function line(next: () => number): string {
  let out = ''
  const length = 1 + Math.floor(next() * 12)
  for (let i = 0; i < length; i++) out += PIECES[Math.floor(next() * PIECES.length)]
  // Spacing at the edges of a line is layout, not text, in both HTML and markdown.
  return out.replace(/\s+/g, ' ').trim() || 'x'
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

let editor: TiptapEditor | null = null

afterEach(() => {
  editor?.destroy()
  editor = null
})

// What the note shows once its markdown is opened in the real editor.
function opened(markdown: string): { text: string; nodes: string[] } {
  editor?.destroy()
  editor = new TiptapEditor({ extensions: noteExtensions(), content: markdownToHtml(markdown) })
  const nodes: string[] = []
  editor.state.doc.descendants((node) => {
    nodes.push(node.type.name)
  })
  const { doc } = editor.state
  return { text: doc.textBetween(0, doc.content.size, '\n', '\n'), nodes }
}

const ONLY_TEXT = (nodes: string[]): string[] =>
  nodes.filter((name) => !['paragraph', 'text', 'hardBreak'].includes(name))

describe('any text survives being saved and opened again', () => {
  it('when typed into a note', { timeout: 120_000 }, () => {
    const next = random(7)
    for (let i = 0; i < 1500; i++) {
      const typed = line(next)
      editor?.destroy()
      editor = new TiptapEditor({
        extensions: noteExtensions(),
        content: `<p>${escapeHtml(typed)}</p>`
      })
      const markdown = htmlToMarkdown(editor.getHTML())
      const back = opened(markdown)

      expect({ typed, markdown, shown: back.text }).toEqual({ typed, markdown, shown: typed })
      expect(ONLY_TEXT(back.nodes)).toEqual([])
    }
  })

  it('when typed inside bold, italic and underline', { timeout: 120_000 }, () => {
    const next = random(13)
    for (let i = 0; i < 600; i++) {
      const [a, b, c] = [line(next), line(next), line(next)]
      editor?.destroy()
      editor = new TiptapEditor({
        extensions: noteExtensions(),
        content: `<p>${escapeHtml(a)} <strong>${escapeHtml(b)}</strong> <u><em>${escapeHtml(c)}</em></u></p>`
      })
      const markdown = htmlToMarkdown(editor.getHTML())
      const back = opened(markdown)
      const typed = `${a} ${b} ${c}`

      expect({ typed, markdown, shown: back.text }).toEqual({ typed, markdown, shown: typed })
      const { doc, schema } = editor!.state
      for (const mark of [schema.marks.bold, schema.marks.italic, schema.marks.underline]) {
        expect({
          markdown,
          mark: mark.name,
          kept: doc.rangeHasMark(0, doc.content.size, mark)
        }).toEqual({ markdown, mark: mark.name, kept: true })
      }
    }
  })

  it('when quoted from a book or imported, over several lines', { timeout: 120_000 }, () => {
    const next = random(11)
    for (let i = 0; i < 1500; i++) {
      const passage = [line(next), line(next), line(next)].slice(0, 1 + Math.floor(next() * 3))
      const text = passage.join('\n')
      const markdown = escapeMarkdownText(text)
      const back = opened(markdown)

      expect({ text, markdown, shown: back.text }).toEqual({ text, markdown, shown: text })
      expect(ONLY_TEXT(back.nodes)).toEqual([])
      expect(toPlainText(markdown)).toBe(passage.join(' ').replace(/\s+/g, ' ').trim())
    }
  })
})
