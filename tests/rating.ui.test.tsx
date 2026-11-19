import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import Rating from '../src/renderer/src/components/Rating'

function placeStar(button: HTMLElement): void {
  // jsdom lays nothing out, so each star gets a 20px box at its position.
  const index = Number(button.getAttribute('aria-label')?.split(' ')[0]) - 1
  button.getBoundingClientRect = () => new DOMRect(index * 20, 0, 20, 20)
}

function star(name: string): HTMLElement {
  const button = screen.getByRole('button', { name })
  placeStar(button)
  return button
}

describe('Rating', () => {
  it('picks a half star from the left half of a star and a whole star from the right', () => {
    const onChange = vi.fn()
    render(<Rating value={null} onChange={onChange} />)

    fireEvent.click(star('4 stars'), { clientX: 62, detail: 1 })
    fireEvent.click(star('4 stars'), { clientX: 75, detail: 1 })

    expect(onChange.mock.calls).toEqual([[3.5], [4]])
  })

  it('never goes below one star from the first star', () => {
    const onChange = vi.fn()
    render(<Rating value={null} onChange={onChange} />)

    fireEvent.click(star('1 star'), { clientX: 2, detail: 1 })

    expect(onChange).toHaveBeenCalledWith(1)
  })

  it('picks the whole star when pressed from the keyboard', () => {
    const onChange = vi.fn()
    render(<Rating value={null} onChange={onChange} />)

    fireEvent.click(star('3 stars'), { clientX: 0, detail: 0 })

    expect(onChange).toHaveBeenCalledWith(3)
  })

  it('clears the rating when the current half star is picked again', () => {
    const onChange = vi.fn()
    render(<Rating value={3.5} onChange={onChange} />)

    fireEvent.click(star('4 stars'), { clientX: 62, detail: 1 })

    expect(onChange).toHaveBeenCalledWith(null)
  })

  it('moves in half stars with the arrow keys, within 1 to 5', () => {
    const onChange = vi.fn()
    const view = render(<Rating value={3} onChange={onChange} />)
    const button = screen.getByRole('button', { name: '3 stars' })

    fireEvent.keyDown(button, { key: 'ArrowRight' })
    fireEvent.keyDown(button, { key: 'ArrowLeft' })
    view.rerender(<Rating value={5} onChange={onChange} />)
    fireEvent.keyDown(button, { key: 'ArrowRight' })
    view.rerender(<Rating value={null} onChange={onChange} />)
    fireEvent.keyDown(button, { key: 'ArrowLeft' })
    fireEvent.keyDown(button, { key: 'ArrowRight' })

    expect(onChange.mock.calls).toEqual([[3.5], [2.5], [1]])
  })

  it('shows a half-filled star for a half rating', () => {
    render(<Rating value={3.5} readOnly />)

    const stars = screen.getByRole('img', { name: 'Rated 3.5 of 5' })
    expect(stars.querySelectorAll('.text-star')).toHaveLength(4)
    expect(stars.querySelectorAll('[data-half]')).toHaveLength(1)
  })

  it('previews the half star under the pointer', () => {
    render(<Rating value={null} onChange={() => {}} />)
    const button = star('2 stars')

    fireEvent.mouseMove(button, { clientX: 22 })

    expect(screen.getByRole('radiogroup').querySelectorAll('[data-half]')).toHaveLength(1)
    fireEvent.mouseLeave(screen.getByRole('radiogroup'))
    expect(screen.getByRole('radiogroup').querySelectorAll('[data-half]')).toHaveLength(0)
  })
})
