import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import Editor from '../src/renderer/src/components/Editor'
import NoteView from '../src/renderer/src/components/NoteView'
import { installBridge, makeBook, makeNote, renderApp, type FakeBridge } from './helpers/render'

function select(label: string): HTMLSelectElement {
  return screen.getByLabelText(label) as HTMLSelectElement
}

async function choose(label: string, value: string): Promise<void> {
  await act(async () => {
    fireEvent.change(select(label), { target: { value } })
  })
}

describe('tying a note to a book', () => {
  async function open(bridge: FakeBridge): Promise<void> {
    renderApp(<NoteView noteId={10} />, { kind: 'note', id: 10 })
    await waitFor(() => expect(select('Book this note is about')).toBeDefined())
    void bridge
  }

  it('offers every book, and starts on none', async () => {
    const bridge = installBridge({
      books: [makeBook({ id: 1, title: 'Dune' }), makeBook({ id: 2, title: 'Solaris' })],
      notes: [makeNote({ id: 10, bookId: null })]
    })
    await open(bridge)

    expect(select('Book this note is about').value).toBe('')
    expect(screen.getByRole('option', { name: 'Dune' })).toBeDefined()
    expect(screen.getByRole('option', { name: 'Solaris' })).toBeDefined()
  })

  it('ties the note to the chosen book', async () => {
    const bridge = installBridge({
      books: [makeBook({ id: 1, title: 'Dune' })],
      notes: [makeNote({ id: 10, bookId: null })]
    })
    await open(bridge)

    await choose('Book this note is about', '1')

    await waitFor(() => expect(bridge.notes[0].bookId).toBe(1))
  })

  it('sets a tied note loose again', async () => {
    const bridge = installBridge({
      books: [makeBook({ id: 1, title: 'Dune' })],
      notes: [makeNote({ id: 10, bookId: 1 })]
    })
    await open(bridge)

    expect(select('Book this note is about').value).toBe('1')

    await choose('Book this note is about', '')

    await waitFor(() => expect(bridge.notes[0].bookId).toBeNull())
  })
})

describe('the note tag', () => {
  it('starts on "No tag" and saves the one picked', async () => {
    const bridge = installBridge({ notes: [makeNote({ id: 10, tag: null })] })
    renderApp(<NoteView noteId={10} />, { kind: 'note', id: 10 })
    await waitFor(() => expect(select('Note tag')).toBeDefined())

    expect(select('Note tag').value).toBe('')

    await choose('Note tag', 'THEORY')

    await waitFor(() => expect(bridge.notes[0].tag).toBe('THEORY'))
  })

  it('clears back to no tag', async () => {
    const bridge = installBridge({ notes: [makeNote({ id: 10, tag: 'SUMMARY' })] })
    renderApp(<NoteView noteId={10} />, { kind: 'note', id: 10 })
    await waitFor(() => expect(select('Note tag').value).toBe('SUMMARY'))

    await choose('Note tag', '')

    await waitFor(() => expect(bridge.notes[0].tag).toBeNull())
  })

  it('is absent from an editor that was given no tag handler', async () => {
    installBridge()
    renderApp(<Editor value="a review" onSave={() => {}} />)

    await waitFor(() => expect(screen.getByLabelText('Bold')).toBeDefined())
    expect(screen.queryByLabelText('Note tag')).toBeNull()
  })
})

// jsdom loads no stylesheet, so a computed `font-size` would only report the
// browser default; the variable the component sets is asserted instead.
function declaredSizes(): string[] {
  return [...document.querySelectorAll<HTMLElement>('[style*="--note-font-size"]')].map((node) =>
    node.style.getPropertyValue('--note-font-size').trim()
  )
}

describe('note font size', () => {
  it('resizes the prose without touching the note', async () => {
    installBridge()
    renderApp(<Editor value="the desert planet" onSave={() => {}} />)
    await waitFor(() => expect(select('Font size')).toBeDefined())

    expect(declaredSizes()).toEqual(['16px'])

    await choose('Font size', 'xlarge')

    await waitFor(() => expect(declaredSizes()).toEqual(['21px']))
    expect(document.querySelector('.note-prose')?.textContent).toBe('the desert planet')
  })

  it('moves every editor on the page at once', async () => {
    installBridge()
    renderApp(
      <>
        <Editor value="first" onSave={() => {}} />
        <Editor value="second" onSave={() => {}} />
      </>
    )
    await waitFor(() => expect(screen.getAllByLabelText('Font size')).toHaveLength(2))

    await act(async () => {
      fireEvent.change(screen.getAllByLabelText('Font size')[0], { target: { value: 'small' } })
    })

    // A book page shows a review and every open note at once.
    await waitFor(() => expect(declaredSizes()).toEqual(['14px', '14px']))
  })

  it('remembers the choice for the next note opened', async () => {
    installBridge()
    renderApp(<Editor value="first" onSave={() => {}} />)
    await waitFor(() => expect(select('Font size')).toBeDefined())

    await choose('Font size', 'large')

    expect(window.localStorage.getItem('interleaf.noteFontSize')).toBe('large')
  })
})
