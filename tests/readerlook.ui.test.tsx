import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it } from 'vitest'

import { useReaderLook } from '../src/renderer/src/lib/queries'
import { DEFAULT_LOOK, type ReaderLook } from '../src/shared/readerLook'
import { installBridge, renderApp } from './helpers/render'

afterEach(() => window.localStorage.clear())

function Settings(): ReactNode {
  const [look, setLook] = useReaderLook()
  return (
    <>
      <p data-testid="size">{look.size}</p>
      <button type="button" onClick={() => setLook({ ...look, size: look.size + 10 })}>
        Larger
      </button>
    </>
  )
}

const local = (look: ReaderLook): void =>
  window.localStorage.setItem('reader.look', JSON.stringify(look))
const shownSize = (): string | null => screen.getByTestId('size').textContent

describe('reader settings kept with the library', () => {
  it('takes the restored library over what this machine remembers', async () => {
    local({ ...DEFAULT_LOOK, size: 90 })
    installBridge({ readerLook: { ...DEFAULT_LOOK, size: 150 } })
    renderApp(<Settings />)

    await waitFor(() => expect(shownSize()).toBe('150'))
    expect(JSON.parse(window.localStorage.getItem('reader.look')!).size).toBe(150)
  })

  it('moves settings made before the library kept them into the library', async () => {
    local({ ...DEFAULT_LOOK, size: 130 })
    const state = installBridge()
    renderApp(<Settings />)

    expect(shownSize()).toBe('130')
    await waitFor(() => expect(state.readerLook?.size).toBe(130))
  })

  it('saves a change to the library', async () => {
    const state = installBridge({ readerLook: { ...DEFAULT_LOOK, size: 120 } })
    renderApp(<Settings />)
    await waitFor(() => expect(shownSize()).toBe('120'))

    await userEvent.setup().click(screen.getByRole('button', { name: 'Larger' }))

    expect(shownSize()).toBe('130')
    await waitFor(() => expect(state.readerLook?.size).toBe(130))
    expect(JSON.parse(window.localStorage.getItem('reader.look')!).size).toBe(130)
  })

  it('leaves a library with no settings alone', async () => {
    const state = installBridge()
    renderApp(<Settings />)

    await waitFor(() => expect(shownSize()).toBe('100'))
    expect(state.readerLook).toBeNull()
  })
})
