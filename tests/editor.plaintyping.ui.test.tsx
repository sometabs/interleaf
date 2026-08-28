import { Editor as TiptapEditor } from '@tiptap/core'
import { afterEach, describe, expect, it } from 'vitest'

import { noteExtensions, NOTE_TYPING } from '../src/renderer/src/lib/editor/extensions'
import { markdownToHtml } from '../src/renderer/src/lib/editor/markdown'

// Built from the real configuration: the other editor tests type by assigning
// `innerHTML`, which never reaches ProseMirror's text-input path.
let editor: TiptapEditor | null = null

function open(markdown = ''): TiptapEditor {
  editor = new TiptapEditor({
    ...NOTE_TYPING,
    extensions: noteExtensions(),
    content: markdownToHtml(markdown)
  })
  return editor
}

afterEach(() => {
  editor?.destroy()
  editor = null
})

// ProseMirror offers each keystroke to `handleTextInput` first and inserts it
// only if nothing claimed it.
function typeText(text: string): void {
  const view = editor?.view
  if (!view) throw new Error('No editor')
  for (const char of text) {
    const { from, to } = view.state.selection
    // ProseMirror's default insertion, offered so a handler can defer to it.
    const handled = view.someProp('handleTextInput', (fn) =>
      fn(view, from, to, char, () => view.state.tr)
    )
    if (!handled) view.dispatch(view.state.tr.insertText(char, from, to))
  }
}

function nodeTypes(): string[] {
  const names: string[] = []
  editor?.state.doc.descendants((node) => {
    names.push(node.type.name)
  })
  return names
}

function text(): string {
  return editor?.state.doc.textContent ?? ''
}

describe('typing markdown into a note', () => {
  const cases: [name: string, typed: string, node: string][] = [
    ['three dashes stay three dashes', '---', 'horizontalRule'],
    ['a hash does not make a heading', '# not a heading', 'heading'],
    ['a dash does not make a bullet', '- not a list', 'bulletList'],
    ['a number does not make a numbered list', '1. not a list', 'orderedList'],
    ['an angle bracket does not make a quote', '> not a quote', 'blockquote']
  ]

  for (const [name, typed, node] of cases) {
    it(name, () => {
      open()
      typeText(typed)

      expect(nodeTypes()).not.toContain(node)
      expect(text()).toBe(typed)
    })
  }

  it('does not turn asterisks into bold', () => {
    const instance = open()
    typeText('**not bold** ')

    const { doc, schema } = instance.state
    expect(doc.rangeHasMark(0, doc.content.size, schema.marks.bold)).toBe(false)
    expect(text()).toBe('**not bold** ')
  })

  it('does not turn backticks into anything', () => {
    open()
    typeText('`not code` ')

    expect(text()).toBe('`not code` ')
  })

  it('does not format markdown that is pasted in', () => {
    const instance = open()
    const { view } = instance
    // How ProseMirror marks a paste, which the paste-rule plugin watches for.
    const tr = view.state.tr.insertText('**pasted**')
    tr.setMeta('paste', true)
    tr.setMeta('uiEvent', 'paste')
    view.dispatch(tr)

    const { doc, schema } = instance.state
    expect(doc.rangeHasMark(0, doc.content.size, schema.marks.bold)).toBe(false)
    expect(text()).toBe('**pasted**')
  })

  it('still types ordinary text', () => {
    open()
    typeText('Fear is the mind-killer.')

    expect(text()).toBe('Fear is the mind-killer.')
  })
})

describe('what a note can hold at all', () => {
  // A node the editor cannot make is dropped on load and the next save writes
  // that loss to disk, so these stay out of the schema entirely.
  it('has no node for what the toolbar cannot make', () => {
    const { nodes, marks } = open().state.schema

    for (const name of ['horizontalRule', 'codeBlock']) expect(nodes[name]).toBeUndefined()
    for (const name of ['code', 'strike', 'link']) expect(marks[name]).toBeUndefined()
  })

  it('still has one for everything the toolbar offers', () => {
    const { nodes, marks } = open().state.schema

    for (const name of ['heading', 'bulletList', 'orderedList', 'blockquote', 'paragraph']) {
      expect(nodes[name]).toBeDefined()
    }
    for (const name of ['bold', 'italic', 'underline']) expect(marks[name]).toBeDefined()
  })

  it('opens the markdown the toolbar writes', () => {
    open('# Title\n\n**bold** and *italic*\n\n-   one\n\n> quote')

    expect(nodeTypes()).toContain('heading')
    expect(nodeTypes()).toContain('bulletList')
    expect(nodeTypes()).toContain('blockquote')
  })

  it('opens a stored rule as the characters it is', () => {
    open('before\n\n---\n\nafter')

    expect(nodeTypes()).not.toContain('horizontalRule')
    expect(text()).toContain('---')
  })
})
