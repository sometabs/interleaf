import { act, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import UpdateNotice from '../src/renderer/src/components/UpdateNotice'
import type { ReadyUpdate, ReleaseNoteLine } from '../src/shared/api'
import { installBridge, renderApp } from './helpers/render'

function ready(version: string, notes: ReleaseNoteLine[] = []): ReadyUpdate {
  return { version, notes }
}

const heading = (text: string): ReleaseNoteLine => ({ heading: true, text })
const item = (text: string): ReleaseNoteLine => ({ heading: false, text })

describe('update notice', () => {
  it('stays hidden until an update has downloaded', async () => {
    const bridge = installBridge()
    renderApp(<UpdateNotice />)

    expect(screen.queryByRole('region', { name: 'Update ready' })).toBeNull()

    act(() => bridge.emitUpdateReady(ready('1.21.0')))

    expect(await screen.findByText('Interleaf 1.21.0 is ready')).toBeTruthy()
  })

  it('shows an update that finished downloading before the window opened', async () => {
    installBridge({}, { getReadyUpdate: async () => ready('1.21.0') })
    renderApp(<UpdateNotice />)

    expect(await screen.findByText('Interleaf 1.21.0 is ready')).toBeTruthy()
  })

  it('restarts into the update', async () => {
    const restartToUpdate = vi.fn(async () => {})
    const bridge = installBridge({}, { restartToUpdate })
    renderApp(<UpdateNotice />)
    act(() => bridge.emitUpdateReady(ready('1.21.0')))

    await userEvent.click(await screen.findByRole('button', { name: 'Restart now' }))

    expect(restartToUpdate).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Restart now' })).toHaveProperty('disabled', true)
  })

  it('goes away on Later without restarting', async () => {
    const restartToUpdate = vi.fn(async () => {})
    const bridge = installBridge({}, { restartToUpdate })
    renderApp(<UpdateNotice />)
    act(() => bridge.emitUpdateReady(ready('1.21.0')))

    await userEvent.click(await screen.findByRole('button', { name: 'Later' }))

    expect(screen.queryByText('Interleaf 1.21.0 is ready')).toBeNull()
    expect(restartToUpdate).not.toHaveBeenCalled()
  })

  it('lists what changed under its headings', async () => {
    const bridge = installBridge()
    renderApp(<UpdateNotice />)

    act(() =>
      bridge.emitUpdateReady(
        ready('1.22.0', [
          heading('New'),
          item('Rate books in half stars'),
          heading('Fixed'),
          item('Typing is saved on close')
        ])
      )
    )

    const notice = await screen.findByRole('region', { name: 'Update ready' })
    expect(screen.getByRole('heading', { name: 'New' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Fixed' })).toBeTruthy()
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Rate books in half stars',
      'Typing is saved on close'
    ])
    expect(notice.querySelector('a')).toBeNull()
  })

  it('cuts long notes short and links to the full release', async () => {
    const bridge = installBridge()
    renderApp(<UpdateNotice />)
    const notes = [
      heading('New'),
      ...['One', 'Two', 'Three', 'Four'].map(item),
      heading('Fixed'),
      item('Five')
    ]

    act(() => bridge.emitUpdateReady(ready('1.22.0', notes)))

    await screen.findByRole('region', { name: 'Update ready' })
    expect(screen.getAllByRole('listitem')).toHaveLength(4)
    // The cut falls right after "Fixed", which would head nothing.
    expect(screen.queryByRole('heading', { name: 'Fixed' })).toBeNull()
    expect(screen.getByRole('link', { name: 'See all changes' }).getAttribute('href')).toBe(
      'https://github.com/sometabs/interleaf/releases/tag/v1.22.0'
    )
  })
})
