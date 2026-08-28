import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import App from '../src/renderer/src/App'
import { installBridge, makeBook, renderApp } from './helpers/render'

function shell(): void {
  installBridge({ books: [makeBook()] })
  renderApp(<App />)
}

// Driven through the whole shell: a global keydown listener, two always-mounted
// dialogs and a focus trap sit between a keypress and the field.
describe('Typing in the add-book search', () => {
  it('accepts characters when the dialog is opened from the sidebar', async () => {
    const user = userEvent.setup()
    shell()

    await user.click(screen.getByRole('button', { name: /add book/i }))
    const field = await screen.findByLabelText('Search for a book')
    await user.type(field, 'dune')

    expect((field as HTMLInputElement).value).toBe('dune')
  })

  it('accepts characters when opened with the keyboard shortcut', async () => {
    const user = userEvent.setup()
    shell()

    await user.keyboard('{Control>}n{/Control}')
    const field = await screen.findByLabelText('Search for a book')
    await user.type(field, 'dune')

    expect((field as HTMLInputElement).value).toBe('dune')
  })

  it('accepts characters in the command palette itself', async () => {
    const user = userEvent.setup()
    shell()

    await user.keyboard('{Control>}k{/Control}')
    const field = await screen.findByPlaceholderText(/Search notes and books/)
    await user.type(field, 'walls')

    expect((field as HTMLInputElement).value).toBe('walls')
  })

  it('accepts characters when reached through the command palette', async () => {
    const user = userEvent.setup()
    shell()

    await user.keyboard('{Control>}k{/Control}')
    const palette = await screen.findByRole('dialog')
    await user.click(within(palette).getByText('Add a book'))

    const field = await screen.findByLabelText('Search for a book')
    await user.type(field, 'dune')

    expect((field as HTMLInputElement).value).toBe('dune')
  })

  it('accepts characters in the library filter', async () => {
    const user = userEvent.setup()
    shell()

    const field = await screen.findByLabelText('Filter library')
    await user.type(field, 'dis')

    expect((field as HTMLInputElement).value).toBe('dis')
  })

  it('keeps the field focused while typing', async () => {
    const user = userEvent.setup()
    shell()

    await user.click(screen.getByRole('button', { name: /add book/i }))
    const field = await screen.findByLabelText('Search for a book')

    await user.type(field, 'du')
    await waitFor(() => expect(document.activeElement).toBe(field))
    await user.type(field, 'ne')

    expect((field as HTMLInputElement).value).toBe('dune')
  })

  it('lets a letter that is also a shortcut through', async () => {
    const user = userEvent.setup()
    shell()

    await user.click(screen.getByRole('button', { name: /add book/i }))
    const field = await screen.findByLabelText('Search for a book')

    // `n` and `k` are shortcuts only with a modifier.
    await user.type(field, 'knknk')

    expect((field as HTMLInputElement).value).toBe('knknk')
  })
})
