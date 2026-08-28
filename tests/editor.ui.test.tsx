import type { Editor as TiptapEditor } from '@tiptap/react'
import { act, screen, waitFor } from '@testing-library/react'
import { StrictMode, type ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import BookDetail from '../src/renderer/src/components/BookDetail'
import Editor from '../src/renderer/src/components/Editor'
import { useBook } from '../src/renderer/src/lib/queries'
import { installBridge, makeBook, renderApp, type FakeBridge } from './helpers/render'

// A rebuilt editor looks identical on screen but has lost the cursor, the
// selection and the undo history, so these hold the instance itself.

function BookRoute({ id }: { id: number }): ReactNode {
  const book = useBook(id)
  return book ? <BookDetail key={id} book={book} /> : null
}

// ProseMirror hangs its instance off the DOM node, which is the only way to
// reach the same object the component holds.
interface PmDom extends HTMLElement {
  pmViewDesc?: { updateOuterDeco?: unknown }
}

function domAt(index: number): HTMLElement {
  const nodes = document.querySelectorAll<PmDom>('.note-prose')
  const node = nodes[index]
  if (!node) throw new Error('No editor mounted at that index')
  return node
}

async function type(dom: HTMLElement, text: string): Promise<void> {
  await act(async () => {
    dom.focus()
    // ProseMirror listens for real input events, so this is what a keystroke
    // looks like from its side.
    dom.innerHTML = `<p>${text}</p>`
    dom.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => {
    vi.advanceTimersByTime(800)
  })
}

describe('Editor lifecycle', () => {
  it('mounts exactly one editor under StrictMode', async () => {
    installBridge()
    renderApp(
      <StrictMode>
        <Editor value="hello" onSave={() => {}} />
      </StrictMode>
    )

    // StrictMode mounts twice in dev, so an incomplete cleanup leaves two
    // overlapping editable areas.
    await waitFor(() => expect(screen.getAllByTestId('editor')).toHaveLength(1))
    expect(document.querySelectorAll('.note-prose')).toHaveLength(1)
  })

  it('renders the markdown it was given as real formatting', async () => {
    installBridge()
    renderApp(<Editor value={'# On Dune\n\nthe **desert** planet'} onSave={() => {}} />)

    await waitFor(() => expect(document.querySelector('.note-prose')).toBeDefined())
    const dom = domAt(0)

    expect(dom.querySelector('h1')?.textContent).toBe('On Dune')
    expect(dom.querySelector('strong')?.textContent).toBe('desert')
    expect(dom.textContent).not.toContain('#')
    expect(dom.textContent).not.toContain('*')
  })

  it('does not rebuild when a save round-trips new data back', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const bridge: FakeBridge = installBridge({ books: [makeBook()] })
    renderApp(<BookRoute id={1} />, { kind: 'book', id: 1 })

    await waitFor(() => expect(screen.getAllByTestId('editor')).toHaveLength(1))
    const host = screen.getByTestId('editor')
    const dom = domAt(0)

    await type(dom, 'A review in progress')

    // The save invalidates the notes query, which refetches and re-renders
    // this component with a new `value`.
    await waitFor(() => expect(bridge.notes).toHaveLength(1))
    await waitFor(() => expect(bridge.notes[0].bodyMd).toBe('A review in progress'))

    expect(screen.getByTestId('editor')).toBe(host)
    expect(domAt(0)).toBe(dom)
    vi.useRealTimers()
  })

  it('does not touch the document when the value round-trips unchanged', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const bridge = installBridge({ books: [makeBook()] })
    renderApp(<BookRoute id={1} />, { kind: 'book', id: 1 })

    await waitFor(() => expect(screen.getAllByTestId('editor')).toHaveLength(1))
    const dom = domAt(0)
    await type(dom, 'Stable text')
    await waitFor(() => expect(bridge.notes).toHaveLength(1))

    const before = dom.innerHTML
    await act(async () => {
      vi.advanceTimersByTime(2000)
    })

    expect(dom.innerHTML).toBe(before)
    vi.useRealTimers()
  })

  it('saves markdown, not HTML', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const bridge = installBridge({ books: [makeBook()] })
    renderApp(<BookRoute id={1} />, { kind: 'book', id: 1 })

    await waitFor(() => expect(screen.getAllByTestId('editor')).toHaveLength(1))
    const dom = domAt(0)

    await act(async () => {
      dom.focus()
      dom.innerHTML = '<h2>Verdict</h2><p>the <strong>desert</strong> planet</p>'
      dom.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => {
      vi.advanceTimersByTime(800)
    })

    await waitFor(() => expect(bridge.notes).toHaveLength(1))
    expect(bridge.notes[0].bodyMd).toBe('## Verdict\n\nthe **desert** planet')
    vi.useRealTimers()
  })
})

describe('editor instances', () => {
  it('keeps each editor on the page independent', async () => {
    installBridge()
    renderApp(
      <>
        <Editor value="first" onSave={() => {}} />
        <Editor value="second" onSave={() => {}} />
      </>
    )

    await waitFor(() => expect(document.querySelectorAll('.note-prose')).toHaveLength(2))
    expect(domAt(0).textContent).toBe('first')
    expect(domAt(1).textContent).toBe('second')
  })
})

export type { TiptapEditor }
