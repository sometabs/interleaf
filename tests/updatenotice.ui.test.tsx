import { act, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import UpdateNotice from '../src/renderer/src/components/UpdateNotice'
import { installBridge, renderApp } from './helpers/render'

describe('update notice', () => {
  it('stays hidden until an update has downloaded', async () => {
    const bridge = installBridge()
    renderApp(<UpdateNotice />)

    expect(screen.queryByRole('region', { name: 'Update ready' })).toBeNull()

    act(() => bridge.emitUpdateReady('1.21.0'))

    expect(await screen.findByText('Interleaf 1.21.0 is ready')).toBeTruthy()
  })

  it('shows an update that finished downloading before the window opened', async () => {
    installBridge({}, { getReadyUpdate: async () => '1.21.0' })
    renderApp(<UpdateNotice />)

    expect(await screen.findByText('Interleaf 1.21.0 is ready')).toBeTruthy()
  })

  it('restarts into the update', async () => {
    const restartToUpdate = vi.fn(async () => {})
    const bridge = installBridge({}, { restartToUpdate })
    renderApp(<UpdateNotice />)
    act(() => bridge.emitUpdateReady('1.21.0'))

    await userEvent.click(await screen.findByRole('button', { name: 'Restart now' }))

    expect(restartToUpdate).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Restart now' })).toHaveProperty('disabled', true)
  })

  it('goes away on Later without restarting', async () => {
    const restartToUpdate = vi.fn(async () => {})
    const bridge = installBridge({}, { restartToUpdate })
    renderApp(<UpdateNotice />)
    act(() => bridge.emitUpdateReady('1.21.0'))

    await userEvent.click(await screen.findByRole('button', { name: 'Later' }))

    expect(screen.queryByText('Interleaf 1.21.0 is ready')).toBeNull()
    expect(restartToUpdate).not.toHaveBeenCalled()
  })
})
