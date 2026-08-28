import { Placeholder } from '@tiptap/extensions'
import { EditorContent, useEditor, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { useEffect, type ReactNode } from 'react'
import { describe, expect, it } from 'vitest'

import EditorToolbar from '../src/renderer/src/components/EditorToolbar'
import { htmlToMarkdown, markdownToHtml } from '../src/renderer/src/lib/editor/markdown'
import { installBridge, renderApp } from './helpers/render'

let editor: Editor | null = null

function Harness({ content }: { content: string }): ReactNode {
  const instance = useEditor({
    immediatelyRender: true,
    content: markdownToHtml(content),
    extensions: [
      StarterKit.configure({ link: { openOnClick: false } }),
      Placeholder.configure({ placeholder: '' })
    ],
    editorProps: { attributes: { class: 'note-prose' } }
  })

  useEffect(() => {
    editor = instance
  }, [instance])

  return (
    <>
      <EditorToolbar editor={instance} />
      <EditorContent editor={instance} />
    </>
  )
}

async function mount(content: string): Promise<Editor> {
  installBridge()
  renderApp(<Harness content={content} />)
  await waitFor(() => expect(screen.getByLabelText('Bold')).toBeDefined())
  if (!editor) throw new Error('no editor')
  return editor
}

async function select(instance: Editor, text: string): Promise<void> {
  const at = instance.state.doc.textContent.indexOf(text)
  if (at < 0) throw new Error(`"${text}" is not in the document`)
  await act(async () => {
    // ProseMirror positions count node boundaries, so text starts at 1.
    instance.commands.setTextSelection({ from: at + 1, to: at + 1 + text.length })
  })
}

async function caretInside(instance: Editor, text: string): Promise<void> {
  const at = instance.state.doc.textContent.indexOf(text)
  await act(async () => {
    instance.commands.setTextSelection(at + 2)
  })
}

function press(label: string): void {
  fireEvent.click(screen.getByLabelText(label))
}

function saved(instance: Editor): string {
  return htmlToMarkdown(instance.getHTML())
}

describe('the formatting toolbar', () => {
  it('bolds the selection', async () => {
    const instance = await mount('the desert planet')
    await select(instance, 'desert')

    press('Bold')

    expect(instance.getHTML()).toContain('<strong>desert</strong>')
    expect(saved(instance)).toBe('the **desert** planet')
  })

  it('italicises and underlines', async () => {
    const instance = await mount('the desert planet')
    await select(instance, 'desert')

    press('Italic')
    expect(saved(instance)).toBe('the *desert* planet')

    press('Underline')
    expect(saved(instance)).toBe('the *<u>desert</u>* planet')
  })

  it('removes the formatting when pressed again', async () => {
    const instance = await mount('the **desert** planet')
    await select(instance, 'desert')

    press('Bold')

    expect(saved(instance)).toBe('the desert planet')
  })

  it('never puts syntax on screen', async () => {
    const instance = await mount('the desert planet')
    await select(instance, 'desert')

    press('Bold')
    press('Underline')

    const painted = document.querySelector('.note-prose')?.textContent ?? ''
    expect(painted).toBe('the desert planet')
    expect(painted).not.toContain('*')
    expect(painted).not.toContain('<u>')
  })

  it('lights the button when the caret sits inside the word', async () => {
    const instance = await mount('the **desert** planet')

    expect(screen.getByLabelText('Bold').getAttribute('aria-pressed')).toBe('false')

    await caretInside(instance, 'desert')

    await waitFor(() =>
      expect(screen.getByLabelText('Bold').getAttribute('aria-pressed')).toBe('true')
    )
  })

  it('changes the size of the paragraph the caret is in', async () => {
    const instance = await mount('On Dune\n\nsome thoughts')
    await caretInside(instance, 'On Dune')

    const size = screen.getByLabelText('Paragraph style') as HTMLSelectElement
    expect(size.value).toBe('0')

    fireEvent.change(size, { target: { value: '1' } })

    expect(instance.getHTML()).toContain('<h1>On Dune</h1>')
    expect(saved(instance)).toBe('# On Dune\n\nsome thoughts')
    await waitFor(() =>
      expect((screen.getByLabelText('Paragraph style') as HTMLSelectElement).value).toBe('1')
    )
  })

  it('turns a heading back into body text', async () => {
    const instance = await mount('## On Dune')
    await caretInside(instance, 'On Dune')

    fireEvent.change(screen.getByLabelText('Paragraph style'), { target: { value: '0' } })

    expect(saved(instance)).toBe('On Dune')
  })

  it('makes a bulleted list', async () => {
    const instance = await mount('one')
    await caretInside(instance, 'one')

    press('Bulleted list')

    expect(saved(instance)).toBe('-   one')
  })

  it('makes a numbered list', async () => {
    const instance = await mount('one')
    await caretInside(instance, 'one')

    press('Numbered list')

    expect(saved(instance)).toBe('1.  one')
  })

  it('makes a quote', async () => {
    const instance = await mount('Fear is the mind-killer.')
    await caretInside(instance, 'Fear')

    press('Quote')

    expect(saved(instance)).toBe('> Fear is the mind-killer.')
  })

  it('lights the list button when the caret is in one', async () => {
    const instance = await mount('-   one\n-   two')
    await caretInside(instance, 'one')

    await waitFor(() =>
      expect(screen.getByLabelText('Bulleted list').getAttribute('aria-pressed')).toBe('true')
    )
    expect(screen.getByLabelText('Quote').getAttribute('aria-pressed')).toBe('false')
  })
})
